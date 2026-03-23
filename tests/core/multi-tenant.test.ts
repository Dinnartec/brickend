import { describe, expect, it } from "bun:test";
import type { BrickSpec } from "../../src/core/brick-loader.ts";
import {
	generateAuthEntrypoint,
	generateAuthSchema,
	generateBrickFiles,
	generateDatabaseSchema,
	generateEntrypoint,
	generateSchema,
	generateServiceFiles,
} from "../../src/core/generator.ts";
import { initState } from "../../src/core/state.ts";
import {
	corsTemplate,
	rbacMiddlewareTemplate,
	rbacMigrationTemplate,
	workspaceInfrastructureSql,
} from "../../src/core/templates/index.ts";

describe("Multi-Tenant", () => {
	describe("needsWorkspaceId inference", () => {
		const mtState = initState("test", [], { settings: { multi_tenant: true } });
		const stState = initState("test");
		const baseContext = {
			project: { name: "test", type: "api", stack: "ts" },
			config: {},
			existingBricks: [],
		};

		it("entities (with-owner) get workspace_id in multi-tenant mode", async () => {
			const brick: BrickSpec = {
				brick: { name: "entities", version: "1.0.0", description: "test" },
				requires: [],
				config: {},
				schema: {
					table: "entities",
					primary_key: "entity_id",
					fields: [
						{ name: "entity_id", type: "uuid", default: "gen_random_uuid()" },
						{ name: "owner_id", type: "uuid", references: "auth" },
						{ name: "name", type: "string", required: true },
					],
				},
				api: {
					type: "rest",
					auth_required: true,
					endpoints: [
						{ method: "GET", path: "/", handler: "list", has_pagination: true },
						{ method: "POST", path: "/", handler: "create", status: 201 },
					],
				},
			};

			const files = await generateBrickFiles({ ...baseContext, brick, state: mtState });
			const schema = files.find((f) => f.path.includes("schemas/entity.ts"));
			expect(schema?.content).toContain("workspace_id: z.string().uuid()");

			const migration = files.find((f) => f.path.includes(".sql"));
			expect(migration?.content).toContain(
				"workspace_id uuid not null references rbac.workspaces(workspace_id)",
			);

			const entrypoint = files.find((f) => f.path === "supabase/functions/entities/index.ts");
			expect(entrypoint?.content).toContain('req.headers.get("x-workspace-id")');
			expect(entrypoint?.content).toContain("X-Workspace-Id header is required");
		});

		it("users (with-id) do NOT get workspace_id in multi-tenant mode", async () => {
			const brick: BrickSpec = {
				brick: { name: "users", version: "1.0.0", description: "test" },
				requires: [],
				config: {},
				schema: {
					table: "user_profiles",
					primary_key: "user_id",
					fields: [
						{ name: "user_id", type: "uuid", references: "auth" },
						{ name: "full_name", type: "string", required: true },
					],
				},
				api: {
					type: "rest",
					auth_required: true,
					endpoints: [{ method: "GET", path: "/", handler: "list", has_pagination: true }],
				},
			};

			const files = await generateBrickFiles({ ...baseContext, brick, state: mtState });
			const schema = files.find((f) => f.path.includes("schemas/user.ts"));
			expect(schema?.content).not.toContain("workspace_id");

			const entrypoint = files.find((f) => f.path.includes("users/index.ts"));
			expect(entrypoint?.content).not.toContain("x-workspace-id");
		});

		it("single-tenant entities do NOT get workspace_id", async () => {
			const brick: BrickSpec = {
				brick: { name: "entities", version: "1.0.0", description: "test" },
				requires: [],
				config: {},
				schema: {
					table: "entities",
					primary_key: "entity_id",
					fields: [
						{ name: "entity_id", type: "uuid", default: "gen_random_uuid()" },
						{ name: "owner_id", type: "uuid", references: "auth" },
						{ name: "name", type: "string", required: true },
					],
				},
				api: {
					type: "rest",
					auth_required: true,
					endpoints: [{ method: "GET", path: "/", handler: "list", has_pagination: true }],
				},
			};

			const files = await generateBrickFiles({ ...baseContext, brick, state: stState });
			const schema = files.find((f) => f.path.includes("schemas/entity.ts"));
			expect(schema?.content).not.toContain("workspace_id");
		});

		it("workspace_scoped: false opts out of workspace_id", async () => {
			const brick: BrickSpec = {
				brick: { name: "workspaces", version: "1.0.0", description: "test" },
				requires: [],
				config: {},
				schema: {
					db_schema: "rbac",
					table: "workspaces",
					workspace_scoped: false,
					primary_key: "workspace_id",
					fields: [
						{ name: "workspace_id", type: "uuid", default: "gen_random_uuid()" },
						{ name: "name", type: "string", required: true },
						{ name: "owner_id", type: "uuid", references: "auth" },
					],
				},
				api: {
					type: "rest",
					auth_required: true,
					endpoints: [{ method: "GET", path: "/", handler: "list", has_pagination: true }],
				},
			};

			const files = await generateBrickFiles({ ...baseContext, brick, state: mtState });
			const entrypoint = files.find((f) => f.path.includes("workspaces/index.ts"));
			expect(entrypoint?.content).not.toContain("x-workspace-id");

			// The workspaces table itself should NOT have a workspace_id FK column
			const migration = files.find((f) => f.path.includes(".sql"));
			expect(migration?.content).not.toContain(
				"workspace_id uuid not null references rbac.workspaces",
			);
		});

		it("auth brick is never workspace-scoped", async () => {
			const brick: BrickSpec = {
				brick: { name: "auth", version: "1.0.0", description: "test" },
				requires: [],
				config: {},
				schema: {
					fields: [
						{ name: "email", type: "email", required: true },
						{ name: "password", type: "string", required: true },
						{ name: "full_name", type: "string", required: true },
					],
				},
				api: {
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
					],
				},
			};

			const files = await generateBrickFiles({ ...baseContext, brick, state: mtState });
			const authEntrypoint = files.find((f) => f.path.includes("auth/index.ts"));
			// Multi-tenant auth signup should create workspace
			expect(authEntrypoint?.content).toContain("workspace_name");
			expect(authEntrypoint?.content).toContain('.from("workspaces")');
			expect(authEntrypoint?.content).toContain('.from("workspace_users")');
		});
	});

	describe("generateSchema with workspaceScoped", () => {
		it("adds workspace_id to main schema but not create/update", () => {
			const output = generateSchema(
				"entity",
				{
					primary_key: "entity_id",
					fields: [
						{ name: "entity_id", type: "uuid", default: "gen_random_uuid()" },
						{ name: "name", type: "string", required: true },
					],
				},
				true,
			);
			// workspace_id in main schema
			expect(output).toContain("workspace_id: z.string().uuid()");
			// NOT in create schema
			const createIdx = output.indexOf("createEntitySchema");
			const updateIdx = output.indexOf("updateEntitySchema");
			expect(output.slice(createIdx, updateIdx)).not.toContain("workspace_id");
			// NOT in update schema
			const listIdx = output.indexOf("listEntitiesParamsSchema");
			expect(output.slice(updateIdx, listIdx)).not.toContain("workspace_id");
		});
	});

	describe("generateServiceFiles with workspace_scoped", () => {
		it("create (with-owner) takes workspaceId param and inserts workspace_id", () => {
			const files = generateServiceFiles("services/entities", {
				name: "entities",
				entity: "entity",
				schema_import: "entity",
				table: "entities",
				operations: ["create"],
				create_mode: "with-owner",
				owner_field: "owner_id",
				constraints: {},
				workspace_scoped: true,
			});
			const create = files.find((f) => f.path.endsWith("create-entity.ts"));
			expect(create?.content).toContain("workspaceId: string");
			expect(create?.content).toContain("workspace_id: workspaceId");
		});

		it("create (standard) takes workspaceId param and inserts workspace_id", () => {
			const files = generateServiceFiles("services/items", {
				name: "items",
				entity: "item",
				schema_import: "item",
				table: "items",
				operations: ["create"],
				create_mode: "standard",
				constraints: {},
				workspace_scoped: true,
			});
			const create = files.find((f) => f.path.endsWith("create-item.ts"));
			expect(create?.content).toContain("workspaceId: string");
			expect(create?.content).toContain("workspace_id: workspaceId");
		});

		it("get takes workspaceId and filters by workspace_id", () => {
			const files = generateServiceFiles("services/entities", {
				name: "entities",
				entity: "entity",
				schema_import: "entity",
				table: "entities",
				operations: ["get"],
				pk_field: "entity_id",
				constraints: {},
				workspace_scoped: true,
			});
			const get = files.find((f) => f.path.endsWith("get-entity.ts"));
			expect(get?.content).toContain("workspaceId: string");
			expect(get?.content).toContain('.eq("workspace_id", workspaceId)');
		});

		it("list takes workspaceId and filters by workspace_id", () => {
			const files = generateServiceFiles("services/entities", {
				name: "entities",
				entity: "entity",
				schema_import: "entity",
				table: "entities",
				operations: ["list"],
				constraints: {},
				workspace_scoped: true,
			});
			const list = files.find((f) => f.path.endsWith("list-entities.ts"));
			expect(list?.content).toContain("workspaceId: string");
			expect(list?.content).toContain('.eq("workspace_id", workspaceId)');
		});

		it("update takes workspaceId and filters by workspace_id", () => {
			const files = generateServiceFiles("services/entities", {
				name: "entities",
				entity: "entity",
				schema_import: "entity",
				table: "entities",
				operations: ["update"],
				pk_field: "entity_id",
				constraints: {},
				workspace_scoped: true,
			});
			const update = files.find((f) => f.path.endsWith("update-entity.ts"));
			expect(update?.content).toContain("workspaceId: string");
			expect(update?.content).toContain('.eq("workspace_id", workspaceId)');
		});

		it("delete takes workspaceId and filters by workspace_id", () => {
			const files = generateServiceFiles("services/entities", {
				name: "entities",
				entity: "entity",
				schema_import: "entity",
				table: "entities",
				operations: ["softDelete"],
				pk_field: "entity_id",
				constraints: {},
				workspace_scoped: true,
			});
			const del = files.find((f) => f.path.endsWith("delete-entity.ts"));
			expect(del?.content).toContain("workspaceId: string");
			expect(del?.content).toContain('.eq("workspace_id", workspaceId)');
		});

		it("non-workspace-scoped services have no workspaceId param", () => {
			const files = generateServiceFiles("services/entities", {
				name: "entities",
				entity: "entity",
				schema_import: "entity",
				table: "entities",
				operations: ["create", "get", "list", "update", "softDelete"],
				create_mode: "with-owner",
				owner_field: "owner_id",
				constraints: {},
				workspace_scoped: false,
			});
			for (const f of files) {
				expect(f.content).not.toContain("workspaceId");
			}
		});
	});

	describe("generateEntrypoint with workspace_scoped", () => {
		it("extracts X-Workspace-Id header", () => {
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
				workspace_scoped: true,
			});
			expect(output).toContain('req.headers.get("x-workspace-id")');
			expect(output).toContain("X-Workspace-Id header is required");
			// All service calls pass workspaceId
			expect(output).toContain("workspaceId)");
		});

		it("does not extract X-Workspace-Id when not workspace-scoped", () => {
			const output = generateEntrypoint({
				name: "users",
				auth_required: true,
				service_import: "users",
				schema_import: "user",
				create_mode: "with-id",
				pk_field: "user_id",
				endpoints: [{ method: "GET", path: "/", handler: "list", has_pagination: true }],
			});
			expect(output).not.toContain("x-workspace-id");
			expect(output).not.toContain("workspaceId");
		});
	});

	describe("generateDatabaseSchema with multi-tenant", () => {
		it("adds workspace_id column for workspace-scoped tables", () => {
			const output = generateDatabaseSchema(
				{
					table: "entities",
					primary_key: "entity_id",
					fields: [
						{ name: "entity_id", type: "uuid", default: "gen_random_uuid()" },
						{ name: "owner_id", type: "uuid", references: "auth" },
						{ name: "name", type: "string", required: true },
					],
				},
				"entities",
				{},
				[],
				true,
			);
			expect(output).toContain(
				"workspace_id uuid not null references rbac.workspaces(workspace_id)",
			);
			// RLS passes workspace_id to has_permission
			expect(output).toContain("rbac.has_permission('entities', 'get', owner_id, workspace_id)");
		});

		it("does NOT add workspace_id for tables with workspace_scoped: false", () => {
			// Use a non-workspaces brick to test workspace_scoped:false behavior
			// (the "workspaces" brick is special-cased in multi-tenant to return early)
			const output = generateDatabaseSchema(
				{
					table: "global_settings",
					workspace_scoped: false,
					primary_key: "setting_id",
					fields: [
						{ name: "setting_id", type: "uuid", default: "gen_random_uuid()" },
						{ name: "key", type: "string", required: true },
					],
				},
				"global_settings",
				{},
				[],
				true,
			);
			// Should NOT have the workspace_id FK column
			expect(output).not.toContain("workspace_id uuid not null references rbac.workspaces");
			// RLS should NOT pass workspace_id (not workspace-scoped)
			expect(output).toContain("rbac.has_permission('global_settings', 'get', NULL)");
			expect(output).not.toContain(
				"rbac.has_permission('global_settings', 'get', NULL, workspace_id)",
			);
		});

		it("workspaces brick migration in multi-tenant only emits permissions seed (table SQL is in RBAC init)", () => {
			const output = generateDatabaseSchema(
				{
					db_schema: "rbac",
					table: "workspaces",
					workspace_scoped: false,
					primary_key: "workspace_id",
					fields: [
						{ name: "workspace_id", type: "uuid", default: "gen_random_uuid()" },
						{ name: "name", type: "string", required: true },
						{ name: "owner_id", type: "uuid", references: "auth" },
					],
				},
				"workspaces",
				{},
				[{ role: "admin", actions: ["list", "get"] }],
				true,
			);
			// Table + infrastructure SQL moved to RBAC init migration
			expect(output).not.toContain("CREATE TABLE rbac.workspaces");
			expect(output).not.toContain("CREATE TABLE rbac.workspace_users");
			expect(output).not.toContain("p_workspace_id UUID DEFAULT NULL");
			// Only the permissions seed remains
			expect(output).toContain("-- RBAC permissions for workspaces");
		});

		it("single-tenant does NOT add workspace infrastructure to workspaces brick", () => {
			const output = generateDatabaseSchema(
				{
					db_schema: "rbac",
					table: "workspaces",
					workspace_scoped: false,
					primary_key: "workspace_id",
					fields: [
						{ name: "workspace_id", type: "uuid", default: "gen_random_uuid()" },
						{ name: "name", type: "string", required: true },
					],
				},
				"workspaces",
				{},
				[],
				false,
			);
			expect(output).not.toContain("workspace_users");
			expect(output).not.toContain("p_workspace_id");
		});
	});

	describe("generateAuthEntrypoint multi-tenant", () => {
		it("creates workspace and assigns via workspace_users", () => {
			const output = generateAuthEntrypoint({}, true);
			expect(output).toContain("workspace_name");
			expect(output).toContain('.from("workspaces")');
			expect(output).toContain('.from("workspace_users")');
			expect(output).toContain("workspace_id: workspace.workspace_id");
			expect(output).not.toContain('.from("user_roles")');
		});

		it("single-tenant assigns via user_roles", () => {
			const output = generateAuthEntrypoint({}, false);
			expect(output).toContain('.from("user_roles")');
			expect(output).not.toContain('.from("workspace_users")');
			expect(output).not.toContain("workspace_name");
		});
	});

	describe("generateAuthSchema multi-tenant", () => {
		it("adds workspace_name to signUpSchema when multi-tenant", () => {
			const output = generateAuthSchema(
				{
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
				},
				true,
			);
			expect(output).toContain("workspace_name: z.string().optional()");
		});

		it("does NOT add workspace_name in single-tenant", () => {
			const output = generateAuthSchema(
				{
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
					],
				},
				false,
			);
			expect(output).not.toContain("workspace_name");
		});
	});

	describe("corsTemplate multi-tenant", () => {
		it("includes X-Workspace-Id header when multi-tenant", () => {
			const output = corsTemplate(true);
			expect(output).toContain("X-Workspace-Id");
		});

		it("does NOT include X-Workspace-Id when single-tenant", () => {
			const output = corsTemplate(false);
			expect(output).not.toContain("X-Workspace-Id");
		});
	});

	describe("rbacMiddlewareTemplate multi-tenant", () => {
		it("reads X-Workspace-Id header when multi-tenant", () => {
			const output = rbacMiddlewareTemplate(true);
			expect(output).toContain('req.headers.get("x-workspace-id")');
			expect(output).toContain("p_workspace_id: workspaceId");
		});

		it("does NOT read workspace header when single-tenant", () => {
			const output = rbacMiddlewareTemplate(false);
			expect(output).not.toContain("x-workspace-id");
			expect(output).not.toContain("p_workspace_id");
		});
	});

	describe("rbacMigrationTemplate multi-tenant", () => {
		const testRoles = [
			{ name: "admin", description: "Full access", is_default: true },
			{ name: "member", description: "Standard user" },
		];

		it("multi-tenant includes workspaces and workspace_users tables", () => {
			const sql = rbacMigrationTemplate(testRoles, true);
			expect(sql).toContain("CREATE TABLE rbac.workspaces");
			expect(sql).toContain("CREATE TABLE rbac.workspace_users");
			expect(sql).toContain("PRIMARY KEY (workspace_id, user_id)");
		});

		it("multi-tenant uses 4-param has_permission with workspace check", () => {
			const sql = rbacMigrationTemplate(testRoles, true);
			expect(sql).toContain("p_workspace_id UUID DEFAULT NULL");
			expect(sql).toContain("wu.workspace_id = p_workspace_id");
		});

		it("multi-tenant skips user_roles table and has_role function", () => {
			const sql = rbacMigrationTemplate(testRoles, true);
			expect(sql).not.toContain("CREATE TABLE rbac.user_roles");
			expect(sql).not.toContain("rbac.has_role");
		});

		it("single-tenant uses user_roles and 3-param has_permission", () => {
			const sql = rbacMigrationTemplate(testRoles, false);
			expect(sql).toContain("CREATE TABLE rbac.user_roles");
			expect(sql).toContain("rbac.has_role");
			expect(sql).not.toContain("CREATE TABLE rbac.workspaces");
			expect(sql).not.toContain("p_workspace_id");
		});

		it("seeds roles in both modes", () => {
			const sqlMt = rbacMigrationTemplate(testRoles, true);
			const sqlSt = rbacMigrationTemplate(testRoles, false);
			for (const sql of [sqlMt, sqlSt]) {
				expect(sql).toContain("INSERT INTO rbac.roles");
				expect(sql).toContain("'admin'");
				expect(sql).toContain("'member'");
			}
		});
	});

	describe("identification_types in multi-tenant mode", () => {
		it("does NOT get workspace_id column (workspace_scoped: false, no api)", () => {
			const output = generateDatabaseSchema(
				{
					table: "identification_types",
					primary_key: "slug",
					workspace_scoped: false,
					fields: [
						{ name: "slug", type: "string", required: true },
						{ name: "name", type: "string", required: true },
					],
				},
				"identification_types",
				{},
				[],
				true,
				// No api passed — simulates a brick with no api section
			);
			expect(output).not.toContain("workspace_id");
		});

		it("generateBrickFiles for identification_types in multi-tenant has no workspace_id", async () => {
			const mtState = initState("test", [], { settings: { multi_tenant: true } });
			const brick: BrickSpec = {
				brick: { name: "identification_types", version: "1.0.0", description: "test" },
				requires: [],
				config: {},
				schema: {
					table: "identification_types",
					primary_key: "slug",
					workspace_scoped: false,
					fields: [
						{ name: "slug", type: "string", required: true },
						{ name: "name", type: "string", required: true },
					],
				},
				api: {
					type: "rest",
					auth_required: true,
					endpoints: [
						{ method: "GET", path: "/", handler: "list" },
						{ method: "GET", path: "/:id", handler: "get" },
					],
				},
			};
			const files = await generateBrickFiles({
				project: { name: "test", type: "api", stack: "ts" },
				brick,
				config: {},
				state: mtState,
				existingBricks: [],
			});
			const migration = files.find((f) => f.path.endsWith(".sql"));
			expect(migration?.content).not.toContain("workspace_id");
		});
	});

	describe("workspaceInfrastructureSql", () => {
		it("creates workspace_users table", () => {
			const sql = workspaceInfrastructureSql();
			expect(sql).toContain("CREATE TABLE rbac.workspace_users");
			expect(sql).toContain("PRIMARY KEY (workspace_id, user_id)");
		});

		it("creates workspace-aware has_permission function", () => {
			const sql = workspaceInfrastructureSql();
			expect(sql).toContain("CREATE OR REPLACE FUNCTION rbac.has_permission");
			expect(sql).toContain("p_workspace_id UUID DEFAULT NULL");
			expect(sql).toContain("wu.workspace_id = p_workspace_id");
			expect(sql).toContain("p_workspace_id IS NOT NULL");
			expect(sql).toContain("p_workspace_id IS NULL");
		});

		it("enables RLS on workspace_users", () => {
			const sql = workspaceInfrastructureSql();
			expect(sql).toContain("ALTER TABLE rbac.workspace_users ENABLE ROW LEVEL SECURITY");
		});
	});
});
