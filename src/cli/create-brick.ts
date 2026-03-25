import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import * as p from "@clack/prompts";
import chalk from "chalk";
import { stringify as stringifyYaml } from "yaml";
import { createBrickLoader } from "../core/brick-loader.ts";
import type { BrickSpec, Endpoint, FieldDef } from "../core/brick-spec.ts";
import { BrickSpecSchema } from "../core/brick-spec.ts";
import { BrickendError } from "../core/errors.ts";
import { loadState, saveState } from "../core/state.ts";
import { generateCommand } from "./generate.ts";

const BRICK_NAME_REGEX = /^[a-z][a-z0-9_]*$/;

const VALID_FIELD_TYPES = ["string", "text", "email", "uuid", "boolean", "numeric", "url"];

const VALID_HANDLERS = ["list", "get", "create", "update", "softDelete"] as const;

const ENDPOINT_TEMPLATES: Record<string, Omit<Endpoint, "handler">> = {
	list: { method: "GET", path: "/", has_pagination: true },
	get: { method: "GET", path: "/:id" },
	create: { method: "POST", path: "/", status: 201 },
	update: { method: "PATCH", path: "/:id" },
	softDelete: { method: "DELETE", path: "/:id", status: 204 },
};

export interface CreateBrickOptions {
	table?: string;
	primaryKey?: string;
	fields?: string;
	owner?: boolean;
	endpoints?: string;
	authRequired?: boolean;
	searchField?: string;
	requires?: string;
	description?: string;
	version?: string;
	dryRun?: boolean;
	noGenerate?: boolean;
	noWorkspace?: boolean;
}

/**
 * Parse a comma-separated field definitions string into FieldDef[].
 * Format: "name:type[:required][:nullable][:ref=brick]"
 */
export function parseFieldDefs(fieldsStr: string): FieldDef[] {
	return fieldsStr.split(",").map((fieldStr) => {
		const parts = fieldStr.trim().split(":");
		if (parts.length < 2 || !parts[0] || !parts[1]) {
			throw new BrickendError(
				`Invalid field format "${fieldStr.trim()}". Expected "name:type[:required][:nullable][:ref=brick]"`,
				"INVALID_FIELD_FORMAT",
			);
		}

		const [name, type, ...modifiers] = parts as [string, string, ...string[]];

		if (!VALID_FIELD_TYPES.includes(type)) {
			throw new BrickendError(
				`Invalid field type "${type}" for field "${name}". Must be one of: ${VALID_FIELD_TYPES.join(", ")}`,
				"INVALID_FIELD_TYPE",
			);
		}

		const field: FieldDef = { name, type: type as FieldDef["type"] };
		for (const mod of modifiers) {
			if (mod === "required") field.required = true;
			else if (mod === "nullable") field.nullable = true;
			else if (mod.startsWith("ref=")) {
				const ref = mod.slice(4);
				if (!ref) {
					throw new BrickendError(
						`Empty reference in field "${name}". Use "ref=brick_name"`,
						"INVALID_FIELD_FORMAT",
					);
				}
				field.references = ref;
			} else {
				throw new BrickendError(
					`Unknown field modifier "${mod}" for field "${name}". Valid modifiers: required, nullable, ref=<brick>`,
					"INVALID_FIELD_FORMAT",
				);
			}
		}
		return field;
	});
}

/** Singularize a table name for PK naming: strip trailing 's'. */
function singularize(name: string): string {
	return name.endsWith("s") ? name.slice(0, -1) : name;
}

/** Build endpoints from handler names or return all five defaults. */
function buildEndpoints(handlersStr?: string): Endpoint[] {
	const handlers = handlersStr ? handlersStr.split(",").map((h) => h.trim()) : [...VALID_HANDLERS];

	return handlers.map((handler) => {
		const template = ENDPOINT_TEMPLATES[handler];
		if (!template) {
			throw new BrickendError(
				`Unknown endpoint handler "${handler}". Valid handlers: ${VALID_HANDLERS.join(", ")}`,
				"INVALID_ENDPOINT",
			);
		}
		return { ...template, handler };
	});
}

export async function createBrickCommand(
	name: string,
	options: CreateBrickOptions = {},
): Promise<void> {
	const projectDir = process.cwd();
	const dryRun = options.dryRun ?? false;

	p.intro(chalk.bold(`brickend create-brick ${name}${dryRun ? chalk.dim("  [dry run]") : ""}`));

	// 1. Validate brick name
	if (!BRICK_NAME_REGEX.test(name)) {
		throw new BrickendError(
			`Invalid brick name "${name}". Use lowercase letters, numbers, and underscores. Must start with a letter.`,
			"INVALID_BRICK_NAME",
		);
	}

	// 2. Load project state
	const state = await loadState(projectDir);

	// 3. Check for name conflicts
	if (state.bricks[name]) {
		throw new BrickendError(
			`Brick "${name}" already exists in this project. Use \`brickend generate ${name}\` to regenerate.`,
			"BRICK_NAME_CONFLICT",
		);
	}

	const brickLoader = createBrickLoader();
	const catalogBricks = await brickLoader.listAvailableBricks();
	if (catalogBricks.some((s) => s.brick.name === name)) {
		throw new BrickendError(
			`Brick "${name}" exists in the Brickend catalog. Choose a different name to avoid conflicts with \`brickend add\`.`,
			"BRICK_NAME_RESERVED",
		);
	}

	// 4. Derive defaults
	const multiTenant = state.settings?.multi_tenant === true;
	const tableName = options.table ?? name;
	const version = options.version ?? "1.0.0";
	const description = options.description ?? "";
	const authRequired = options.authRequired ?? true;
	const pkName = options.primaryKey ?? `${singularize(tableName)}_id`;

	// 5. Build fields
	const fields: FieldDef[] = [{ name: pkName, type: "uuid", default: "gen_random_uuid()" }];

	if (options.owner) {
		fields.push({ name: "owner_id", type: "uuid", references: "auth" });
	}

	if (options.fields) {
		fields.push(...parseFieldDefs(options.fields));
	}

	// 5b. Validate no duplicate field names
	const allFieldNames = fields.map((f) => f.name);
	const dupes = allFieldNames.filter((n, i) => allFieldNames.indexOf(n) !== i);
	if (dupes.length > 0) {
		throw new BrickendError(
			`Duplicate field names: ${[...new Set(dupes)].join(", ")}`,
			"INVALID_FIELD_FORMAT",
		);
	}

	// 6. Build endpoints
	const endpoints = buildEndpoints(options.endpoints);
	const handlerNames = endpoints.map((e) => e.handler);

	// 7. Build access rules from project roles
	const access = (state.roles ?? []).map((role) => ({
		role: role.name,
		actions: [...handlerNames],
		own_only: options.owner ? !role.is_default : false,
	}));

	// 8. Build requires
	const requires: Array<{ brick: string; version: string }> = [];
	if (options.requires) {
		for (const dep of options.requires.split(",").map((d) => d.trim())) {
			if (dep) requires.push({ brick: dep, version: ">=1.0.0" });
		}
	}

	// Auto-add auth if --owner and not already in requires
	if (options.owner && !requires.some((r) => r.brick === "auth")) {
		requires.unshift({ brick: "auth", version: ">=1.0.0" });
	}

	// Auto-add referenced bricks (non-auth) to requires
	for (const field of fields) {
		if (
			field.references &&
			field.references !== "auth" &&
			!requires.some((r) => r.brick === field.references)
		) {
			requires.push({ brick: field.references, version: ">=1.0.0" });
		}
	}

	// Auto-add workspaces requirement for multi-tenant projects
	const isWithId = fields.some((f) => f.name === pkName && f.references === "auth");
	const applyWorkspace = multiTenant && !options.noWorkspace && !isWithId;
	if (applyWorkspace && !requires.some((r) => r.brick === "workspaces")) {
		requires.push({ brick: "workspaces", version: ">=1.0.0" });
	}

	// Warn about uninstalled references
	for (const req of requires) {
		if (!state.bricks[req.brick]) {
			const inCatalog = catalogBricks.some((s) => s.brick.name === req.brick);
			if (inCatalog) {
				p.log.warn(
					`Dependency "${req.brick}" is not installed. Run \`brickend add ${req.brick}\` before generating.`,
				);
			} else {
				p.log.warn(`Dependency "${req.brick}" is not installed and not in the catalog.`);
			}
		}
	}

	// 9. Validate search field
	if (options.searchField) {
		const fieldNames = fields.map((f) => f.name);
		if (!fieldNames.includes(options.searchField)) {
			throw new BrickendError(
				`Search field "${options.searchField}" not found in fields: ${fieldNames.join(", ")}`,
				"INVALID_SEARCH_FIELD",
			);
		}
	}

	// 10. Assemble brick spec
	const specRaw = {
		brick: { name, version, description },
		requires,
		config: {},
		schema: {
			table: tableName,
			primary_key: pkName,
			...(applyWorkspace ? { workspace_scoped: true } : {}),
			fields,
			indexes: [],
			constraints: { create: {}, update: {} },
		},
		access,
		api: {
			auth_required: authRequired,
			...(options.searchField ? { search_field: options.searchField } : {}),
			endpoints,
		},
	};

	// Validate with Zod schema
	const parseResult = BrickSpecSchema.safeParse(specRaw);
	if (!parseResult.success) {
		throw new BrickendError(
			`Generated spec is invalid: ${parseResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`,
			"BRICK_INVALID",
		);
	}

	const spec: BrickSpec = parseResult.data;

	// 11. Serialize to YAML
	const yamlContent = stringifyYaml(JSON.parse(JSON.stringify(spec)), { lineWidth: 120 });

	// 12. Dry-run: print and exit
	if (dryRun) {
		console.log(yamlContent);
		p.outro(chalk.dim("No files created  (dry run)"));
		return;
	}

	// 13. Write manifest
	const manifestDir = join(projectDir, "brickend", name);
	await mkdir(manifestDir, { recursive: true });
	const manifestPath = join(manifestDir, `${name}.bricks.yaml`);
	await Bun.write(manifestPath, yamlContent);
	p.log.success(`Manifest created: brickend/${name}/${name}.bricks.yaml`);

	// 14. Register in state (no specSnapshot — generate treats first run as full generation)
	state.bricks[name] = {
		version,
		type: "brick",
		installed_at: new Date().toISOString(),
		config: {},
		files: [],
		fileHashes: {},
	};
	await saveState(projectDir, state);

	// 15. Auto-generate code (unless --no-generate)
	if (options.noGenerate) {
		p.outro(
			`Run ${chalk.cyan(`brickend generate ${name}`)} to generate code, services, and migrations.`,
		);
	} else {
		await generateCommand(name, { reset: false });
	}
}
