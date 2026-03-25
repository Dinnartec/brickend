import { describe, expect, it } from "bun:test";
import type { BrickSpec } from "../../src/core/brick-spec.ts";
import {
	computeFileHash,
	computeFileHashes,
	type GeneratedFile,
} from "../../src/core/file-writer.ts";
import { generateAlterMigrationSql } from "../../src/core/generator.ts";
import type { BrickSpecDiff } from "../../src/core/spec-diff.ts";
import { diffBrickSpecs } from "../../src/core/spec-diff.ts";

// ---------------------------------------------------------------------------
// Hash utilities
// ---------------------------------------------------------------------------

describe("computeFileHash", () => {
	it("returns a consistent SHA-256 hex digest", () => {
		const hash = computeFileHash("hello world");
		expect(hash).toMatch(/^[a-f0-9]{64}$/);
		expect(computeFileHash("hello world")).toBe(hash);
	});

	it("returns different hashes for different content", () => {
		const h1 = computeFileHash("content A");
		const h2 = computeFileHash("content B");
		expect(h1).not.toBe(h2);
	});
});

describe("computeFileHashes", () => {
	it("maps file paths to hashes", () => {
		const files: GeneratedFile[] = [
			{ path: "a.ts", content: "const a = 1;" },
			{ path: "b.ts", content: "const b = 2;" },
		];
		const hashes = computeFileHashes(files);
		expect(Object.keys(hashes)).toHaveLength(2);
		expect(hashes["a.ts"]).toBe(computeFileHash("const a = 1;"));
		expect(hashes["b.ts"]).toBe(computeFileHash("const b = 2;"));
	});
});

// ---------------------------------------------------------------------------
// ALTER TABLE migration SQL
// ---------------------------------------------------------------------------

function makeSpec(overrides: Partial<BrickSpec> = {}): BrickSpec {
	return {
		brick: { name: "items", version: "1.0.0", description: "Items brick", type: "brick" },
		requires: [],
		extensions: [],
		config: {},
		schema: {
			db_schema: "public",
			table: "items",
			primary_key: "item_id",
			fields: [
				{ name: "item_id", type: "uuid", required: true },
				{ name: "name", type: "string", required: true },
			],
			indexes: [],
			constraints: { create: {}, update: {} },
		},
		api: {
			type: "rest",
			auth_required: true,
			endpoints: [
				{ method: "GET", path: "/", handler: "listItems", has_pagination: true },
				{ method: "POST", path: "/", handler: "createItem", status: 201 },
			],
		},
		access: [{ role: "admin", actions: ["listItems", "createItem"], own_only: false }],
		...overrides,
	};
}

describe("generateAlterMigrationSql", () => {
	it("generates ADD COLUMN for new fields", () => {
		const oldSpec = makeSpec();
		const newSpec = makeSpec({
			schema: {
				...oldSpec.schema!,
				fields: [
					...oldSpec.schema!.fields,
					{ name: "description", type: "text" },
				],
			},
		});

		const diff = diffBrickSpecs(oldSpec, newSpec);
		const sql = generateAlterMigrationSql(
			newSpec.schema!,
			"items",
			{},
			diff,
			newSpec.access,
			false,
		);

		expect(sql).toContain("ALTER TABLE items ADD COLUMN description text;");
	});

	it("generates NOT NULL for required fields", () => {
		const oldSpec = makeSpec();
		const newSpec = makeSpec({
			schema: {
				...oldSpec.schema!,
				fields: [
					...oldSpec.schema!.fields,
					{ name: "code", type: "string", required: true, default: "'UNKNOWN'" },
				],
			},
		});

		const diff = diffBrickSpecs(oldSpec, newSpec);
		const sql = generateAlterMigrationSql(
			newSpec.schema!,
			"items",
			{},
			diff,
			newSpec.access,
			false,
		);

		expect(sql).toContain("NOT NULL");
		expect(sql).toContain("DEFAULT 'UNKNOWN'");
	});

	it("emits WARNING for required fields without default", () => {
		const oldSpec = makeSpec();
		const newSpec = makeSpec({
			schema: {
				...oldSpec.schema!,
				fields: [
					...oldSpec.schema!.fields,
					{ name: "code", type: "string", required: true },
				],
			},
		});

		const diff = diffBrickSpecs(oldSpec, newSpec);
		const sql = generateAlterMigrationSql(
			newSpec.schema!,
			"items",
			{},
			diff,
			newSpec.access,
			false,
		);

		expect(sql).toContain("WARNING");
	});

	it("generates DROP COLUMN for removed fields", () => {
		const oldSpec = makeSpec();
		const newSpec = makeSpec({
			schema: {
				...oldSpec.schema!,
				fields: [oldSpec.schema!.fields[0]!],
			},
		});

		const diff = diffBrickSpecs(oldSpec, newSpec);
		const sql = generateAlterMigrationSql(
			newSpec.schema!,
			"items",
			{},
			diff,
			newSpec.access,
			false,
		);

		expect(sql).toContain("DROP COLUMN IF EXISTS name");
	});

	it("emits TODO comment for changed field types", () => {
		const oldSpec = makeSpec();
		const newSpec = makeSpec({
			schema: {
				...oldSpec.schema!,
				fields: [
					oldSpec.schema!.fields[0]!,
					{ name: "name", type: "text", required: true },
				],
			},
		});

		const diff = diffBrickSpecs(oldSpec, newSpec);
		const sql = generateAlterMigrationSql(
			newSpec.schema!,
			"items",
			{},
			diff,
			newSpec.access,
			false,
		);

		expect(sql).toContain("TODO");
		expect(sql).toContain("name");
	});

	it("generates permission update for access changes", () => {
		const oldSpec = makeSpec();
		const newSpec = makeSpec({
			access: [
				{ role: "admin", actions: ["listItems", "createItem", "deleteItem"], own_only: false },
			],
		});

		const diff = diffBrickSpecs(oldSpec, newSpec);
		const sql = generateAlterMigrationSql(
			newSpec.schema!,
			"items",
			{},
			diff,
			newSpec.access,
			false,
		);

		expect(sql).toContain("DELETE FROM rbac.permissions WHERE resource = 'items'");
		expect(sql).toContain("INSERT INTO rbac.permissions");
	});

	it("returns empty string when no schema table (auth brick)", () => {
		const emptyDiff: BrickSpecDiff = {
			fieldsAdded: [],
			fieldsRemoved: [],
			fieldsChanged: [],
			endpointsAdded: [],
			endpointsRemoved: [],
			accessChanged: false,
			configChanged: false,
		};

		const sql = generateAlterMigrationSql(
			{ fields: [], indexes: [], constraints: { create: {}, update: {} }, db_schema: "public" },
			"auth",
			{},
			emptyDiff,
			[],
			false,
		);

		expect(sql).toBe("");
	});

	it("uses qualified table name for non-public schema", () => {
		const oldSpec = makeSpec({
			schema: {
				...makeSpec().schema!,
				db_schema: "catalog",
			},
		});
		const newSpec = makeSpec({
			schema: {
				...makeSpec().schema!,
				db_schema: "catalog",
				fields: [
					...makeSpec().schema!.fields,
					{ name: "sku", type: "string" },
				],
			},
		});

		const diff = diffBrickSpecs(oldSpec, newSpec);
		const sql = generateAlterMigrationSql(
			newSpec.schema!,
			"items",
			{},
			diff,
			[],
			false,
		);

		expect(sql).toContain("ALTER TABLE catalog.items ADD COLUMN sku text;");
	});

	it("handles FK references in added fields", () => {
		const oldSpec = makeSpec();
		const newSpec = makeSpec({
			schema: {
				...oldSpec.schema!,
				fields: [
					...oldSpec.schema!.fields,
					{ name: "owner_id", type: "uuid", references: "auth" },
				],
			},
		});

		const diff = diffBrickSpecs(oldSpec, newSpec);
		const sql = generateAlterMigrationSql(
			newSpec.schema!,
			"items",
			{},
			diff,
			newSpec.access,
			false,
		);

		expect(sql).toContain("REFERENCES auth.users(id) ON DELETE CASCADE");
	});
});
