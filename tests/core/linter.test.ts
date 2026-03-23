import { describe, expect, it } from "bun:test";
import type { BrickSpec } from "../../src/core/brick-spec.ts";
import { lintBrickSpec } from "../../src/core/linter.ts";

/** Minimal valid BrickSpec for use as a base in tests. */
function makeSpec(overrides: Partial<BrickSpec> = {}): BrickSpec {
	return {
		brick: { name: "my-brick", version: "1.0.0", description: "Test" },
		requires: [],
		extensions: [],
		config: {},
		access: [],
		...overrides,
	};
}

describe("linter", () => {
	describe("semver-valid", () => {
		it("passes for a valid semver version", () => {
			const diags = lintBrickSpec(makeSpec());
			expect(diags.filter((d) => d.rule === "semver-valid")).toHaveLength(0);
		});

		it("errors when brick.version is not valid semver", () => {
			const diags = lintBrickSpec(
				makeSpec({ brick: { name: "x", version: "not-semver", description: "" } }),
			);
			const rule = diags.find((d) => d.rule === "semver-valid");
			expect(rule).toBeDefined();
			expect(rule?.severity).toBe("error");
			expect(rule?.path).toBe("brick.version");
		});

		it("errors when requires[].version is not a valid semver range", () => {
			const diags = lintBrickSpec(
				makeSpec({ requires: [{ brick: "other", version: "not-a-range!!" }] }),
			);
			const rule = diags.find((d) => d.rule === "semver-valid" && d.path.startsWith("requires"));
			expect(rule).toBeDefined();
			expect(rule?.severity).toBe("error");
		});

		it("accepts semver ranges in requires", () => {
			const diags = lintBrickSpec(makeSpec({ requires: [{ brick: "other", version: ">=1.0.0" }] }));
			expect(diags.filter((d) => d.rule === "semver-valid")).toHaveLength(0);
		});

		it("errors when extensions[].version is invalid", () => {
			const diags = lintBrickSpec(
				makeSpec({ extensions: [{ brick: "ext", version: "??invalid" }] }),
			);
			const rule = diags.find((d) => d.rule === "semver-valid" && d.path.startsWith("extensions"));
			expect(rule).toBeDefined();
			expect(rule?.severity).toBe("error");
		});
	});

	describe("name-matches-dir", () => {
		it("passes for lowercase snake_case name", () => {
			const diags = lintBrickSpec(makeSpec());
			expect(diags.filter((d) => d.rule === "name-matches-dir")).toHaveLength(0);
		});

		it("passes for kebab-case name", () => {
			const diags = lintBrickSpec(
				makeSpec({ brick: { name: "my-brick", version: "1.0.0", description: "" } }),
			);
			expect(diags.filter((d) => d.rule === "name-matches-dir")).toHaveLength(0);
		});

		it("warns when name contains uppercase letters", () => {
			const diags = lintBrickSpec(
				makeSpec({ brick: { name: "MyBrick", version: "1.0.0", description: "" } }),
			);
			const rule = diags.find((d) => d.rule === "name-matches-dir");
			expect(rule).toBeDefined();
			expect(rule?.severity).toBe("warning");
		});

		it("warns when name contains spaces", () => {
			const diags = lintBrickSpec(
				makeSpec({ brick: { name: "my brick", version: "1.0.0", description: "" } }),
			);
			const rule = diags.find((d) => d.rule === "name-matches-dir");
			expect(rule).toBeDefined();
			expect(rule?.severity).toBe("warning");
		});
	});

	describe("pk-in-fields", () => {
		it("passes when primary_key matches a field name", () => {
			const diags = lintBrickSpec(
				makeSpec({
					schema: {
						db_schema: "public",
						table: "items",
						primary_key: "item_id",
						fields: [{ name: "item_id", type: "uuid" }],
						indexes: [],
						constraints: { create: {}, update: {} },
					},
				}),
			);
			expect(diags.filter((d) => d.rule === "pk-in-fields")).toHaveLength(0);
		});

		it("errors when primary_key does not match any field", () => {
			const diags = lintBrickSpec(
				makeSpec({
					schema: {
						db_schema: "public",
						table: "items",
						primary_key: "nonexistent_id",
						fields: [{ name: "item_id", type: "uuid" }],
						indexes: [],
						constraints: { create: {}, update: {} },
					},
				}),
			);
			const rule = diags.find((d) => d.rule === "pk-in-fields");
			expect(rule).toBeDefined();
			expect(rule?.severity).toBe("error");
			expect(rule?.message).toContain("nonexistent_id");
		});

		it("skips check when fields array is empty", () => {
			const diags = lintBrickSpec(
				makeSpec({
					schema: {
						db_schema: "public",
						table: "items",
						primary_key: "item_id",
						fields: [],
						indexes: [],
						constraints: { create: {}, update: {} },
					},
				}),
			);
			expect(diags.filter((d) => d.rule === "pk-in-fields")).toHaveLength(0);
		});
	});

	describe("uuid-reference-type", () => {
		it("passes when auth-referencing field has type uuid", () => {
			const diags = lintBrickSpec(
				makeSpec({
					schema: {
						db_schema: "public",
						table: "items",
						fields: [{ name: "owner_id", type: "uuid", references: "auth" }],
						indexes: [],
						constraints: { create: {}, update: {} },
					},
				}),
			);
			expect(diags.filter((d) => d.rule === "uuid-reference-type")).toHaveLength(0);
		});

		it("errors when auth-referencing field does not have type uuid", () => {
			const diags = lintBrickSpec(
				makeSpec({
					schema: {
						db_schema: "public",
						table: "items",
						fields: [{ name: "owner_id", type: "string", references: "auth" }],
						indexes: [],
						constraints: { create: {}, update: {} },
					},
				}),
			);
			const rule = diags.find((d) => d.rule === "uuid-reference-type");
			expect(rule).toBeDefined();
			expect(rule?.severity).toBe("error");
			expect(rule?.message).toContain("owner_id");
		});

		it("ignores non-auth references", () => {
			const diags = lintBrickSpec(
				makeSpec({
					schema: {
						db_schema: "public",
						table: "items",
						fields: [{ name: "id_type", type: "string", references: "identification_types" }],
						indexes: [],
						constraints: { create: {}, update: {} },
					},
				}),
			);
			expect(diags.filter((d) => d.rule === "uuid-reference-type")).toHaveLength(0);
		});
	});

	describe("auth-no-table", () => {
		it("passes when api.type is auth and no schema.table", () => {
			const diags = lintBrickSpec(
				makeSpec({
					schema: {
						db_schema: "public",
						fields: [],
						indexes: [],
						constraints: { create: {}, update: {} },
					},
					api: { type: "auth", auth_required: false, endpoints: [] },
				}),
			);
			expect(diags.filter((d) => d.rule === "auth-no-table")).toHaveLength(0);
		});

		it("warns when api.type is auth and schema.table is defined", () => {
			const diags = lintBrickSpec(
				makeSpec({
					schema: {
						db_schema: "public",
						table: "auth_data",
						fields: [],
						indexes: [],
						constraints: { create: {}, update: {} },
					},
					api: { type: "auth", auth_required: false, endpoints: [] },
				}),
			);
			const rule = diags.find((d) => d.rule === "auth-no-table");
			expect(rule).toBeDefined();
			expect(rule?.severity).toBe("warning");
		});
	});

	describe("rest-needs-table", () => {
		it("passes when api.type is rest with endpoints and schema.table is defined", () => {
			const diags = lintBrickSpec(
				makeSpec({
					schema: {
						db_schema: "public",
						table: "items",
						fields: [],
						indexes: [],
						constraints: { create: {}, update: {} },
					},
					api: {
						type: "rest",
						auth_required: false,
						endpoints: [{ method: "GET", path: "/", handler: "list" }],
					},
				}),
			);
			expect(diags.filter((d) => d.rule === "rest-needs-table")).toHaveLength(0);
		});

		it("errors when api.type is rest with endpoints but no schema.table", () => {
			const diags = lintBrickSpec(
				makeSpec({
					api: {
						type: "rest",
						auth_required: false,
						endpoints: [{ method: "GET", path: "/", handler: "list" }],
					},
				}),
			);
			const rule = diags.find((d) => d.rule === "rest-needs-table");
			expect(rule).toBeDefined();
			expect(rule?.severity).toBe("error");
		});

		it("passes when api.type is rest with no endpoints (no table needed)", () => {
			const diags = lintBrickSpec(
				makeSpec({
					api: { type: "rest", auth_required: false, endpoints: [] },
				}),
			);
			expect(diags.filter((d) => d.rule === "rest-needs-table")).toHaveLength(0);
		});
	});

	describe("pagination-on-get", () => {
		it("passes when has_pagination is on a GET endpoint", () => {
			const diags = lintBrickSpec(
				makeSpec({
					schema: {
						db_schema: "public",
						table: "items",
						fields: [],
						indexes: [],
						constraints: { create: {}, update: {} },
					},
					api: {
						type: "rest",
						auth_required: false,
						endpoints: [{ method: "GET", path: "/", handler: "list", has_pagination: true }],
					},
				}),
			);
			expect(diags.filter((d) => d.rule === "pagination-on-get")).toHaveLength(0);
		});

		it("errors when has_pagination is on a POST endpoint", () => {
			const diags = lintBrickSpec(
				makeSpec({
					schema: {
						db_schema: "public",
						table: "items",
						fields: [],
						indexes: [],
						constraints: { create: {}, update: {} },
					},
					api: {
						type: "rest",
						auth_required: false,
						endpoints: [{ method: "POST", path: "/", handler: "create", has_pagination: true }],
					},
				}),
			);
			const rule = diags.find((d) => d.rule === "pagination-on-get");
			expect(rule).toBeDefined();
			expect(rule?.severity).toBe("error");
		});
	});

	describe("handler-identifier", () => {
		it("passes for valid JS identifiers", () => {
			const handlers = ["list", "get", "create", "softDelete", "_internal", "$special"];
			for (const handler of handlers) {
				const diags = lintBrickSpec(
					makeSpec({
						schema: {
							db_schema: "public",
							table: "items",
							fields: [],
							indexes: [],
							constraints: { create: {}, update: {} },
						},
						api: {
							type: "rest",
							auth_required: false,
							endpoints: [{ method: "GET", path: "/", handler }],
						},
					}),
				);
				expect(diags.filter((d) => d.rule === "handler-identifier")).toHaveLength(0);
			}
		});

		it("errors when handler contains hyphens", () => {
			const diags = lintBrickSpec(
				makeSpec({
					schema: {
						db_schema: "public",
						table: "items",
						fields: [],
						indexes: [],
						constraints: { create: {}, update: {} },
					},
					api: {
						type: "rest",
						auth_required: false,
						endpoints: [{ method: "GET", path: "/", handler: "soft-delete" }],
					},
				}),
			);
			const rule = diags.find((d) => d.rule === "handler-identifier");
			expect(rule).toBeDefined();
			expect(rule?.severity).toBe("error");
		});

		it("errors when handler starts with a digit", () => {
			const diags = lintBrickSpec(
				makeSpec({
					schema: {
						db_schema: "public",
						table: "items",
						fields: [],
						indexes: [],
						constraints: { create: {}, update: {} },
					},
					api: {
						type: "rest",
						auth_required: false,
						endpoints: [{ method: "GET", path: "/", handler: "1badHandler" }],
					},
				}),
			);
			const rule = diags.find((d) => d.rule === "handler-identifier");
			expect(rule).toBeDefined();
			expect(rule?.severity).toBe("error");
		});
	});

	describe("access-actions-match-handlers", () => {
		it("passes when all access actions match endpoint handlers", () => {
			const diags = lintBrickSpec(
				makeSpec({
					schema: {
						db_schema: "public",
						table: "items",
						fields: [],
						indexes: [],
						constraints: { create: {}, update: {} },
					},
					api: {
						type: "rest",
						auth_required: true,
						endpoints: [
							{ method: "GET", path: "/", handler: "list" },
							{ method: "POST", path: "/", handler: "create" },
						],
					},
					access: [{ role: "admin", actions: ["list", "create"], own_only: false }],
				}),
			);
			expect(diags.filter((d) => d.rule === "access-actions-match-handlers")).toHaveLength(0);
		});

		it("errors when access action does not match any handler", () => {
			const diags = lintBrickSpec(
				makeSpec({
					schema: {
						db_schema: "public",
						table: "items",
						fields: [],
						indexes: [],
						constraints: { create: {}, update: {} },
					},
					api: {
						type: "rest",
						auth_required: true,
						endpoints: [{ method: "GET", path: "/", handler: "list" }],
					},
					access: [{ role: "admin", actions: ["list", "nonexistent"], own_only: false }],
				}),
			);
			const rule = diags.find((d) => d.rule === "access-actions-match-handlers");
			expect(rule).toBeDefined();
			expect(rule?.severity).toBe("error");
			expect(rule?.message).toContain("nonexistent");
		});
	});

	describe("access-own-only-needs-owner", () => {
		it("passes when own_only is true and schema has auth-referencing field", () => {
			const diags = lintBrickSpec(
				makeSpec({
					schema: {
						db_schema: "public",
						table: "items",
						primary_key: "item_id",
						fields: [
							{ name: "item_id", type: "uuid" },
							{ name: "owner_id", type: "uuid", references: "auth" },
						],
						indexes: [],
						constraints: { create: {}, update: {} },
					},
					api: {
						type: "rest",
						auth_required: true,
						endpoints: [{ method: "GET", path: "/", handler: "list" }],
					},
					access: [{ role: "member", actions: ["list"], own_only: true }],
				}),
			);
			expect(diags.filter((d) => d.rule === "access-own-only-needs-owner")).toHaveLength(0);
		});

		it("warns when own_only is true but no auth-referencing field", () => {
			const diags = lintBrickSpec(
				makeSpec({
					schema: {
						db_schema: "public",
						table: "items",
						primary_key: "item_id",
						fields: [{ name: "item_id", type: "uuid" }],
						indexes: [],
						constraints: { create: {}, update: {} },
					},
					api: {
						type: "rest",
						auth_required: true,
						endpoints: [{ method: "GET", path: "/", handler: "list" }],
					},
					access: [{ role: "member", actions: ["list"], own_only: true }],
				}),
			);
			const rule = diags.find((d) => d.rule === "access-own-only-needs-owner");
			expect(rule).toBeDefined();
			expect(rule?.severity).toBe("warning");
		});
	});
});
