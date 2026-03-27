import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { AccessRule, ApiSection, BrickSpec, FieldDef, SchemaSection } from "./brick-spec.ts";
import { BrickendError } from "./errors.ts";
import type { GeneratedFile } from "./file-writer.ts";
import type { BrickSpecDiff } from "./spec-diff.ts";
import type { BrickendState } from "./state.ts";
import { rbacPermissionsSeedSql } from "./templates/rbac.ts";

export interface GenerationContext {
	project: { name: string; type: string; stack: string };
	brick: BrickSpec;
	config: Record<string, unknown>;
	state: BrickendState;
	existingBricks: string[];
	projectPath?: string;
	requiredBrickSpecs?: BrickSpec[];
	dryRun?: boolean;
}

type BrickRegistry = Record<string, { table: string; pk: string; db_schema?: string }>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

function pluralize(s: string): string {
	if (s.endsWith("y")) return `${s.slice(0, -1)}ies`;
	if (s.endsWith("s")) return s;
	return `${s}s`;
}

const SINGULAR_EXCEPTIONS: Record<string, string> = {
	status: "status",
	address: "address",
	business: "business",
	process: "process",
	access: "access",
	class: "class",
	analysis: "analysis",
};

function singularize(name: string): string {
	if (SINGULAR_EXCEPTIONS[name]) return SINGULAR_EXCEPTIONS[name];
	if (name.endsWith("ies")) return `${name.slice(0, -3)}y`;
	if (name.endsWith("ses") || name.endsWith("xes") || name.endsWith("zes"))
		return name.slice(0, -2);
	if (name.endsWith("s")) return name.slice(0, -1);
	return name;
}

/** Convert snake_case to camelCase for use in TypeScript identifiers. */
function toCamelCase(s: string): string {
	return s.replace(/[-_]([a-z])/g, (_, c: string) => c.toUpperCase());
}

function fieldToZod(field: FieldDef): string {
	let base: string;
	switch (field.type) {
		case "string":
		case "text":
			base = "z.string()";
			break;
		case "email":
			base = "z.string().email()";
			break;
		case "uuid":
			base = "z.string().uuid()";
			break;
		case "boolean":
			base = "z.boolean()";
			break;
		case "numeric":
			base = "z.number()";
			break;
		case "url":
			base = "z.string().url()";
			break;
		default:
			base = "z.string()";
	}
	if (field.nullable) base += ".nullable()";
	return base;
}

function fieldToSqlType(field: FieldDef): string {
	switch (field.type) {
		case "string":
		case "text":
		case "email":
		case "url":
			return "text";
		case "uuid":
			return "uuid";
		case "boolean":
			return "boolean";
		case "numeric":
			return "numeric";
		default:
			return "text";
	}
}

function fieldToSql(field: FieldDef, registry: BrickRegistry, isPk: boolean): string {
	const sqlType = fieldToSqlType(field);

	if (isPk) {
		if (field.references === "auth") {
			return `${field.name} uuid primary key references auth.users(id) on delete cascade`;
		}
		const def = field.default ? ` default ${field.default}` : "";
		return `${field.name} ${sqlType} primary key${def}`;
	}

	// Non-PK: owner fields (references: auth) are implicitly not null
	const isOwner = field.references === "auth";
	const notNull = field.required || isOwner ? " not null" : "";
	const def = field.default ? ` default ${field.default}` : "";

	let ref = "";
	if (field.references === "auth") {
		ref = " references auth.users(id) on delete cascade";
	} else if (field.references) {
		const refSpec = registry[field.references];
		if (refSpec) {
			const refSchema = refSpec.db_schema ?? "public";
			ref = ` references ${refSchema}.${refSpec.table}(${refSpec.pk})`;
		}
	}

	return `${field.name} ${sqlType}${notNull}${def}${ref}`;
}

export function buildBrickRegistry(specs: BrickSpec[]): BrickRegistry {
	const registry: BrickRegistry = {};
	for (const spec of specs) {
		const s = spec.schema;
		if (s?.table && s.primary_key) {
			registry[spec.brick.name] = {
				table: s.table,
				pk: s.primary_key,
				db_schema: s.db_schema !== "public" ? s.db_schema : undefined,
			};
		}
	}
	return registry;
}

function inferCreateMode(schema: SchemaSection): "with-id" | "with-owner" | "standard" {
	const pk = schema.primary_key;
	const fields = schema.fields ?? [];
	const pkField = fields.find((f) => f.name === pk);
	if (pkField?.references === "auth") return "with-id";

	const ownerF = fields.find((f) => f.name !== pk && f.references === "auth");
	if (ownerF) return "with-owner";

	return "standard";
}

function getOwnerField(schema: SchemaSection): FieldDef | undefined {
	const pk = schema.primary_key;
	return (schema.fields ?? []).find((f) => f.name !== pk && f.references === "auth");
}

function isMultiTenant(context: GenerationContext): boolean {
	return context.state.settings?.multi_tenant === true;
}

function needsWorkspaceId(schema?: SchemaSection, api?: ApiSection, multiTenant = false): boolean {
	if (!multiTenant || !schema?.table || !api || api.type === "auth") return false;
	if (schema.workspace_scoped === false) return false;
	return inferCreateMode(schema) !== "with-id";
}

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

export function resolveConfigReferences(
	spec: Record<string, unknown>,
	config: Record<string, unknown>,
): Record<string, unknown> {
	const resolved: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(spec)) {
		if (typeof value === "string" && value.startsWith("$config.")) {
			const configKey = value.slice("$config.".length);
			resolved[key] = config[configKey];
		} else if (Array.isArray(value)) {
			resolved[key] = value.map((item) => {
				if (typeof item === "object" && item !== null && !Array.isArray(item)) {
					return resolveConfigReferences(item as Record<string, unknown>, config);
				}
				return item;
			});
		} else if (typeof value === "object" && value !== null) {
			resolved[key] = resolveConfigReferences(value as Record<string, unknown>, config);
		} else {
			resolved[key] = value;
		}
	}
	return resolved;
}

// ---------------------------------------------------------------------------
// Main generator (async — migration creation may run supabase migration new)
// ---------------------------------------------------------------------------

export async function generateBrickFiles(context: GenerationContext): Promise<GeneratedFile[]> {
	const { brick } = context;
	const brickName = brick.brick.name;
	const schema = brick.schema;
	const api = brick.api;
	const files: GeneratedFile[] = [];
	const entity = singularize(brickName);
	const registry = buildBrickRegistry(context.requiredBrickSpecs ?? []);
	const multiTenant = isMultiTenant(context);
	const wsScoped = needsWorkspaceId(schema, api, multiTenant);

	const access = brick.access ?? [];

	if (schema) {
		if (schema.table) {
			// Zod schema file
			files.push({
				path: `supabase/functions/_shared/schemas/${entity}.ts`,
				content: generateSchema(entity, schema, wsScoped),
			});

			// SQL migration
			const migrationFiles = await generateDatabaseFiles(
				schema,
				brickName,
				registry,
				context,
				access,
				multiTenant,
			);
			files.push(...migrationFiles);

			// Service files — only when a REST API is declared
			if (api && api.type !== "auth") {
				const createMode = inferCreateMode(schema);
				const pkField = schema.primary_key ?? "id";
				const ownerF = getOwnerField(schema);
				files.push(
					...generateServiceFiles(`supabase/functions/_shared/services/${brickName}`, {
						name: brickName,
						entity,
						schema_import: entity,
						table: schema.table,
						operations: api.endpoints.map((e) => e.handler),
						create_mode: createMode,
						pk_field: pkField,
						owner_field: ownerF?.name,
						search_field: api.search_field,
						constraints: schema.constraints,
						db_schema: schema.db_schema !== "public" ? schema.db_schema : undefined,
						workspace_scoped: wsScoped,
					}),
				);
			}
		} else if (api?.type === "auth") {
			// Auth brick: Zod schemas derived from endpoint bodies
			files.push({
				path: "supabase/functions/_shared/schemas/auth.ts",
				content: generateAuthSchema(api, multiTenant),
			});
		}
	}

	// API files
	if (api) {
		if (api.type === "auth") {
			files.push({
				path: "supabase/functions/auth/index.ts",
				content: generateAuthEntrypoint({}, multiTenant),
			});
			files.push({
				path: "supabase/functions/auth/deno.json",
				content: generateDenoConfig(),
			});
		} else if (schema?.table) {
			const createMode = inferCreateMode(schema);
			const pkField = schema.primary_key ?? "id";
			files.push({
				path: `supabase/functions/${brickName}/index.ts`,
				content: generateEntrypoint({
					name: brickName,
					auth_required: api.auth_required ?? false,
					service_import: brickName,
					schema_import: entity,
					create_mode: createMode,
					pk_field: pkField,
					endpoints: api.endpoints,
					access,
					workspace_scoped: wsScoped,
				}),
			});
			files.push({
				path: `supabase/functions/${brickName}/deno.json`,
				content: generateDenoConfig(),
			});
		}
	}

	return files;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export function generateSchema(
	entity: string,
	schema: SchemaSection,
	workspaceScoped = false,
): string {
	// Use camelCase for TypeScript identifiers (e.g. "identification_type" → "identificationType")
	const codeEntity = toCamelCase(entity);
	const Name = capitalize(codeEntity);
	const Plural = capitalize(pluralize(codeEntity));
	const pk = schema.primary_key;
	const fields = schema.fields ?? [];

	// Fields excluded from create/update: PK and owner field (non-PK with references: auth)
	const ownerF = getOwnerField(schema);
	const excluded = new Set<string>([pk, ownerF?.name].filter(Boolean) as string[]);
	const createFields = fields.filter((f) => !excluded.has(f.name));

	const lines: string[] = [];
	lines.push('import { z } from "npm:zod@4";');
	lines.push("");

	// Main schema (all fields + workspace_id if scoped + timestamps)
	lines.push(`export const ${codeEntity}Schema = z.object({`);
	for (const field of fields) {
		lines.push(`  ${field.name}: ${fieldToZod(field)},`);
	}
	if (workspaceScoped) {
		lines.push("  workspace_id: z.string().uuid(),");
	}
	lines.push("  created_at: z.string(),");
	lines.push("  updated_at: z.string(),");
	lines.push("  deleted_at: z.string().nullable(),");
	lines.push("});");
	lines.push("");

	// Create schema
	lines.push(`export const create${Name}Schema = z.object({`);
	for (const field of createFields) {
		const zodExpr = fieldToZod(field);
		if (field.required) {
			lines.push(`  ${field.name}: ${zodExpr},`);
		} else {
			lines.push(`  ${field.name}: ${zodExpr}.optional(),`);
		}
	}
	lines.push("});");
	lines.push("");

	// Update schema (all optional)
	lines.push(`export const update${Name}Schema = z.object({`);
	for (const field of createFields) {
		lines.push(`  ${field.name}: ${fieldToZod(field)}.optional(),`);
	}
	lines.push(`}).refine((d) => Object.keys(d).length > 0, {`);
	lines.push(`  message: "At least one field must be provided",`);
	lines.push(`});`);
	lines.push("");

	// List params schema
	lines.push(`export const list${Plural}ParamsSchema = z.object({`);
	lines.push("  search: z.string().optional(),");
	lines.push("  limit: z.coerce.number().int().min(1).max(100).default(20),");
	lines.push("  offset: z.coerce.number().int().min(0).default(0),");
	lines.push("});");
	lines.push("");

	// Types
	lines.push(`export type ${Name} = z.infer<typeof ${codeEntity}Schema>;`);
	lines.push(`export type Create${Name}Input = z.infer<typeof create${Name}Schema>;`);
	lines.push(`export type Update${Name}Input = z.infer<typeof update${Name}Schema>;`);
	lines.push(`export type List${Plural}Params = z.infer<typeof list${Plural}ParamsSchema>;`);
	lines.push("");

	return lines.join("\n");
}

// Auth schema — derived from endpoint body definitions
export function generateAuthSchema(api: ApiSection, multiTenant = false): string {
	const signupEp = api.endpoints.find((e) => e.handler === "signup");
	const signinEp = api.endpoints.find((e) => e.handler === "signin");

	const lines: string[] = [];
	lines.push('import { z } from "npm:zod@4";');
	lines.push("");

	if (signupEp?.body) {
		lines.push("export const signUpSchema = z.object({");
		for (const field of signupEp.body) {
			lines.push(`  ${field.name}: ${fieldToZod(field)},`);
		}
		if (multiTenant) {
			lines.push("  workspace_name: z.string().optional(),");
		}
		lines.push("});");
		lines.push("");
	}

	if (signinEp?.body) {
		lines.push("export const signInSchema = z.object({");
		for (const field of signinEp.body) {
			lines.push(`  ${field.name}: ${fieldToZod(field)},`);
		}
		lines.push("});");
		lines.push("");
	}

	lines.push("export type SignUpInput = z.infer<typeof signUpSchema>;");
	lines.push("export type SignInInput = z.infer<typeof signInSchema>;");
	lines.push("");

	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Service (multi-file bundle)
// ---------------------------------------------------------------------------

export function generateServiceFiles(
	basePath: string,
	spec: {
		name: string;
		entity: string;
		schema_import: string;
		table: string;
		operations: string[];
		create_mode?: string;
		pk_field?: string;
		owner_field?: string;
		search_field?: string;
		db_schema?: string;
		constraints?: {
			create?: Record<string, { type: string; message: string }>;
			update?: Record<string, { type: string; message: string }>;
		};
		workspace_scoped?: boolean;
	},
): GeneratedFile[] {
	const { name, entity, schema_import, table, operations, search_field, constraints } = spec;
	const createMode = spec.create_mode;
	const pkField = spec.pk_field ?? "id";
	const ownerFieldName = spec.owner_field;
	const dbSchema = spec.db_schema;
	const wsScoped = spec.workspace_scoped === true;

	// Fragment inserted after `await supabase` in every CRUD file.
	// For non-public schemas: `.schema("catalog")\n\t\t.from("table")`
	// For public schema:      `.from("table")`
	const schemaLine =
		dbSchema && dbSchema !== "public"
			? `.schema("${dbSchema}")\n\t\t.from("${table}")`
			: `.from("${table}")`;

	const codeEntity = toCamelCase(entity);
	const Entity = capitalize(codeEntity);
	const Plural = capitalize(pluralize(codeEntity));
	const schemaFile = `../../schemas/${schema_import}.ts`;
	const errorsFile = `../../core/errors.ts`;

	const files: GeneratedFile[] = [];

	// --- index.ts ---
	const indexLines: string[] = [];
	if (operations.includes("create"))
		indexLines.push(`export { create${Entity} } from "./create-${entity}.ts";`);
	if (operations.includes("get"))
		indexLines.push(`export { get${Entity} } from "./get-${entity}.ts";`);
	if (operations.includes("list"))
		indexLines.push(`export { list${Plural} } from "./list-${pluralize(entity)}.ts";`);
	if (operations.includes("update"))
		indexLines.push(`export { update${Entity} } from "./update-${entity}.ts";`);
	if (operations.includes("softDelete"))
		indexLines.push(`export { delete${Entity} } from "./delete-${entity}.ts";`);
	indexLines.push("");
	files.push({ path: `${basePath}/index.ts`, content: indexLines.join("\n") });

	// --- const-<name>.ts ---
	const constLines: string[] = [];
	constLines.push(`import { ConflictError, ValidationError } from "${errorsFile}";`);
	constLines.push("");

	const createConstraints = constraints?.create ?? {};
	const updateConstraints = constraints?.update ?? {};

	constLines.push(`export const ${Entity.toUpperCase()}_CREATE_ERRORS = {`);
	for (const [constraint, errorSpec] of Object.entries(createConstraints)) {
		constLines.push(`\t"${constraint}": new ${errorSpec.type}("${errorSpec.message}"),`);
	}
	constLines.push("};");
	constLines.push("");

	constLines.push(`export const ${Entity.toUpperCase()}_UPDATE_ERRORS = {`);
	for (const [constraint, errorSpec] of Object.entries(updateConstraints)) {
		constLines.push(`\t"${constraint}": new ${errorSpec.type}("${errorSpec.message}"),`);
	}
	constLines.push("};");
	constLines.push("");
	files.push({ path: `${basePath}/const-${name}.ts`, content: constLines.join("\n") });

	// --- create-<entity>.ts ---
	if (operations.includes("create")) {
		const lines: string[] = [];
		lines.push(`import type { SupabaseClient } from "npm:@supabase/supabase-js@2";`);
		lines.push(`import type { Create${Entity}Input } from "${schemaFile}";`);
		lines.push(`import { mapDbError } from "${errorsFile}";`);
		lines.push(`import { ${Entity.toUpperCase()}_CREATE_ERRORS } from "./const-${name}.ts";`);
		lines.push("");

		if (createMode === "with-id") {
			lines.push(`export async function create${Entity}(`);
			lines.push(`\tsupabase: SupabaseClient,`);
			lines.push(`\tinput: Create${Entity}Input & { ${pkField}: string },`);
			lines.push(`) {`);
			lines.push(`\tconst { data, error } = await supabase`);
			lines.push(`\t\t${schemaLine}`);
			lines.push(`\t\t.insert(input)`);
			lines.push(`\t\t.select()`);
			lines.push(`\t\t.single();`);
			lines.push(`\tif (error) throw mapDbError(error, ${Entity.toUpperCase()}_CREATE_ERRORS);`);
			lines.push(`\treturn data;`);
			lines.push(`}`);
		} else if (createMode === "with-owner") {
			lines.push(`export async function create${Entity}(`);
			lines.push(`\tsupabase: SupabaseClient,`);
			lines.push(`\townerId: string,`);
			lines.push(`\tinput: Create${Entity}Input,`);
			if (wsScoped) lines.push(`\tworkspaceId: string,`);
			lines.push(`) {`);
			const insertObj = wsScoped
				? `{ ${ownerFieldName ?? "owner_id"}: ownerId, workspace_id: workspaceId, ...input }`
				: `{ ${ownerFieldName ?? "owner_id"}: ownerId, ...input }`;
			lines.push(`\tconst { data, error } = await supabase`);
			lines.push(`\t\t${schemaLine}`);
			lines.push(`\t\t.insert(${insertObj})`);
			lines.push(`\t\t.select()`);
			lines.push(`\t\t.single();`);
			lines.push(`\tif (error) throw mapDbError(error, ${Entity.toUpperCase()}_CREATE_ERRORS);`);
			lines.push(`\treturn data;`);
			lines.push(`}`);
		} else {
			// standard mode
			lines.push(`export async function create${Entity}(`);
			lines.push(`\tsupabase: SupabaseClient,`);
			lines.push(`\tinput: Create${Entity}Input,`);
			if (wsScoped) lines.push(`\tworkspaceId: string,`);
			lines.push(`) {`);
			const insertObj = wsScoped ? `{ workspace_id: workspaceId, ...input }` : `input`;
			lines.push(`\tconst { data, error } = await supabase`);
			lines.push(`\t\t${schemaLine}`);
			lines.push(`\t\t.insert(${insertObj})`);
			lines.push(`\t\t.select()`);
			lines.push(`\t\t.single();`);
			lines.push(`\tif (error) throw mapDbError(error, ${Entity.toUpperCase()}_CREATE_ERRORS);`);
			lines.push(`\treturn data;`);
			lines.push(`}`);
		}
		lines.push("");
		files.push({ path: `${basePath}/create-${entity}.ts`, content: lines.join("\n") });
	}

	// --- get-<entity>.ts ---
	if (operations.includes("get")) {
		const lines: string[] = [];
		lines.push(`import type { SupabaseClient } from "npm:@supabase/supabase-js@2";`);
		lines.push(`import { NotFoundError } from "${errorsFile}";`);
		lines.push("");
		if (wsScoped) {
			lines.push(
				`export async function get${Entity}(supabase: SupabaseClient, id: string, workspaceId: string) {`,
			);
		} else {
			lines.push(`export async function get${Entity}(supabase: SupabaseClient, id: string) {`);
		}
		lines.push(`\tconst { data, error } = await supabase`);
		lines.push(`\t\t${schemaLine}`);
		lines.push(`\t\t.select()`);
		lines.push(`\t\t.eq("${pkField}", id)`);
		if (wsScoped) lines.push(`\t\t.eq("workspace_id", workspaceId)`);
		lines.push(`\t\t.is("deleted_at", null)`);
		lines.push(`\t\t.single();`);
		lines.push(`\tif (error || !data) throw new NotFoundError("${Entity} not found");`);
		lines.push(`\treturn data;`);
		lines.push(`}`);
		lines.push("");
		files.push({ path: `${basePath}/get-${entity}.ts`, content: lines.join("\n") });
	}

	// --- list-<entities>.ts ---
	if (operations.includes("list")) {
		const listFile = `list-${pluralize(entity)}.ts`;
		const lines: string[] = [];
		lines.push(`import type { SupabaseClient } from "npm:@supabase/supabase-js@2";`);
		lines.push(`import type { List${Plural}Params } from "${schemaFile}";`);
		lines.push(`import { mapDbError } from "${errorsFile}";`);
		lines.push("");
		if (wsScoped) {
			lines.push(
				`export async function list${Plural}(supabase: SupabaseClient, params: List${Plural}Params, workspaceId: string) {`,
			);
		} else {
			lines.push(
				`export async function list${Plural}(supabase: SupabaseClient, params: List${Plural}Params) {`,
			);
		}
		lines.push(`\tlet query = supabase`);
		lines.push(`\t\t${schemaLine}`);
		lines.push(`\t\t.select("*", { count: "exact" })`);
		if (wsScoped) lines.push(`\t\t.eq("workspace_id", workspaceId)`);
		lines.push(`\t\t.is("deleted_at", null)`);
		lines.push(`\t\t.range(params.offset, params.offset + params.limit - 1);`);
		lines.push("");
		if (search_field) {
			lines.push(`\tif (params.search) {`);
			lines.push(`\t\tquery = query.textSearch("${search_field}", params.search, {`);
			lines.push(`\t\t\ttype: "plain",`);
			lines.push(`\t\t\tconfig: "simple",`);
			lines.push(`\t\t});`);
			lines.push(`\t}`);
			lines.push("");
		}
		lines.push(`\tconst { data, error, count } = await query;`);
		lines.push(`\tif (error) throw mapDbError(error);`);
		lines.push(`\treturn { items: data ?? [], total: count ?? 0 };`);
		lines.push(`}`);
		lines.push("");
		files.push({ path: `${basePath}/${listFile}`, content: lines.join("\n") });
	}

	// --- update-<entity>.ts ---
	if (operations.includes("update")) {
		const lines: string[] = [];
		lines.push(`import type { SupabaseClient } from "npm:@supabase/supabase-js@2";`);
		lines.push(`import type { Update${Entity}Input } from "${schemaFile}";`);
		lines.push(`import { NotFoundError, mapDbError } from "${errorsFile}";`);
		lines.push(`import { ${Entity.toUpperCase()}_UPDATE_ERRORS } from "./const-${name}.ts";`);
		lines.push("");
		lines.push(`export async function update${Entity}(`);
		lines.push(`\tsupabase: SupabaseClient,`);
		lines.push(`\tid: string,`);
		lines.push(`\tinput: Update${Entity}Input,`);
		if (wsScoped) lines.push(`\tworkspaceId: string,`);
		lines.push(`) {`);
		lines.push(`\tconst { data, error } = await supabase`);
		lines.push(`\t\t${schemaLine}`);
		lines.push(`\t\t.update(input)`);
		lines.push(`\t\t.eq("${pkField}", id)`);
		if (wsScoped) lines.push(`\t\t.eq("workspace_id", workspaceId)`);
		lines.push(`\t\t.is("deleted_at", null)`);
		lines.push(`\t\t.select()`);
		lines.push(`\t\t.single();`);
		lines.push(`\tif (error) throw mapDbError(error, ${Entity.toUpperCase()}_UPDATE_ERRORS);`);
		lines.push(`\tif (!data) throw new NotFoundError("${Entity} not found");`);
		lines.push(`\treturn data;`);
		lines.push(`}`);
		lines.push("");
		files.push({ path: `${basePath}/update-${entity}.ts`, content: lines.join("\n") });
	}

	// --- delete-<entity>.ts ---
	if (operations.includes("softDelete")) {
		const lines: string[] = [];
		lines.push(`import type { SupabaseClient } from "npm:@supabase/supabase-js@2";`);
		lines.push(`import { mapDbError } from "${errorsFile}";`);
		lines.push("");
		if (wsScoped) {
			lines.push(
				`export async function delete${Entity}(supabase: SupabaseClient, id: string, workspaceId: string) {`,
			);
		} else {
			lines.push(`export async function delete${Entity}(supabase: SupabaseClient, id: string) {`);
		}
		lines.push(`\tconst { error } = await supabase`);
		lines.push(`\t\t${schemaLine}`);
		lines.push(`\t\t.update({ deleted_at: new Date().toISOString() })`);
		lines.push(`\t\t.eq("${pkField}", id)`);
		if (wsScoped) lines.push(`\t\t.eq("workspace_id", workspaceId)`);
		lines.push(`\t\t.is("deleted_at", null);`);
		lines.push(`\tif (error) throw mapDbError(error);`);
		lines.push(`}`);
		lines.push("");
		files.push({ path: `${basePath}/delete-${entity}.ts`, content: lines.join("\n") });
	}

	return files;
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

export function generateEntrypoint(spec: {
	name: string;
	auth_required: boolean;
	service_import: string;
	schema_import: string;
	create_mode?: string;
	pk_field?: string;
	endpoints: Array<{
		method: string;
		path: string;
		handler: string;
		status?: number;
		has_pagination?: boolean;
	}>;
	access?: AccessRule[];
	workspace_scoped?: boolean;
}): string {
	const { name, auth_required: authRequired, service_import, schema_import, endpoints } = spec;
	const access = spec.access ?? [];
	const createMode = spec.create_mode;
	const pkField = spec.pk_field ?? "id";
	const wsScoped = spec.workspace_scoped === true;

	const codeSchema = toCamelCase(schema_import);
	const Entity = capitalize(codeSchema);
	const Plural = capitalize(pluralize(codeSchema));
	const serviceAlias = `${toCamelCase(service_import)}Service`;

	const hasCreate = endpoints.some((e) => e.handler === "create");
	const hasUpdate = endpoints.some((e) => e.handler === "update");
	const hasList = endpoints.some((e) => e.handler === "list" && e.has_pagination);

	const schemaImports: string[] = [];
	if (hasCreate) schemaImports.push(`create${Entity}Schema`);
	if (hasList) schemaImports.push(`list${Plural}ParamsSchema`);
	if (hasUpdate) schemaImports.push(`update${Entity}Schema`);

	const hasAccess = access.length > 0;

	const lines: string[] = [];
	lines.push(`import { handleCors } from "../_shared/core/cors.ts";`);
	lines.push(`import { createSupabaseClient } from "../_shared/core/supabase.ts";`);
	if (authRequired) {
		lines.push(`import { verifyAuth } from "../_shared/core/auth.ts";`);
	}
	lines.push(
		`import { created, fromError, noContent, success } from "../_shared/core/responses.ts";`,
	);
	lines.push(`import { ValidationError } from "../_shared/core/errors.ts";`);
	if (hasAccess) {
		lines.push(`import { checkPermission } from "../_shared/core/rbac.ts";`);
	}
	if (schemaImports.length > 0) {
		lines.push(`import {`);
		for (const imp of schemaImports) {
			lines.push(`  ${imp},`);
		}
		lines.push(`} from "../_shared/schemas/${schema_import}.ts";`);
	}
	lines.push(`import * as ${serviceAlias} from "../_shared/services/${service_import}/index.ts";`);
	lines.push("");

	lines.push(`Deno.serve(async (req: Request) => {`);
	lines.push(`  const corsResponse = handleCors(req);`);
	lines.push(`  if (corsResponse) return corsResponse;`);
	lines.push("");
	lines.push(`  const url = new URL(req.url);`);
	lines.push(`  const path = url.pathname.replace(/^\\/${name}/, "") || "/";`);
	lines.push(`  const idMatch = path.match(/^\\/([0-9a-f-]{36})$/);`);
	lines.push(`  const id = idMatch?.[1];`);
	lines.push("");
	lines.push(`  try {`);
	lines.push(`    const supabase = createSupabaseClient(req);`);

	if (authRequired) {
		if (createMode === "with-owner") {
			lines.push(`    const user = await verifyAuth(req);`);
		} else {
			lines.push(`    await verifyAuth(req);`);
		}
	}

	// Multi-tenant: extract workspace ID from header
	if (wsScoped) {
		lines.push("");
		lines.push(`    const workspaceId = req.headers.get("x-workspace-id");`);
		lines.push(
			`    if (!workspaceId) throw new ValidationError("X-Workspace-Id header is required");`,
		);
	}

	lines.push("");

	for (const ep of endpoints) {
		const method = ep.method as string;
		const hasId = (ep.path as string).includes(":id");
		const handler = ep.handler as string;
		const status = ep.status as number | undefined;
		const hasPagination = ep.has_pagination as boolean | undefined;

		const idCond = hasId ? "id" : "!id";
		lines.push(`    // ${method} ${ep.path as string}`);
		lines.push(`    if (req.method === "${method}" && ${idCond}) {`);

		// RBAC: checkPermission call for defense in depth
		if (hasAccess) {
			lines.push(`      await checkPermission(req, "${name}", "${handler}");`);
		}

		if (handler === "list" && hasPagination) {
			lines.push(`      const rawParams = Object.fromEntries(url.searchParams);`);
			lines.push(`      const parsed = list${Plural}ParamsSchema.safeParse(rawParams);`);
			lines.push(
				`      if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);`,
			);
			if (wsScoped) {
				lines.push(
					`      const result = await ${serviceAlias}.list${Plural}(supabase, parsed.data, workspaceId);`,
				);
			} else {
				lines.push(
					`      const result = await ${serviceAlias}.list${Plural}(supabase, parsed.data);`,
				);
			}
			lines.push(`      return success(result);`);
		} else if (handler === "get") {
			if (wsScoped) {
				lines.push(
					`      const item = await ${serviceAlias}.get${Entity}(supabase, id!, workspaceId);`,
				);
			} else {
				lines.push(`      const item = await ${serviceAlias}.get${Entity}(supabase, id!);`);
			}
			lines.push(`      return success(item);`);
		} else if (handler === "create") {
			lines.push(`      const body = await req.json();`);
			lines.push(`      const parsed = create${Entity}Schema.safeParse(body);`);
			lines.push(
				`      if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);`,
			);
			if (createMode === "with-id") {
				lines.push(`      const item = await ${serviceAlias}.create${Entity}(supabase, {`);
				lines.push(`        ${pkField}: body.${pkField},`);
				lines.push(`        ...parsed.data,`);
				lines.push(`      });`);
			} else if (createMode === "with-owner") {
				if (wsScoped) {
					lines.push(
						`      const item = await ${serviceAlias}.create${Entity}(supabase, user.id, parsed.data, workspaceId);`,
					);
				} else {
					lines.push(
						`      const item = await ${serviceAlias}.create${Entity}(supabase, user.id, parsed.data);`,
					);
				}
			} else {
				if (wsScoped) {
					lines.push(
						`      const item = await ${serviceAlias}.create${Entity}(supabase, parsed.data, workspaceId);`,
					);
				} else {
					lines.push(
						`      const item = await ${serviceAlias}.create${Entity}(supabase, parsed.data);`,
					);
				}
			}
			lines.push(status === 201 ? `      return created(item);` : `      return success(item);`);
		} else if (handler === "update") {
			lines.push(`      const body = await req.json();`);
			lines.push(`      const parsed = update${Entity}Schema.safeParse(body);`);
			lines.push(
				`      if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);`,
			);
			if (wsScoped) {
				lines.push(
					`      const item = await ${serviceAlias}.update${Entity}(supabase, id!, parsed.data, workspaceId);`,
				);
			} else {
				lines.push(
					`      const item = await ${serviceAlias}.update${Entity}(supabase, id!, parsed.data);`,
				);
			}
			lines.push(`      return success(item);`);
		} else if (handler === "softDelete") {
			if (wsScoped) {
				lines.push(`      await ${serviceAlias}.delete${Entity}(supabase, id!, workspaceId);`);
			} else {
				lines.push(`      await ${serviceAlias}.delete${Entity}(supabase, id!);`);
			}
			lines.push(`      return noContent();`);
		}

		lines.push(`    }`);
		lines.push("");
	}

	lines.push(`    return new Response(JSON.stringify({ error: "Not found" }), {`);
	lines.push(`      status: 404,`);
	lines.push(`      headers: { "Content-Type": "application/json" },`);
	lines.push(`    });`);
	lines.push(`  } catch (err) {`);
	lines.push(`    return fromError(err);`);
	lines.push(`  }`);
	lines.push(`});`);
	lines.push("");

	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Auth entrypoint (static — matches demo exactly)
// ---------------------------------------------------------------------------

export function generateAuthEntrypoint(
	_spec: Record<string, unknown>,
	multiTenant = false,
): string {
	if (multiTenant) {
		return `import { handleCors } from "../_shared/core/cors.ts";
import { createServiceClient, createSupabaseClient } from "../_shared/core/supabase.ts";
import { verifyAuth } from "../_shared/core/auth.ts";
import { created, fromError, success } from "../_shared/core/responses.ts";
import { ValidationError } from "../_shared/core/errors.ts";
import { signInSchema, signUpSchema } from "../_shared/schemas/auth.ts";
import { createUser } from "../_shared/services/users/index.ts";

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\\/auth/, "");

  try {
    // POST /auth/signup
    if (req.method === "POST" && path === "/signup") {
      const body = await req.json();
      const parsed = signUpSchema.safeParse(body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues[0].message);
      }
      const { email, password, full_name, workspace_name } = parsed.data;

      const service = createServiceClient();
      const { data, error } = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error) throw new ValidationError(error.message);

      await createUser(service, { user_id: data.user.id, full_name, email });

      // Create default workspace
      const wsName = workspace_name || \`\${full_name}'s Workspace\`;
      const { data: workspace, error: wsError } = await service
        .schema("rbac")
        .from("workspaces")
        .insert({
          name: wsName,
          slug: data.user.id,
          owner_id: data.user.id,
        })
        .select()
        .single();
      if (wsError) throw new ValidationError(wsError.message);

      // Assign user to workspace with default role
      const { data: defaultRole } = await service
        .schema("rbac")
        .from("roles")
        .select("role_id")
        .eq("is_default", true)
        .single();
      if (defaultRole && workspace) {
        await service
          .schema("rbac")
          .from("workspace_users")
          .insert({
            workspace_id: workspace.workspace_id,
            user_id: data.user.id,
            role_id: defaultRole.role_id,
          });
      }

      const supabase = createSupabaseClient(req);
      const { data: session, error: signInError } =
        await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw new ValidationError(signInError.message);

      return created({ user: data.user, session: session.session, workspace });
    }

    // POST /auth/signin
    if (req.method === "POST" && path === "/signin") {
      const body = await req.json();
      const parsed = signInSchema.safeParse(body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues[0].message);
      }

      const supabase = createSupabaseClient(req);
      const { data, error } = await supabase.auth.signInWithPassword(
        parsed.data,
      );
      if (error) throw new ValidationError(error.message);

      return success({ user: data.user, session: data.session });
    }

    // POST /auth/signout
    if (req.method === "POST" && path === "/signout") {
      await verifyAuth(req);
      const supabase = createSupabaseClient(req);
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      return success({ message: "Signed out" });
    }

    // GET /auth/me
    if (req.method === "GET" && path === "/me") {
      const user = await verifyAuth(req);
      return success({ user });
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return fromError(err);
  }
});
`;
	}

	return `import { handleCors } from "../_shared/core/cors.ts";
import { createServiceClient, createSupabaseClient } from "../_shared/core/supabase.ts";
import { verifyAuth } from "../_shared/core/auth.ts";
import { created, fromError, success } from "../_shared/core/responses.ts";
import { ValidationError } from "../_shared/core/errors.ts";
import { signInSchema, signUpSchema } from "../_shared/schemas/auth.ts";
import { createUser } from "../_shared/services/users/index.ts";

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\\/auth/, "");

  try {
    // POST /auth/signup
    if (req.method === "POST" && path === "/signup") {
      const body = await req.json();
      const parsed = signUpSchema.safeParse(body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues[0].message);
      }
      const { email, password, full_name } = parsed.data;

      const service = createServiceClient();
      const { data, error } = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error) throw new ValidationError(error.message);

      await createUser(service, { user_id: data.user.id, full_name, email });

      // Assign default role (is_default = true in rbac.roles)
      const { data: defaultRole } = await service
        .schema("rbac")
        .from("roles")
        .select("role_id")
        .eq("is_default", true)
        .single();
      if (defaultRole) {
        await service
          .schema("rbac")
          .from("user_roles")
          .insert({ user_id: data.user.id, role_id: defaultRole.role_id });
      }

      const supabase = createSupabaseClient(req);
      const { data: session, error: signInError } =
        await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw new ValidationError(signInError.message);

      return created({ user: data.user, session: session.session });
    }

    // POST /auth/signin
    if (req.method === "POST" && path === "/signin") {
      const body = await req.json();
      const parsed = signInSchema.safeParse(body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues[0].message);
      }

      const supabase = createSupabaseClient(req);
      const { data, error } = await supabase.auth.signInWithPassword(
        parsed.data,
      );
      if (error) throw new ValidationError(error.message);

      return success({ user: data.user, session: data.session });
    }

    // POST /auth/signout
    if (req.method === "POST" && path === "/signout") {
      await verifyAuth(req);
      const supabase = createSupabaseClient(req);
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      return success({ message: "Signed out" });
    }

    // GET /auth/me
    if (req.method === "GET" && path === "/me") {
      const user = await verifyAuth(req);
      return success({ user });
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return fromError(err);
  }
});
`;
}

// ---------------------------------------------------------------------------
// Database (SQL generation + migration file creation)
// ---------------------------------------------------------------------------

export function generateDatabaseSchema(
	schema: SchemaSection,
	brickName: string,
	registry: BrickRegistry,
	access: AccessRule[] = [],
	multiTenant = false,
): string {
	const lines: string[] = [];
	// DDL workspace scoping depends only on schema-level guards — no api needed here.
	const wsScoped =
		multiTenant &&
		!!schema.table &&
		schema.workspace_scoped !== false &&
		inferCreateMode(schema) !== "with-id";

	// In multi-tenant mode, workspace table + infrastructure SQL is in the RBAC init migration.
	// Only emit permissions seed here.
	if (brickName === "workspaces" && multiTenant) {
		if (access.length > 0) lines.push(rbacPermissionsSeedSql(brickName, access));
		return lines.join("\n");
	}

	if (brickName === "identification_types") {
		lines.push(...generateUpdateUpdatedAtLines());
		lines.push("");
		lines.push("-- Reference table for identification document types (Colombia + international)");
		lines.push("");
	}

	lines.push(...generateTableSQL(schema, registry, brickName, wsScoped));

	if (brickName === "identification_types") {
		lines.push(...generateIdentificationTypesSeed());
	}

	// Append RBAC permission seeds
	if (access.length > 0) {
		lines.push(rbacPermissionsSeedSql(brickName, access));
	}

	return lines.join("\n");
}

function generateUpdateUpdatedAtLines(): string[] {
	return [
		"-- Core utilities shared across all schemas",
		"",
		"create or replace function update_updated_at()",
		"returns trigger",
		"language plpgsql",
		"as $$",
		"begin",
		"  new.updated_at = now();",
		"  return new;",
		"end;",
		"$$;",
	];
}

function generateTableSQL(
	schema: SchemaSection,
	registry: BrickRegistry,
	brickName?: string,
	workspaceScoped = false,
): string[] {
	const { primary_key, fields = [], indexes = [] } = schema;
	const table = schema.table ?? "";
	const dbSchema = schema.db_schema ?? "public";
	const qualifiedTable = `${dbSchema}.${table}`;
	const lines: string[] = [];

	// For non-public schemas, ensure the schema exists and grant standard Supabase role permissions
	if (dbSchema !== "public") {
		lines.push(`create schema if not exists ${dbSchema};`);
		lines.push("");
		lines.push(`grant usage on schema ${dbSchema} to anon, authenticated, service_role;`);
		lines.push(
			`grant all on all tables in schema ${dbSchema} to anon, authenticated, service_role;`,
		);
		lines.push(
			`grant all on all routines in schema ${dbSchema} to anon, authenticated, service_role;`,
		);
		lines.push(
			`grant all on all sequences in schema ${dbSchema} to anon, authenticated, service_role;`,
		);
		lines.push(
			`alter default privileges for role postgres in schema ${dbSchema} grant all on tables to anon, authenticated, service_role;`,
		);
		lines.push(
			`alter default privileges for role postgres in schema ${dbSchema} grant all on routines to anon, authenticated, service_role;`,
		);
		lines.push(
			`alter default privileges for role postgres in schema ${dbSchema} grant all on sequences to anon, authenticated, service_role;`,
		);
		lines.push("");
	}

	lines.push(`create table if not exists ${qualifiedTable} (`);

	// Primary key column first
	const pkField = fields.find((f) => f.name === primary_key);
	if (pkField) {
		lines.push(`  ${fieldToSql(pkField, registry, true)},`);
	}

	// Workspace ID column (injected after PK for workspace-scoped tables)
	if (workspaceScoped) {
		lines.push("  workspace_id uuid not null references rbac.workspaces(workspace_id),");
	}

	// Other columns
	for (const field of fields) {
		if (field.name === primary_key) continue;
		lines.push(`  ${fieldToSql(field, registry, false)},`);
	}

	lines.push("  created_at timestamptz not null default now(),");
	lines.push("  updated_at timestamptz not null default now(),");
	lines.push("  deleted_at timestamptz");
	lines.push(");");
	lines.push("");

	// Indexes
	for (const idx of indexes) {
		lines.push(...generateIndexSQL(table, idx, dbSchema));
		lines.push("");
	}

	// Trigger
	lines.push(`create trigger ${table}_updated_at`);
	lines.push(`  before update on ${qualifiedTable}`);
	lines.push("  for each row execute function update_updated_at();");
	lines.push("");

	// RBAC-based RLS — all tables use the same pattern delegating to has_permission()
	if (brickName) {
		const ownerF = getOwnerField(schema);
		const ownerExpr = ownerF ? ownerF.name : "NULL";
		// Workspace-scoped tables pass workspace_id as 4th arg to has_permission()
		const wsExpr = workspaceScoped ? ", workspace_id" : "";

		lines.push(`alter table ${qualifiedTable} enable row level security;`);
		lines.push("");

		// SELECT: list + get
		// NOTE: deleted_at filtering is handled at the application level (service queries),
		// NOT in the RLS policy. Including `deleted_at is null` here would cause PostgreSQL
		// to reject UPDATE statements that set deleted_at (soft delete), because PG evaluates
		// the SELECT policy against the NEW row during UPDATE operations.
		lines.push(`create policy "rbac_select_${table}" on ${qualifiedTable}`);
		lines.push("  for select to authenticated");
		lines.push(`  using (rbac.has_permission('${brickName}', 'get', ${ownerExpr}${wsExpr}));`);
		lines.push("");

		// INSERT: create
		lines.push(`create policy "rbac_insert_${table}" on ${qualifiedTable}`);
		lines.push("  for insert to authenticated");
		lines.push(
			`  with check (rbac.has_permission('${brickName}', 'create', ${ownerExpr}${wsExpr}));`,
		);
		lines.push("");

		// UPDATE: update + softDelete
		// USING filters which rows can be updated (only non-deleted rows with permission).
		// WITH CHECK validates the new row state — omits `deleted_at is null` so soft delete
		// (setting deleted_at to a timestamp) is allowed.
		lines.push(`create policy "rbac_update_${table}" on ${qualifiedTable}`);
		lines.push("  for update to authenticated");
		lines.push(
			`  using (rbac.has_permission('${brickName}', 'update', ${ownerExpr}${wsExpr}) and deleted_at is null)`,
		);
		lines.push(
			`  with check (rbac.has_permission('${brickName}', 'update', ${ownerExpr}${wsExpr}));`,
		);
		lines.push("");

		// Service role: full bypass
		lines.push(`create policy "service_role_${table}" on ${qualifiedTable}`);
		lines.push("  for all to service_role");
		lines.push("  using (true);");
		lines.push("");
	}

	return lines;
}

function generateIndexSQL(
	table: string,
	idx: { name: string; columns: string[]; type?: string; expression?: string; where?: string },
	dbSchema = "public",
): string[] {
	const lines: string[] = [];
	const { name, columns, type: idxType, expression, where } = idx;
	const qualifiedTable = `${dbSchema}.${table}`;

	if (idxType === "unique") {
		lines.push(`create unique index if not exists ${name}`);
		lines.push(
			`  on ${qualifiedTable} (${columns.join(", ")})${where ? `\n  where ${where}` : ""};`,
		);
	} else if (idxType === "gin") {
		if (expression) {
			lines.push(`create index if not exists ${name}`);
			lines.push(`  on ${qualifiedTable} using gin(${expression});`);
		} else {
			lines.push(`create index if not exists ${name}`);
			lines.push(`  on ${qualifiedTable} using gin (${columns.join(", ")});`);
		}
	} else {
		lines.push(`create index if not exists ${name}`);
		lines.push(`  on ${qualifiedTable} (${columns.join(", ")})${where ? ` where ${where}` : ""};`);
	}

	return lines;
}

function generateIdentificationTypesSeed(): string[] {
	return [
		"-- Seed: Colombian + common international identification types",
		"insert into public.identification_types (slug, name, description, format) values",
		"  ('NIT',       'NIT',                        'Número de Identificación Tributaria',   '999.999.999-9'),",
		"  ('CC',        'Cédula de Ciudadanía',        'Documento de identidad colombiano',     '1.234.567.890'),",
		"  ('TI',        'Tarjeta de Identidad',        'Menores de edad colombianos (10-17)',   '1234567890'),",
		"  ('RC',        'Registro Civil',              'Menores de edad colombianos (0-9)',     '1234567890'),",
		"  ('CE',        'Cédula de Extranjería',       'Extranjeros residentes en Colombia',    '1234567890'),",
		"  ('PASAPORTE', 'Pasaporte',                   'Documento de viaje internacional',      'AB123456'),",
		"  ('PEP',       'PEP',                         'Permiso Especial de Permanencia',       'PEP1234567890'),",
		"  ('PPT',       'PPT',                         'Permiso por Protección Temporal',       'PPT1234567890'),",
		"  ('RUT',       'RUT',                         'Registro Único Tributario',             '999.999.999-9')",
		"on conflict (slug) do nothing;",
		"",
	];
}

// Module-level counter for unique timestamps in the test/no-projectPath fallback
let _lastFallbackTs = "";
let _fallbackCounter = 0;

function nextFallbackTs(): string {
	const ts = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
	if (ts === _lastFallbackTs) {
		_fallbackCounter++;
		return `${ts}${String(_fallbackCounter).padStart(2, "0")}`;
	}
	_lastFallbackTs = ts;
	_fallbackCounter = 0;
	return ts;
}

/** Returns the sorted list of .sql filenames inside supabase/migrations/. */
async function listMigrationFiles(projectPath: string): Promise<string[]> {
	try {
		const entries = await readdir(join(projectPath, "supabase/migrations"));
		return entries.filter((f) => f.endsWith(".sql")).sort();
	} catch {
		return [];
	}
}

/**
 * Polls until no existing migration starts with the current second's timestamp,
 * guaranteeing each `supabase migration new` call lands in a fresh second.
 */
async function waitForUniqueSecond(projectPath: string): Promise<void> {
	for (;;) {
		const currentTs = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
		const existing = await listMigrationFiles(projectPath);
		const conflict = existing.some((f) => f.startsWith(currentTs));
		if (!conflict) return;
		await new Promise((r) => setTimeout(r, 100));
	}
}

async function generateDatabaseFiles(
	schema: SchemaSection,
	brickName: string,
	registry: BrickRegistry,
	context: GenerationContext,
	access: AccessRule[] = [],
	multiTenant = false,
): Promise<GeneratedFile[]> {
	const sql = generateDatabaseSchema(schema, brickName, registry, access, multiTenant);
	const migrationName = brickName;

	if (context.projectPath && !context.dryRun) {
		const { runSupabase } = await import("./supabase.ts");

		await waitForUniqueSecond(context.projectPath);

		const before = new Set(await listMigrationFiles(context.projectPath));

		const result = runSupabase(["migration", "new", migrationName], {
			cwd: context.projectPath,
		});

		if (result.exitCode !== 0) {
			throw new BrickendError(
				`supabase migration new ${migrationName} failed: ${result.stderr}`,
				"MIGRATION_FAILED",
				{ migrationName, stderr: result.stderr },
			);
		}

		const after = await listMigrationFiles(context.projectPath);
		const newFile = after.find((f) => !before.has(f));

		if (!newFile) {
			throw new BrickendError(
				`supabase migration new ${migrationName} succeeded but no new file was found in supabase/migrations/`,
				"MIGRATION_FAILED",
				{ migrationName },
			);
		}

		const migPath = `supabase/migrations/${newFile}`;
		await Bun.write(join(context.projectPath, migPath), sql);
		return [{ path: migPath, content: sql, skipWrite: true }];
	}

	// No projectPath (unit tests / offline use)
	const ts = nextFallbackTs();
	return [{ path: `supabase/migrations/${ts}_${migrationName}.sql`, content: sql }];
}

// ---------------------------------------------------------------------------
// ALTER TABLE migration (used by `brickend generate`)
// ---------------------------------------------------------------------------

export function generateAlterMigrationSql(
	schema: SchemaSection,
	brickName: string,
	registry: BrickRegistry,
	diff: BrickSpecDiff,
	access: AccessRule[] = [],
	_multiTenant = false,
): string {
	const lines: string[] = [];
	const dbSchema = schema.db_schema ?? "public";
	const qualifiedTable = dbSchema === "public" ? schema.table : `${dbSchema}.${schema.table}`;

	if (!schema.table) {
		// Auth bricks or bricks with no table — only handle access changes
		if (diff.accessChanged && access.length > 0) {
			lines.push(`DELETE FROM rbac.permissions WHERE resource = '${brickName}';`);
			lines.push(rbacPermissionsSeedSql(brickName, access));
		}
		return lines.join("\n");
	}

	// Added columns
	for (const field of diff.fieldsAdded) {
		const sqlType = fieldToSqlType(field);
		const notNull = field.required ? " NOT NULL" : "";
		const def = field.default ? ` DEFAULT ${field.default}` : "";
		let ref = "";
		if (field.references === "auth") {
			ref = " REFERENCES auth.users(id) ON DELETE CASCADE";
		} else if (field.references) {
			const refSpec = registry[field.references];
			if (refSpec) {
				const refSchema = refSpec.db_schema ?? "public";
				ref = ` REFERENCES ${refSchema}.${refSpec.table}(${refSpec.pk})`;
			}
		}

		if (field.required && !field.default) {
			lines.push(
				`-- WARNING: Adding NOT NULL column without DEFAULT to a table with existing rows will fail.`,
			);
			lines.push(
				`-- Consider adding a DEFAULT or making the column nullable, then backfilling data.`,
			);
		}
		lines.push(
			`ALTER TABLE ${qualifiedTable} ADD COLUMN ${field.name} ${sqlType}${notNull}${def}${ref};`,
		);
	}

	// Removed columns
	for (const field of diff.fieldsRemoved) {
		lines.push(`ALTER TABLE ${qualifiedTable} DROP COLUMN IF EXISTS ${field.name};`);
	}

	// Changed columns (safe approach: emit TODO comments)
	for (const { old: oldField, new: newField } of diff.fieldsChanged) {
		lines.push(
			`-- TODO: Manually alter column "${newField.name}" (type: ${oldField.type} -> ${newField.type}, required: ${oldField.required ?? false} -> ${newField.required ?? false})`,
		);
	}

	// Access changes
	if (diff.accessChanged && access.length > 0) {
		lines.push("");
		lines.push(`DELETE FROM rbac.permissions WHERE resource = '${brickName}';`);
		lines.push(rbacPermissionsSeedSql(brickName, access));
	}

	return lines.join("\n");
}

export async function generateAlterMigrationFiles(
	sql: string,
	brickName: string,
	projectPath?: string,
	dryRun = false,
): Promise<GeneratedFile[]> {
	if (!sql.trim()) return [];

	const migrationName = `alter_${brickName}`;

	if (projectPath && !dryRun) {
		const { runSupabase } = await import("./supabase.ts");
		await waitForUniqueSecond(projectPath);

		const before = new Set(await listMigrationFiles(projectPath));
		const result = runSupabase(["migration", "new", migrationName], { cwd: projectPath });

		if (result.exitCode !== 0) {
			throw new BrickendError(
				`supabase migration new ${migrationName} failed: ${result.stderr}`,
				"MIGRATION_FAILED",
				{ migrationName, stderr: result.stderr },
			);
		}

		const after = await listMigrationFiles(projectPath);
		const newFile = after.find((f) => !before.has(f));

		if (!newFile) {
			throw new BrickendError(
				`supabase migration new ${migrationName} succeeded but no new file was found`,
				"MIGRATION_FAILED",
				{ migrationName },
			);
		}

		const migPath = `supabase/migrations/${newFile}`;
		await Bun.write(join(projectPath, migPath), sql);
		return [{ path: migPath, content: sql, skipWrite: true }];
	}

	const ts = nextFallbackTs();
	return [{ path: `supabase/migrations/${ts}_${migrationName}.sql`, content: sql }];
}

// ---------------------------------------------------------------------------
// Deno config
// ---------------------------------------------------------------------------

export function generateDenoConfig(): string {
	return JSON.stringify(
		{
			imports: {
				"npm:@supabase/supabase-js@2": "npm:@supabase/supabase-js@2",
				"npm:zod@4": "npm:zod@4",
			},
		},
		null,
		2,
	);
}

// ---------------------------------------------------------------------------
// supabase db diff helper (legacy — kept for reference)
// ---------------------------------------------------------------------------

export async function runDbDiff(projectPath: string, brickName: string): Promise<string | null> {
	const { runSupabase } = await import("./supabase.ts");
	const result = runSupabase(["db", "diff", "-f", `add_${brickName}`], { cwd: projectPath });

	if (result.exitCode !== 0) {
		return null;
	}

	const match = result.stdout.trim().match(/supabase\/migrations\/\S+\.sql/);
	return match ? match[0] : null;
}
