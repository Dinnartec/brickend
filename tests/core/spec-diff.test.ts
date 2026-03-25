import { describe, expect, it } from "bun:test";
import type { BrickSpec } from "../../src/core/brick-spec.ts";
import { diffBrickSpecs, isDiffEmpty } from "../../src/core/spec-diff.ts";

function makeSpec(overrides: Partial<BrickSpec> = {}): BrickSpec {
	return {
		brick: { name: "test", version: "1.0.0", description: "Test brick", type: "brick" },
		requires: [],
		extensions: [],
		config: {},
		schema: {
			db_schema: "public",
			table: "tests",
			primary_key: "test_id",
			fields: [
				{ name: "test_id", type: "uuid", required: true },
				{ name: "name", type: "string", required: true },
			],
			indexes: [],
			constraints: { create: {}, update: {} },
		},
		api: {
			type: "rest",
			auth_required: true,
			endpoints: [
				{ method: "GET", path: "/", handler: "listTests", has_pagination: true },
				{ method: "POST", path: "/", handler: "createTest", status: 201 },
			],
		},
		access: [{ role: "admin", actions: ["listTests", "createTest"], own_only: false }],
		...overrides,
	};
}

describe("diffBrickSpecs", () => {
	it("returns empty diff for identical specs", () => {
		const spec = makeSpec();
		const diff = diffBrickSpecs(spec, spec);
		expect(isDiffEmpty(diff)).toBe(true);
	});

	it("detects added fields", () => {
		const oldSpec = makeSpec();
		const newSpec = makeSpec({
			schema: {
				...oldSpec.schema!,
				fields: [
					...oldSpec.schema!.fields,
					{ name: "email", type: "email", required: false },
				],
			},
		});

		const diff = diffBrickSpecs(oldSpec, newSpec);
		expect(diff.fieldsAdded).toHaveLength(1);
		expect(diff.fieldsAdded[0]?.name).toBe("email");
		expect(diff.fieldsRemoved).toHaveLength(0);
		expect(isDiffEmpty(diff)).toBe(false);
	});

	it("detects removed fields", () => {
		const oldSpec = makeSpec();
		const newSpec = makeSpec({
			schema: {
				...oldSpec.schema!,
				fields: [oldSpec.schema!.fields[0]!],
			},
		});

		const diff = diffBrickSpecs(oldSpec, newSpec);
		expect(diff.fieldsRemoved).toHaveLength(1);
		expect(diff.fieldsRemoved[0]?.name).toBe("name");
		expect(diff.fieldsAdded).toHaveLength(0);
	});

	it("detects changed field types", () => {
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
		expect(diff.fieldsChanged).toHaveLength(1);
		expect(diff.fieldsChanged[0]?.old.type).toBe("string");
		expect(diff.fieldsChanged[0]?.new.type).toBe("text");
	});

	it("detects changed field required flag", () => {
		const oldSpec = makeSpec();
		const newSpec = makeSpec({
			schema: {
				...oldSpec.schema!,
				fields: [
					oldSpec.schema!.fields[0]!,
					{ name: "name", type: "string", required: false },
				],
			},
		});

		const diff = diffBrickSpecs(oldSpec, newSpec);
		expect(diff.fieldsChanged).toHaveLength(1);
	});

	it("detects added endpoints", () => {
		const oldSpec = makeSpec();
		const newSpec = makeSpec({
			api: {
				...oldSpec.api!,
				endpoints: [
					...oldSpec.api!.endpoints,
					{ method: "DELETE", path: "/:id", handler: "deleteTest" },
				],
			},
		});

		const diff = diffBrickSpecs(oldSpec, newSpec);
		expect(diff.endpointsAdded).toHaveLength(1);
		expect(diff.endpointsAdded[0]?.handler).toBe("deleteTest");
		expect(diff.endpointsRemoved).toHaveLength(0);
	});

	it("detects removed endpoints", () => {
		const oldSpec = makeSpec();
		const newSpec = makeSpec({
			api: {
				...oldSpec.api!,
				endpoints: [oldSpec.api!.endpoints[0]!],
			},
		});

		const diff = diffBrickSpecs(oldSpec, newSpec);
		expect(diff.endpointsRemoved).toHaveLength(1);
		expect(diff.endpointsRemoved[0]?.handler).toBe("createTest");
	});

	it("detects access rule changes", () => {
		const oldSpec = makeSpec();
		const newSpec = makeSpec({
			access: [
				{ role: "admin", actions: ["listTests", "createTest", "deleteTest"], own_only: false },
			],
		});

		const diff = diffBrickSpecs(oldSpec, newSpec);
		expect(diff.accessChanged).toBe(true);
	});

	it("detects config changes", () => {
		const oldSpec = makeSpec();
		const newSpec = makeSpec({
			config: {
				new_key: { description: "A new config", type: "string", default: "val" },
			},
		});

		const diff = diffBrickSpecs(oldSpec, newSpec);
		expect(diff.configChanged).toBe(true);
	});

	it("handles specs with no schema", () => {
		const oldSpec = makeSpec({ schema: undefined });
		const newSpec = makeSpec({ schema: undefined });

		const diff = diffBrickSpecs(oldSpec, newSpec);
		expect(isDiffEmpty(diff)).toBe(true);
	});

	it("handles specs with no api", () => {
		const oldSpec = makeSpec({ api: undefined });
		const newSpec = makeSpec({ api: undefined });

		const diff = diffBrickSpecs(oldSpec, newSpec);
		expect(isDiffEmpty(diff)).toBe(true);
	});
});
