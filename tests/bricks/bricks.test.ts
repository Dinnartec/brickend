import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { createBrickLoader } from "../../src/core/brick-loader.ts";
import { type GenerationContext, generateBrickFiles } from "../../src/core/generator.ts";
import { initState } from "../../src/core/state.ts";

const BRICKS_DIR = join(import.meta.dir, "../../bricks");
const loader = createBrickLoader(BRICKS_DIR);

function makeContext(
	spec: Awaited<ReturnType<typeof loader.loadBrickSpec>>,
	config?: Record<string, unknown>,
	existingBricks: string[] = [],
): GenerationContext {
	return {
		project: { name: "test-api", type: "api", stack: "typescript/supabase-edge-functions" },
		brick: spec,
		config:
			config ?? Object.fromEntries(Object.entries(spec.config).map(([k, v]) => [k, v.default])),
		state: initState("test-api"),
		existingBricks,
		// No projectPath — database falls back to timestamp path (no supabase CLI needed)
	};
}

describe("identification_types Brick", () => {
	it("loads valid brick spec", async () => {
		const spec = await loader.loadBrickSpec("identification_types");
		expect(spec.brick.name).toBe("identification_types");
		expect(spec.requires).toEqual([]);
		expect(spec.schema?.table).toBe("identification_types");
		expect(spec.schema?.primary_key).toBe("slug");
		expect(spec.schema?.workspace_scoped).toBe(false);
		expect(spec.api?.type).toBe("rest");
		expect(spec.api?.endpoints).toHaveLength(5);
	});

	it("generates schema, migration, service files, entrypoint, and deno.json", async () => {
		const spec = await loader.loadBrickSpec("identification_types");
		const files = await generateBrickFiles(makeContext(spec));

		// schema + migration + 7 service files + entrypoint + deno.json = 11
		expect(files).toHaveLength(11);
		const schema = files.find((f) => f.path.includes("schemas/identification_type.ts"));
		expect(schema).toBeDefined();
		expect(schema?.content).toContain('import { z } from "npm:zod@4"');
		expect(schema?.content).toContain("identificationTypeSchema");

		const entrypoint = files.find((f) => f.path.endsWith("identification_types/index.ts"));
		expect(entrypoint).toBeDefined();
	});

	it("generates core migration SQL with update_updated_at, seed data, and RBAC RLS", async () => {
		const spec = await loader.loadBrickSpec("identification_types");
		const files = await generateBrickFiles(makeContext(spec));

		const sql = files.find((f) => f.path.endsWith(".sql"));
		expect(sql?.path).toMatch(/supabase\/migrations\/.+_identification_types\.sql/);
		expect(sql?.content).toContain("create or replace function update_updated_at()");
		expect(sql?.content).toContain("create table if not exists public.identification_types");
		expect(sql?.content).toContain("on conflict (slug) do nothing");
		expect(sql?.content).toContain("enable row level security");
		expect(sql?.content).toContain("rbac.has_permission('identification_types'");
	});
});

describe("Auth Brick", () => {
	it("loads valid brick spec", async () => {
		const spec = await loader.loadBrickSpec("auth");
		expect(spec.brick.name).toBe("auth");
		expect(spec.brick.version).toBe("1.0.0");
		expect(spec.requires).toEqual([]);
		expect(spec.api?.type).toBe("auth");
		expect(spec.schema?.table).toBeUndefined(); // no table for auth
	});

	it("generates 3 files (auth schema, entrypoint, deno.json)", async () => {
		const spec = await loader.loadBrickSpec("auth");
		const files = await generateBrickFiles(makeContext(spec));

		expect(files).toHaveLength(3);

		const schema = files.find((f) => f.path.includes("schemas/auth.ts"));
		expect(schema).toBeDefined();
		expect(schema?.content).toContain('import { z } from "npm:zod@4"');
		expect(schema?.content).toContain("signUpSchema");
		expect(schema?.content).toContain("signInSchema");

		const entrypoint = files.find((f) => f.path.includes("functions/auth/index.ts"));
		expect(entrypoint).toBeDefined();
		expect(entrypoint?.content).toContain("Deno.serve");
		expect(entrypoint?.content).toContain("service.auth.admin.createUser");
		expect(entrypoint?.content).toContain('path === "/signup"');
		expect(entrypoint?.content).toContain("user_id: data.user.id");

		const denoConfig = files.find((f) => f.path.includes("deno.json"));
		expect(denoConfig).toBeDefined();
		expect(JSON.parse(denoConfig?.content ?? "{}").imports?.["npm:zod@4"]).toBe("npm:zod@4");
	});

	it("auth entrypoint assigns default role on signup", async () => {
		const spec = await loader.loadBrickSpec("auth");
		const files = await generateBrickFiles(makeContext(spec));

		const entrypoint = files.find((f) => f.path.includes("functions/auth/index.ts"));
		expect(entrypoint?.content).toContain('.schema("rbac")');
		expect(entrypoint?.content).toContain('.eq("is_default", true)');
		expect(entrypoint?.content).toContain("user_roles");
	});

	it("does NOT generate SQL (uses Supabase Auth built-in)", async () => {
		const spec = await loader.loadBrickSpec("auth");
		const files = await generateBrickFiles(makeContext(spec));
		expect(files.find((f) => f.path.endsWith(".sql"))).toBeUndefined();
	});
});

describe("Users Brick", () => {
	it("loads valid brick spec with correct dependencies", async () => {
		const spec = await loader.loadBrickSpec("users");
		expect(spec.brick.name).toBe("users");
		const deps = spec.requires.map((r) => r.brick);
		expect(deps).toContain("identification_types");
		expect(deps).toContain("auth");
	});

	it("generates schema with user fields", async () => {
		const spec = await loader.loadBrickSpec("users");
		const files = await generateBrickFiles(makeContext(spec));

		const schema = files.find((f) => f.path.includes("schemas/user.ts"));
		expect(schema).toBeDefined();
		expect(schema?.content).toContain('import { z } from "npm:zod@4"');
		expect(schema?.content).toContain("userSchema");
		expect(schema?.content).toContain("createUserSchema");
		expect(schema?.content).toContain("listUsersParamsSchema");
		expect(schema?.content).toContain("full_name");
		expect(schema?.content).toContain("email");
		// user_id is PK — present in main schema but not in createUserSchema
		expect(schema?.content).toContain("user_id: z.string().uuid()");
		const createIdx = schema?.content.indexOf("createUserSchema");
		const updateIdx = schema?.content.indexOf("updateUserSchema");
		expect(schema?.content.slice(createIdx, updateIdx)).not.toContain("user_id");
	});

	it("generates multi-file service bundle", async () => {
		const spec = await loader.loadBrickSpec("users");
		const files = await generateBrickFiles(makeContext(spec));

		const servicePaths = files.filter((f) => f.path.includes("services/users/")).map((f) => f.path);
		expect(servicePaths.some((p) => p.endsWith("index.ts"))).toBe(true);
		expect(servicePaths.some((p) => p.endsWith("create-user.ts"))).toBe(true);
		expect(servicePaths.some((p) => p.endsWith("get-user.ts"))).toBe(true);
		expect(servicePaths.some((p) => p.endsWith("list-users.ts"))).toBe(true);
		expect(servicePaths.some((p) => p.endsWith("update-user.ts"))).toBe(true);
		expect(servicePaths.some((p) => p.endsWith("delete-user.ts"))).toBe(true);
	});

	it("create-user.ts uses with-id mode with user_id PK", async () => {
		const spec = await loader.loadBrickSpec("users");
		const files = await generateBrickFiles(makeContext(spec));

		const createFile = files.find((f) => f.path.endsWith("create-user.ts"));
		expect(createFile?.content).toContain("user_id: string");
		expect(createFile?.content).toContain(".insert(input)");
	});

	it("get-user.ts queries by user_id", async () => {
		const spec = await loader.loadBrickSpec("users");
		const files = await generateBrickFiles(makeContext(spec));

		const getFile = files.find((f) => f.path.endsWith("get-user.ts"));
		expect(getFile?.content).toContain('.eq("user_id", id)');
	});

	it("entrypoint uses new core imports and fromError", async () => {
		const spec = await loader.loadBrickSpec("users");
		const files = await generateBrickFiles(makeContext(spec));

		const ep = files.find((f) => f.path.includes("functions/users/index.ts"));
		expect(ep?.content).toContain('from "../_shared/core/');
		expect(ep?.content).toContain("verifyAuth");
		expect(ep?.content).toContain("fromError");
		expect(ep?.content).toContain("listUsersParamsSchema");
		expect(ep?.content).toContain("user_id: body.user_id");
	});

	it("SQL migration has FK to auth.users and RBAC RLS", async () => {
		const spec = await loader.loadBrickSpec("users");
		const files = await generateBrickFiles(makeContext(spec));

		const sql = files.find((f) => f.path.endsWith(".sql"));
		expect(sql?.path).toMatch(/supabase\/migrations\/.+_users\.sql/);
		expect(sql?.content).toContain(
			"user_id uuid primary key references auth.users(id) on delete cascade",
		);
		expect(sql?.content).toContain("user_profiles");
		expect(sql?.content).toContain("deleted_at timestamptz");
		expect(sql?.content).toContain("enable row level security");
		expect(sql?.content).toContain("using gin(to_tsvector('simple', full_name))");
		expect(sql?.content).toContain("rbac.has_permission('users'");
		// Permission seeds from access rules
		expect(sql?.content).toContain("INSERT INTO rbac.permissions");
	});
});

describe("Entities Brick", () => {
	it("loads valid brick spec", async () => {
		const spec = await loader.loadBrickSpec("entities");
		expect(spec.brick.name).toBe("entities");
		expect(Object.keys(spec.config)).toHaveLength(0);
		expect(spec.schema?.primary_key).toBe("entity_id");
	});

	it("generates entity schema with owner_id in main schema only", async () => {
		const spec = await loader.loadBrickSpec("entities");
		const files = await generateBrickFiles(makeContext(spec));

		const schema = files.find((f) => f.path.includes("schemas/entity.ts"));
		expect(schema).toBeDefined();
		expect(schema?.content).toContain("owner_id");
		expect(schema?.content).toContain("listEntitiesParamsSchema");

		// owner_id should appear in entitySchema but NOT in createEntitySchema
		const createIdx = schema?.content.indexOf("createEntitySchema");
		const updateIdx = schema?.content.indexOf("updateEntitySchema");
		expect(schema?.content.slice(createIdx, updateIdx)).not.toContain("owner_id");
		expect(schema?.content.slice(createIdx, updateIdx)).not.toContain("entity_id");
	});

	it("generates multi-file service with with-owner create mode", async () => {
		const spec = await loader.loadBrickSpec("entities");
		const files = await generateBrickFiles(makeContext(spec));

		const createFile = files.find((f) => f.path.endsWith("create-entity.ts"));
		expect(createFile?.content).toContain("ownerId: string");
		expect(createFile?.content).toContain("owner_id: ownerId");
	});

	it("entrypoint captures user for with-owner mode and includes checkPermission", async () => {
		const spec = await loader.loadBrickSpec("entities");
		const files = await generateBrickFiles(makeContext(spec));

		const ep = files.find((f) => f.path.includes("functions/entities/index.ts"));
		expect(ep?.content).toContain("const user = await verifyAuth(req)");
		expect(ep?.content).toContain("user.id");
		expect(ep?.content).toContain("fromError");
		expect(ep?.content).toContain("checkPermission");
	});

	it("SQL migration has entity_id PK, owner_id FK, unique index, GIN index, and RBAC RLS", async () => {
		const spec = await loader.loadBrickSpec("entities");
		const files = await generateBrickFiles(makeContext(spec));

		const sql = files.find((f) => f.path.endsWith(".sql"));
		expect(sql?.path).toMatch(/supabase\/migrations\/.+_entities\.sql/);
		expect(sql?.content).toContain("entity_id uuid primary key default gen_random_uuid()");
		expect(sql?.content).toContain(
			"owner_id uuid not null references auth.users(id) on delete cascade",
		);
		expect(sql?.content).toContain("create unique index if not exists");
		expect(sql?.content).toContain("using gin(to_tsvector('simple', name))");
		expect(sql?.content).toContain("enable row level security");
		expect(sql?.content).toContain("rbac.has_permission('entities', 'get', owner_id)");
		expect(sql?.content).toContain("rbac.has_permission('entities', 'create', owner_id)");
		expect(sql?.content).toContain("INSERT INTO rbac.permissions");
	});

	it("service files use textSearch for list with search_field", async () => {
		const spec = await loader.loadBrickSpec("entities");
		const files = await generateBrickFiles(makeContext(spec));

		const listFile = files.find((f) => f.path.endsWith("list-entities.ts"));
		expect(listFile?.content).toContain("textSearch");
		expect(listFile?.content).toContain('"name"');
	});

	it("const-entities.ts has constraint error maps", async () => {
		const spec = await loader.loadBrickSpec("entities");
		const files = await generateBrickFiles(makeContext(spec));

		const constFile = files.find((f) => f.path.endsWith("const-entities.ts"));
		expect(constFile?.content).toContain("ENTITY_CREATE_ERRORS");
		expect(constFile?.content).toContain("ENTITY_UPDATE_ERRORS");
		expect(constFile?.content).toContain("ConflictError");
		expect(constFile?.content).toContain("ValidationError");
	});
});
