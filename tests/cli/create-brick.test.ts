import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { createBrickCommand, parseFieldDefs } from "../../src/cli/create-brick.ts";
import { BrickSpecSchema } from "../../src/core/brick-spec.ts";
import { BrickendError } from "../../src/core/errors.ts";
import { initState, loadState, saveState } from "../../src/core/state.ts";

// --- parseFieldDefs unit tests ---

describe("parseFieldDefs", () => {
	it("parses a simple field", () => {
		const result = parseFieldDefs("name:string");
		expect(result).toEqual([{ name: "name", type: "string" }]);
	});

	it("parses a required field", () => {
		const result = parseFieldDefs("title:string:required");
		expect(result).toEqual([{ name: "title", type: "string", required: true }]);
	});

	it("parses a nullable field", () => {
		const result = parseFieldDefs("notes:text:nullable");
		expect(result).toEqual([{ name: "notes", type: "text", nullable: true }]);
	});

	it("parses a field with reference", () => {
		const result = parseFieldDefs("cat_id:uuid:ref=categories");
		expect(result).toEqual([{ name: "cat_id", type: "uuid", references: "categories" }]);
	});

	it("parses multiple modifiers", () => {
		const result = parseFieldDefs("cat_id:uuid:required:ref=categories");
		expect(result).toEqual([
			{ name: "cat_id", type: "uuid", required: true, references: "categories" },
		]);
	});

	it("parses multiple fields comma-separated", () => {
		const result = parseFieldDefs("name:string:required,price:numeric,active:boolean");
		expect(result).toHaveLength(3);
		expect(result[0]?.name).toBe("name");
		expect(result[1]?.name).toBe("price");
		expect(result[2]?.name).toBe("active");
	});

	it("trims whitespace around fields", () => {
		const result = parseFieldDefs(" name:string , price:numeric ");
		expect(result).toHaveLength(2);
		expect(result[0]?.name).toBe("name");
		expect(result[1]?.name).toBe("price");
	});

	it("throws on invalid field type", () => {
		expect(() => parseFieldDefs("foo:invalid")).toThrow(BrickendError);
		try {
			parseFieldDefs("foo:invalid");
		} catch (e) {
			expect((e as BrickendError).code).toBe("INVALID_FIELD_TYPE");
		}
	});

	it("throws on missing type", () => {
		expect(() => parseFieldDefs("foo")).toThrow(BrickendError);
		try {
			parseFieldDefs("foo");
		} catch (e) {
			expect((e as BrickendError).code).toBe("INVALID_FIELD_FORMAT");
		}
	});

	it("throws on unknown modifier", () => {
		expect(() => parseFieldDefs("foo:string:weird")).toThrow(BrickendError);
		try {
			parseFieldDefs("foo:string:weird");
		} catch (e) {
			expect((e as BrickendError).code).toBe("INVALID_FIELD_FORMAT");
		}
	});

	it("throws on empty reference", () => {
		expect(() => parseFieldDefs("foo:uuid:ref=")).toThrow(BrickendError);
	});

	it("supports all valid field types", () => {
		const types = ["string", "text", "email", "uuid", "boolean", "numeric", "url"];
		for (const type of types) {
			const result = parseFieldDefs(`field:${type}`);
			expect(result[0]?.type).toBe(type);
		}
	});
});

// --- createBrickCommand integration tests ---

describe("createBrickCommand", () => {
	let tempDir: string;
	let originalCwd: () => string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "brickend-create-brick-"));
		// Create a valid project state
		const state = initState("test-project", [
			{ name: "admin", description: "Full access", is_default: true },
			{ name: "member", description: "Standard user" },
			{ name: "viewer", description: "Read-only" },
		]);
		await saveState(tempDir, state);

		// Mock process.cwd to return tempDir
		originalCwd = process.cwd;
		process.cwd = () => tempDir;
	});

	afterEach(async () => {
		process.cwd = originalCwd;
		await rm(tempDir, { recursive: true, force: true });
	});

	it("creates manifest at correct path", async () => {
		await createBrickCommand("gadgets", {
			fields: "name:string:required,price:numeric:required",
			noGenerate: true,
		});

		const manifestPath = join(tempDir, "brickend", "gadgets", "gadgets.bricks.yaml");
		const exists = await Bun.file(manifestPath).exists();
		expect(exists).toBe(true);
	});

	it("generates valid YAML that passes BrickSpecSchema", async () => {
		await createBrickCommand("gadgets", {
			fields: "name:string:required,price:numeric:required",
			owner: true,
			searchField: "name",
			noGenerate: true,
		});

		const manifestPath = join(tempDir, "brickend", "gadgets", "gadgets.bricks.yaml");
		const content = await Bun.file(manifestPath).text();
		const parsed = parseYaml(content);
		const result = BrickSpecSchema.safeParse(parsed);
		expect(result.success).toBe(true);
	});

	it("registers brick in state with empty files/hashes when --no-generate", async () => {
		await createBrickCommand("invoices", {
			fields: "title:string:required",
			noGenerate: true,
		});

		const state = await loadState(tempDir);
		const brick = state.bricks.invoices;
		expect(brick).toBeDefined();
		expect(brick?.version).toBe("1.0.0");
		expect(brick?.type).toBe("brick");
		expect(brick?.files).toEqual([]);
		expect(brick?.fileHashes).toEqual({});
		expect(brick?.specSnapshot).toBeUndefined();
		expect(brick?.installed_at).toBeTruthy();
	});

	it("generates PK with gen_random_uuid() default", async () => {
		await createBrickCommand("invoices", { noGenerate: true });

		const manifestPath = join(tempDir, "brickend", "invoices", "invoices.bricks.yaml");
		const parsed = parseYaml(await Bun.file(manifestPath).text());
		const pk = parsed.schema.fields[0];
		expect(pk.name).toBe("invoice_id");
		expect(pk.type).toBe("uuid");
		expect(pk.default).toBe("gen_random_uuid()");
	});

	it("singularizes table name for PK", async () => {
		await createBrickCommand("categories", { table: "categories", noGenerate: true });

		const parsed = parseYaml(
			await Bun.file(join(tempDir, "brickend", "categories", "categories.bricks.yaml")).text(),
		);
		expect(parsed.schema.primary_key).toBe("categorie_id");
	});

	it("uses --primary-key override", async () => {
		await createBrickCommand("categories", { primaryKey: "category_id", noGenerate: true });

		const parsed = parseYaml(
			await Bun.file(join(tempDir, "brickend", "categories", "categories.bricks.yaml")).text(),
		);
		expect(parsed.schema.primary_key).toBe("category_id");
		expect(parsed.schema.fields[0].name).toBe("category_id");
	});

	it("adds owner_id when --owner is set", async () => {
		await createBrickCommand("tasks", { owner: true, noGenerate: true });

		const parsed = parseYaml(
			await Bun.file(join(tempDir, "brickend", "tasks", "tasks.bricks.yaml")).text(),
		);
		const ownerField = parsed.schema.fields.find((f: { name: string }) => f.name === "owner_id");
		expect(ownerField).toBeDefined();
		expect(ownerField.references).toBe("auth");
	});

	it("auto-adds auth to requires when --owner is set", async () => {
		await createBrickCommand("tasks", { owner: true, noGenerate: true });

		const parsed = parseYaml(
			await Bun.file(join(tempDir, "brickend", "tasks", "tasks.bricks.yaml")).text(),
		);
		const authReq = parsed.requires.find((r: { brick: string }) => r.brick === "auth");
		expect(authReq).toBeDefined();
	});

	it("generates all 5 endpoints by default", async () => {
		await createBrickCommand("items", { noGenerate: true });

		const parsed = parseYaml(
			await Bun.file(join(tempDir, "brickend", "items", "items.bricks.yaml")).text(),
		);
		expect(parsed.api.endpoints).toHaveLength(5);
		const handlers = parsed.api.endpoints.map((e: { handler: string }) => e.handler);
		expect(handlers).toContain("list");
		expect(handlers).toContain("get");
		expect(handlers).toContain("create");
		expect(handlers).toContain("update");
		expect(handlers).toContain("softDelete");
	});

	it("generates only specified endpoints from --endpoints", async () => {
		await createBrickCommand("items", { endpoints: "list,get,create", noGenerate: true });

		const parsed = parseYaml(
			await Bun.file(join(tempDir, "brickend", "items", "items.bricks.yaml")).text(),
		);
		expect(parsed.api.endpoints).toHaveLength(3);
	});

	it("populates access rules from state roles", async () => {
		await createBrickCommand("items", { noGenerate: true });

		const parsed = parseYaml(
			await Bun.file(join(tempDir, "brickend", "items", "items.bricks.yaml")).text(),
		);
		expect(parsed.access).toHaveLength(3);
		const roleNames = parsed.access.map((a: { role: string }) => a.role);
		expect(roleNames).toContain("admin");
		expect(roleNames).toContain("member");
		expect(roleNames).toContain("viewer");
	});

	it("sets own_only for non-default roles when --owner is set", async () => {
		await createBrickCommand("items", { owner: true, noGenerate: true });

		const parsed = parseYaml(
			await Bun.file(join(tempDir, "brickend", "items", "items.bricks.yaml")).text(),
		);
		const admin = parsed.access.find((a: { role: string }) => a.role === "admin");
		const member = parsed.access.find((a: { role: string }) => a.role === "member");
		expect(admin.own_only).toBe(false);
		expect(member.own_only).toBe(true);
	});

	it("sets search_field on api section", async () => {
		await createBrickCommand("items", {
			fields: "title:string:required",
			searchField: "title",
			noGenerate: true,
		});

		const parsed = parseYaml(
			await Bun.file(join(tempDir, "brickend", "items", "items.bricks.yaml")).text(),
		);
		expect(parsed.api.search_field).toBe("title");
	});

	it("auto-adds referenced bricks to requires", async () => {
		await createBrickCommand("shipments", {
			fields: "customer_id:uuid:required:ref=entities",
			owner: true,
			noGenerate: true,
		});

		const parsed = parseYaml(
			await Bun.file(join(tempDir, "brickend", "shipments", "shipments.bricks.yaml")).text(),
		);
		const reqs = parsed.requires.map((r: { brick: string }) => r.brick);
		expect(reqs).toContain("auth");
		expect(reqs).toContain("entities");
	});

	it("dry-run does not write file or modify state", async () => {
		const stateBefore = await loadState(tempDir);
		const brickCountBefore = Object.keys(stateBefore.bricks).length;

		await createBrickCommand("phantom", { dryRun: true });

		const manifestPath = join(tempDir, "brickend", "phantom", "phantom.bricks.yaml");
		const exists = await Bun.file(manifestPath).exists();
		expect(exists).toBe(false);

		const stateAfter = await loadState(tempDir);
		expect(Object.keys(stateAfter.bricks).length).toBe(brickCountBefore);
	});

	it("throws on name conflict with existing state brick", async () => {
		// First create
		await createBrickCommand("items", { noGenerate: true });

		// Second create should fail
		try {
			await createBrickCommand("items", {});
			expect(true).toBe(false);
		} catch (e) {
			expect(e).toBeInstanceOf(BrickendError);
			expect((e as BrickendError).code).toBe("BRICK_NAME_CONFLICT");
		}
	});

	it("throws on invalid brick name", async () => {
		try {
			await createBrickCommand("My-Brick", {});
			expect(true).toBe(false);
		} catch (e) {
			expect(e).toBeInstanceOf(BrickendError);
			expect((e as BrickendError).code).toBe("INVALID_BRICK_NAME");
		}
	});

	it("throws on invalid brick name starting with number", async () => {
		try {
			await createBrickCommand("123brick", {});
			expect(true).toBe(false);
		} catch (e) {
			expect(e).toBeInstanceOf(BrickendError);
			expect((e as BrickendError).code).toBe("INVALID_BRICK_NAME");
		}
	});

	it("throws when search field not in fields", async () => {
		try {
			await createBrickCommand("items", {
				fields: "name:string",
				searchField: "nonexistent",
			});
			expect(true).toBe(false);
		} catch (e) {
			expect(e).toBeInstanceOf(BrickendError);
			expect((e as BrickendError).code).toBe("INVALID_SEARCH_FIELD");
		}
	});

	it("scaffold mode (no flags) produces valid YAML with defaults", async () => {
		await createBrickCommand("widgets", { noGenerate: true });

		const manifestPath = join(tempDir, "brickend", "widgets", "widgets.bricks.yaml");
		const content = await Bun.file(manifestPath).text();
		const parsed = parseYaml(content);
		const result = BrickSpecSchema.safeParse(parsed);
		expect(result.success).toBe(true);

		// Should have just the PK field
		expect(parsed.schema.fields).toHaveLength(1);
		expect(parsed.schema.fields[0].name).toBe("widget_id");

		// All 5 endpoints
		expect(parsed.api.endpoints).toHaveLength(5);

		// All 3 roles in access
		expect(parsed.access).toHaveLength(3);
	});

	it("uses custom version", async () => {
		await createBrickCommand("items", { version: "2.0.0", noGenerate: true });

		const state = await loadState(tempDir);
		expect(state.bricks.items?.version).toBe("2.0.0");

		const parsed = parseYaml(
			await Bun.file(join(tempDir, "brickend", "items", "items.bricks.yaml")).text(),
		);
		expect(parsed.brick.version).toBe("2.0.0");
	});

	it("uses custom table name", async () => {
		await createBrickCommand("inventory", { table: "inventory_items", noGenerate: true });

		const parsed = parseYaml(
			await Bun.file(join(tempDir, "brickend", "inventory", "inventory.bricks.yaml")).text(),
		);
		expect(parsed.schema.table).toBe("inventory_items");
		expect(parsed.schema.primary_key).toBe("inventory_item_id");
	});

	it("sets auth_required to false with --no-auth-required", async () => {
		await createBrickCommand("public_items", { authRequired: false, noGenerate: true });

		const parsed = parseYaml(
			await Bun.file(join(tempDir, "brickend", "public_items", "public_items.bricks.yaml")).text(),
		);
		expect(parsed.api.auth_required).toBe(false);
	});
});
