import { describe, expect, it } from "bun:test";
import type { BrickSpec } from "../../src/core/brick-loader.ts";
import {
	generateAuthEntrypoint,
	generateAuthSchema,
	generateBrickFiles,
	generateDatabaseSchema,
	generateDenoConfig,
	generateEntrypoint,
	generateSchema,
	generateServiceFiles,
	resolveConfigReferences,
} from "../../src/core/generator.ts";
import { initState } from "../../src/core/state.ts";

describe("Generator", () => {
	describe("resolveConfigReferences", () => {
		it("replaces $config references with actual values", () => {
			const spec = { name: "test", types: "$config.identification_types" };
			const config = { identification_types: ["NIT", "CC", "CE"] };
			const resolved = resolveConfigReferences(spec, config);
			expect(resolved.types).toEqual(["NIT", "CC", "CE"]);
		});

		it("resolves nested objects", () => {
			const spec = { outer: { inner: "$config.key" } };
			const config = { key: "value" };
			const resolved = resolveConfigReferences(spec, config);
			expect((resolved.outer as Record<string, unknown>).inner).toBe("value");
		});

		it("resolves array of objects", () => {
			const spec = { items: [{ val: "$config.x" }] };
			const config = { x: 42 };
			const resolved = resolveConfigReferences(spec, config);
			expect((resolved.items as Array<Record<string, unknown>>)[0]?.val).toBe(42);
		});

		it("leaves non-config strings unchanged", () => {
			const spec = { name: "hello", count: 5 };
			const resolved = resolveConfigReferences(spec, {});
			expect(resolved.name).toBe("hello");
			expect(resolved.count).toBe(5);
		});
	});

	describe("generateSchema", () => {
		it("uses npm:zod@4", () => {
			const output = generateSchema("entity", { fields: [] });
			expect(output).toContain('import { z } from "npm:zod@4"');
		});

		it("generates main schema, create, update, list params schemas", () => {
			const output = generateSchema("entity", {
				fields: [
					{ name: "name", type: "string", required: true },
					{ name: "email", type: "email", nullable: true },
				],
			});

			expect(output).toContain("export const entitySchema = z.object({");
			expect(output).toContain("name: z.string()");
			expect(output).toContain("email: z.string().email().nullable()");
			expect(output).toContain("deleted_at: z.string().nullable()");
			expect(output).toContain("export const createEntitySchema = z.object({");
			expect(output).toContain("export const updateEntitySchema = z.object({");
			expect(output).toContain(".refine((d) => Object.keys(d).length > 0");
			expect(output).toContain("export const listEntitiesParamsSchema = z.object({");
			expect(output).toContain("z.coerce.number()");
		});

		it("excludes PK and owner fields from create/update schemas", () => {
			const output = generateSchema("entity", {
				primary_key: "entity_id",
				fields: [
					{ name: "entity_id", type: "uuid", default: "gen_random_uuid()" },
					{ name: "owner_id", type: "uuid", references: "auth" },
					{ name: "name", type: "string", required: true },
				],
			});

			expect(output).toContain("owner_id: z.string().uuid()"); // in main schema
			expect(output).toContain("entity_id: z.string().uuid()"); // in main schema
			const createIdx = output.indexOf("createEntitySchema");
			const updateIdx = output.indexOf("updateEntitySchema");
			// owner_id and entity_id should NOT appear in create schema
			expect(output.slice(createIdx, updateIdx)).not.toContain("owner_id");
			expect(output.slice(createIdx, updateIdx)).not.toContain("entity_id");
		});

		it("generates correct plural form for 'entity'", () => {
			const output = generateSchema("entity", { fields: [] });
			expect(output).toContain("listEntitiesParamsSchema");
			expect(output).toContain("ListEntitiesParams");
		});

		it("generates correct plural form for 'user'", () => {
			const output = generateSchema("user", { fields: [] });
			expect(output).toContain("listUsersParamsSchema");
			expect(output).toContain("ListUsersParams");
		});

		it("exports Input type names", () => {
			const output = generateSchema("user", { fields: [] });
			expect(output).toContain("export type User =");
			expect(output).toContain("export type CreateUserInput =");
			expect(output).toContain("export type UpdateUserInput =");
		});
	});

	describe("generateAuthSchema", () => {
		it("generates signUpSchema and signInSchema from endpoint bodies", () => {
			const output = generateAuthSchema({
				type: "auth",
				auth_required: false,
				endpoints: [
					{
						method: "POST",
						path: "/signup",
						handler: "signup",
						status: 201,
						body: [
							{ name: "email", type: "email", required: true },
							{ name: "password", type: "string", required: true },
							{ name: "full_name", type: "string", required: true },
						],
					},
					{
						method: "POST",
						path: "/signin",
						handler: "signin",
						body: [
							{ name: "email", type: "email", required: true },
							{ name: "password", type: "string", required: true },
						],
					},
				],
			});

			expect(output).toContain('import { z } from "npm:zod@4"');
			expect(output).toContain("export const signUpSchema");
			expect(output).toContain("export const signInSchema");
			expect(output).toContain("export type SignUpInput");
			expect(output).toContain("export type SignInInput");
			expect(output).toContain("email: z.string().email()");
			expect(output).toContain("full_name: z.string()");
		});
	});

	describe("generateServiceFiles", () => {
		it("generates multi-file service bundle", () => {
			const files = generateServiceFiles("supabase/functions/_shared/services/entities", {
				name: "entities",
				entity: "entity",
				schema_import: "entity",
				table: "entities",
				operations: ["create", "get", "list", "update", "softDelete"],
				create_mode: "standard",
				search_field: "name",
				constraints: {},
			});

			const paths = files.map((f) => f.path);
			expect(paths).toContain("supabase/functions/_shared/services/entities/index.ts");
			expect(paths).toContain("supabase/functions/_shared/services/entities/const-entities.ts");
			expect(paths).toContain("supabase/functions/_shared/services/entities/create-entity.ts");
			expect(paths).toContain("supabase/functions/_shared/services/entities/get-entity.ts");
			expect(paths).toContain("supabase/functions/_shared/services/entities/list-entities.ts");
			expect(paths).toContain("supabase/functions/_shared/services/entities/update-entity.ts");
			expect(paths).toContain("supabase/functions/_shared/services/entities/delete-entity.ts");
		});

		it("index.ts re-exports all operations", () => {
			const files = generateServiceFiles("services/entities", {
				name: "entities",
				entity: "entity",
				schema_import: "entity",
				table: "entities",
				operations: ["create", "get", "list", "update", "softDelete"],
				constraints: {},
			});
			const index = files.find((f) => f.path.endsWith("index.ts"));
			expect(index?.content).toContain("createEntity");
			expect(index?.content).toContain("getEntity");
			expect(index?.content).toContain("listEntities");
			expect(index?.content).toContain("updateEntity");
			expect(index?.content).toContain("deleteEntity");
		});

		it("create-user.ts uses with-id mode with pk_field", () => {
			const files = generateServiceFiles("services/users", {
				name: "users",
				entity: "user",
				schema_import: "user",
				table: "user_profiles",
				operations: ["create"],
				create_mode: "with-id",
				pk_field: "user_id",
				constraints: {},
			});
			const create = files.find((f) => f.path.endsWith("create-user.ts"));
			expect(create?.content).toContain("user_id: string");
			expect(create?.content).toContain(".insert(input)");
		});

		it("create-entity.ts uses with-owner mode", () => {
			const files = generateServiceFiles("services/entities", {
				name: "entities",
				entity: "entity",
				schema_import: "entity",
				table: "entities",
				operations: ["create"],
				create_mode: "with-owner",
				owner_field: "owner_id",
				constraints: {},
			});
			const create = files.find((f) => f.path.endsWith("create-entity.ts"));
			expect(create?.content).toContain("ownerId: string");
			expect(create?.content).toContain("owner_id: ownerId");
		});

		it("service files use ../_shared/core imports", () => {
			const files = generateServiceFiles("supabase/functions/_shared/services/entities", {
				name: "entities",
				entity: "entity",
				schema_import: "entity",
				table: "entities",
				operations: ["get"],
				pk_field: "entity_id",
				constraints: {},
			});
			const getFile = files.find((f) => f.path.endsWith("get-entity.ts"));
			expect(getFile?.content).toContain("../../core/errors.ts");
			expect(getFile?.content).toContain('.eq("entity_id", id)');
		});

		it("soft delete sets deleted_at", () => {
			const files = generateServiceFiles("services/entities", {
				name: "entities",
				entity: "entity",
				schema_import: "entity",
				table: "entities",
				operations: ["softDelete"],
				pk_field: "entity_id",
				constraints: {},
			});
			const del = files.find((f) => f.path.endsWith("delete-entity.ts"));
			expect(del?.content).toContain('.is("deleted_at", null)');
			expect(del?.content).toContain("new Date().toISOString()");
		});
	});

	describe("generateEntrypoint", () => {
		it("generates Deno.serve with new core imports", () => {
			const output = generateEntrypoint({
				name: "entities",
				auth_required: true,
				service_import: "entities",
				schema_import: "entity",
				create_mode: "with-owner",
				endpoints: [
					{ method: "GET", path: "/", handler: "list", has_pagination: true },
					{ method: "GET", path: "/:id", handler: "get" },
					{ method: "POST", path: "/", handler: "create", status: 201 },
					{ method: "PATCH", path: "/:id", handler: "update" },
					{ method: "DELETE", path: "/:id", handler: "softDelete", status: 204 },
				],
			});

			expect(output).toContain('from "../_shared/core/cors.ts"');
			expect(output).toContain('from "../_shared/core/auth.ts"');
			expect(output).toContain('from "../_shared/core/responses.ts"');
			expect(output).toContain('from "../_shared/core/errors.ts"');
			expect(output).toContain('from "../_shared/services/entities/index.ts"');
			expect(output).toContain("Deno.serve(async (req: Request)");
		});

		it("uses verifyAuth(req) without supabase arg", () => {
			const output = generateEntrypoint({
				name: "entities",
				auth_required: true,
				service_import: "entities",
				schema_import: "entity",
				create_mode: "with-owner",
				endpoints: [],
			});
			expect(output).toContain("await verifyAuth(req)");
			expect(output).not.toContain("verifyAuth(req, supabase)");
		});

		it("captures user for with-owner create mode", () => {
			const output = generateEntrypoint({
				name: "entities",
				auth_required: true,
				service_import: "entities",
				schema_import: "entity",
				create_mode: "with-owner",
				endpoints: [{ method: "POST", path: "/", handler: "create", status: 201 }],
			});
			expect(output).toContain("const user = await verifyAuth(req)");
			expect(output).toContain("user.id");
		});

		it("does not capture user for with-id create mode", () => {
			const output = generateEntrypoint({
				name: "users",
				auth_required: true,
				service_import: "users",
				schema_import: "user",
				create_mode: "with-id",
				pk_field: "user_id",
				endpoints: [{ method: "POST", path: "/", handler: "create", status: 201 }],
			});
			expect(output).not.toContain("const user = await verifyAuth(req)");
			expect(output).toContain("await verifyAuth(req)");
		});

		it("uses fromError in catch block", () => {
			const output = generateEntrypoint({
				name: "users",
				auth_required: true,
				service_import: "users",
				schema_import: "user",
				endpoints: [],
			});
			expect(output).toContain("return fromError(err)");
		});

		it("uses listParamsSchema with safeParse for list endpoint", () => {
			const output = generateEntrypoint({
				name: "users",
				auth_required: true,
				service_import: "users",
				schema_import: "user",
				endpoints: [{ method: "GET", path: "/", handler: "list", has_pagination: true }],
			});
			expect(output).toContain("listUsersParamsSchema.safeParse");
			expect(output).toContain("ValidationError");
		});

		it("uses UUID regex for id extraction", () => {
			const output = generateEntrypoint({
				name: "users",
				auth_required: false,
				service_import: "users",
				schema_import: "user",
				endpoints: [],
			});
			expect(output).toContain("[0-9a-f-]{36}");
		});

		it("includes checkPermission import when access is defined", () => {
			const output = generateEntrypoint({
				name: "entities",
				auth_required: true,
				service_import: "entities",
				schema_import: "entity",
				create_mode: "with-owner",
				endpoints: [
					{ method: "GET", path: "/", handler: "list", has_pagination: true },
					{ method: "POST", path: "/", handler: "create", status: 201 },
				],
				access: [{ role: "admin", actions: ["list", "create"], own_only: false }],
			});
			expect(output).toContain('import { checkPermission } from "../_shared/core/rbac.ts"');
			expect(output).toContain('await checkPermission(req, "entities", "list")');
			expect(output).toContain('await checkPermission(req, "entities", "create")');
		});

		it("does not include checkPermission when no access rules", () => {
			const output = generateEntrypoint({
				name: "entities",
				auth_required: true,
				service_import: "entities",
				schema_import: "entity",
				endpoints: [{ method: "GET", path: "/", handler: "list", has_pagination: true }],
			});
			expect(output).not.toContain("checkPermission");
		});

		it("with-id create uses pk_field name for body extraction", () => {
			const output = generateEntrypoint({
				name: "users",
				auth_required: true,
				service_import: "users",
				schema_import: "user",
				create_mode: "with-id",
				pk_field: "user_id",
				endpoints: [{ method: "POST", path: "/", handler: "create", status: 201 }],
			});
			expect(output).toContain("user_id: body.user_id");
		});
	});

	describe("generateAuthEntrypoint", () => {
		it("generates auth endpoint matching demo structure", () => {
			const output = generateAuthEntrypoint({ name: "auth" });

			expect(output).toContain("Deno.serve");
			expect(output).toContain('from "../_shared/core/cors.ts"');
			expect(output).toContain('from "../_shared/core/auth.ts"');
			expect(output).toContain("signUpSchema");
			expect(output).toContain("signInSchema");
			expect(output).toContain('path === "/signup"');
			expect(output).toContain('path === "/signin"');
			expect(output).toContain('path === "/signout"');
			expect(output).toContain('path === "/me"');
			expect(output).toContain("service.auth.admin.createUser");
			expect(output).toContain("createUser(service");
			expect(output).toContain("user_id: data.user.id");
			expect(output).toContain("return fromError(err)");
		});

		it("assigns default role on signup", () => {
			const output = generateAuthEntrypoint({ name: "auth" });
			expect(output).toContain('.schema("rbac")');
			expect(output).toContain('.from("roles")');
			expect(output).toContain('.eq("is_default", true)');
			expect(output).toContain('.from("user_roles")');
			expect(output).toContain("role_id: defaultRole.role_id");
		});
	});

	describe("generateDenoConfig", () => {
		it("generates valid JSON with updated imports", () => {
			const output = generateDenoConfig();
			const parsed = JSON.parse(output);
			expect(parsed.imports["npm:@supabase/supabase-js@2"]).toBe("npm:@supabase/supabase-js@2");
			expect(parsed.imports["npm:zod@4"]).toBe("npm:zod@4");
		});
	});

	describe("generateDatabaseSchema", () => {
		it("generates update_updated_at() for identification_types brick", () => {
			const output = generateDatabaseSchema(
				{
					table: "identification_types",
					primary_key: "slug",
					fields: [
						{ name: "slug", type: "string", required: true },
						{ name: "name", type: "string", required: true },
					],
				},
				"identification_types",
				{},
			);
			expect(output).toContain("create or replace function update_updated_at()");
			expect(output).toContain("create table if not exists public.identification_types");
			expect(output).toContain("on conflict (slug) do nothing");
			expect(output).toContain("enable row level security");
		});

		it("generates table SQL with all standard columns", () => {
			const output = generateDatabaseSchema(
				{
					table: "entities",
					primary_key: "entity_id",
					fields: [
						{ name: "entity_id", type: "uuid", default: "gen_random_uuid()" },
						{ name: "name", type: "string", required: true },
					],
				},
				"entities",
				{},
			);

			expect(output).toContain("create table if not exists public.entities");
			expect(output).toContain("entity_id uuid primary key default gen_random_uuid()");
			expect(output).toContain("name text not null");
			expect(output).toContain("created_at timestamptz not null default now()");
			expect(output).toContain("updated_at timestamptz not null default now()");
			expect(output).toContain("deleted_at timestamptz");
			expect(output).toContain("alter table public.entities enable row level security");
			expect(output).toContain("create trigger entities_updated_at");
			expect(output).toContain("update_updated_at()");
		});

		it("generates owner field as not null with auth FK", () => {
			const output = generateDatabaseSchema(
				{
					table: "entities",
					primary_key: "entity_id",
					fields: [
						{ name: "entity_id", type: "uuid", default: "gen_random_uuid()" },
						{ name: "owner_id", type: "uuid", references: "auth" },
					],
				},
				"entities",
				{},
			);
			expect(output).toContain(
				"owner_id uuid not null references auth.users(id) on delete cascade",
			);
		});

		it("generates GIN index with expression", () => {
			const output = generateDatabaseSchema(
				{
					table: "entities",
					primary_key: "entity_id",
					fields: [{ name: "entity_id", type: "uuid" }],
					indexes: [
						{
							name: "entities_name_gin_idx",
							columns: ["name"],
							type: "gin",
							expression: "to_tsvector('simple', name)",
						},
					],
				},
				"entities",
				{},
			);
			expect(output).toContain("using gin(to_tsvector('simple', name))");
		});

		it("generates unique index", () => {
			const output = generateDatabaseSchema(
				{
					table: "entities",
					primary_key: "entity_id",
					fields: [{ name: "entity_id", type: "uuid" }],
					indexes: [
						{
							name: "entities_unique_idx",
							columns: ["owner_id", "name"],
							type: "unique",
							where: "deleted_at is null",
						},
					],
				},
				"entities",
				{},
			);
			expect(output).toContain("create unique index if not exists entities_unique_idx");
			expect(output).toContain("where deleted_at is null");
		});

		it("generates FK reference in primary key", () => {
			const output = generateDatabaseSchema(
				{
					table: "user_profiles",
					primary_key: "user_id",
					fields: [{ name: "user_id", type: "uuid", references: "auth" }],
				},
				"user_profiles",
				{},
			);
			expect(output).toContain("references auth.users(id) on delete cascade");
		});

		it("generates RBAC-based RLS policies with has_permission()", () => {
			const output = generateDatabaseSchema(
				{
					table: "entities",
					primary_key: "entity_id",
					fields: [
						{ name: "entity_id", type: "uuid" },
						{ name: "owner_id", type: "uuid", references: "auth" },
					],
				},
				"entities",
				{},
			);
			expect(output).toContain("rbac.has_permission('entities', 'get', owner_id)");
			expect(output).toContain("rbac.has_permission('entities', 'create', owner_id)");
			expect(output).toContain("rbac.has_permission('entities', 'update', owner_id)");
			expect(output).toContain('create policy "service_role_entities"');
		});

		it("generates RBAC RLS with NULL owner for tables without owner field", () => {
			const output = generateDatabaseSchema(
				{
					table: "identification_types",
					primary_key: "slug",
					fields: [{ name: "slug", type: "string", required: true }],
				},
				"identification_types",
				{},
			);
			expect(output).toContain("rbac.has_permission('identification_types', 'get', NULL)");
		});

		it("appends permission seed SQL when access rules provided", () => {
			const output = generateDatabaseSchema(
				{
					table: "entities",
					primary_key: "entity_id",
					fields: [{ name: "entity_id", type: "uuid" }],
				},
				"entities",
				{},
				[
					{ role: "admin", actions: ["list", "get", "create"], own_only: false },
					{ role: "member", actions: ["list", "get"], own_only: true },
				],
			);
			expect(output).toContain("INSERT INTO rbac.permissions");
			expect(output).toContain("'entities', 'list', false");
			expect(output).toContain("'entities', 'list', true");
			expect(output).toContain("WHERE r.name = 'admin'");
			expect(output).toContain("WHERE r.name = 'member'");
		});
	});

	describe("generateBrickFiles", () => {
		const baseContext = {
			project: { name: "test", type: "api", stack: "ts" },
			config: {},
			state: initState("test"),
			existingBricks: [],
		};

		it("generates schema and migration for brick with table only", async () => {
			const brick: BrickSpec = {
				brick: { name: "item", version: "1.0.0", description: "test" },
				requires: [],
				config: {},
				schema: {
					table: "items",
					primary_key: "item_id",
					fields: [
						{ name: "item_id", type: "uuid", default: "gen_random_uuid()" },
						{ name: "title", type: "string", required: true },
					],
				},
			};

			const files = await generateBrickFiles({ ...baseContext, brick });
			expect(files).toHaveLength(2); // schema + migration
			expect(files[0]?.path).toBe("supabase/functions/_shared/schemas/item.ts");
			expect(files[0]?.content).toContain("itemSchema");
			expect(files[1]?.path).toMatch(/supabase\/migrations\/.+\.sql/);
		});

		it("generates schema, migration, services, entrypoint for brick with api", async () => {
			const brick: BrickSpec = {
				brick: { name: "item", version: "1.0.0", description: "test" },
				requires: [],
				config: {},
				schema: {
					table: "items",
					primary_key: "item_id",
					fields: [{ name: "item_id", type: "uuid", default: "gen_random_uuid()" }],
				},
				api: {
					type: "rest",
					auth_required: false,
					endpoints: [
						{ method: "POST", path: "/", handler: "create", status: 201 },
						{ method: "GET", path: "/:id", handler: "get" },
						{ method: "GET", path: "/", handler: "list", has_pagination: true },
					],
				},
			};

			const files = await generateBrickFiles({ ...baseContext, brick });
			expect(files.length).toBeGreaterThan(1);
			expect(files.some((f) => f.path.endsWith("index.ts") && f.path.includes("services"))).toBe(
				true,
			);
			expect(files.some((f) => f.path.includes("functions/item/index.ts"))).toBe(true);
		});
	});
});
