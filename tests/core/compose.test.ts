import { describe, expect, it } from "bun:test";
import type { BrickSpec } from "../../src/core/brick-loader.ts";
import { canInstall, checkDependencies, getInstallOrder } from "../../src/core/compose.ts";
import { BrickendError } from "../../src/core/errors.ts";
import { initState } from "../../src/core/state.ts";

// Mock brick specs
function mockSpec(
	name: string,
	requires: Array<{ brick: string; version: string }> = [],
	extensions: Array<{ brick: string; version: string }> = [],
): BrickSpec {
	return {
		brick: { name, version: "1.0.0", description: `${name} brick` },
		requires,
		extensions,
		config: {},
	};
}

function mockLoadSpec(specs: Record<string, BrickSpec>) {
	return async (name: string): Promise<BrickSpec> => {
		const spec = specs[name];
		if (!spec) throw new BrickendError(`Brick "${name}" not found`, "BRICK_NOT_FOUND");
		return spec;
	};
}

describe("Dependency Resolution", () => {
	describe("checkDependencies", () => {
		it("returns satisfied when all deps are installed", () => {
			const spec = mockSpec("users", [{ brick: "auth", version: ">=1.0.0" }]);
			const installed = {
				auth: {
					version: "1.0.0",
					installed_at: new Date().toISOString(),
					config: {},
					files: [],
				},
			};
			const result = checkDependencies(spec, installed);
			expect(result.satisfied).toBe(true);
			expect(result.missing).toEqual([]);
		});

		it("returns missing when a dep is not installed", () => {
			const spec = mockSpec("users", [{ brick: "auth", version: ">=1.0.0" }]);
			const result = checkDependencies(spec, {});
			expect(result.satisfied).toBe(false);
			expect(result.missing).toHaveLength(1);
			expect(result.missing[0]?.brick).toBe("auth");
		});

		it("returns missing when version does not satisfy", () => {
			const spec = mockSpec("users", [{ brick: "auth", version: ">=2.0.0" }]);
			const installed = {
				auth: {
					version: "1.5.0",
					installed_at: new Date().toISOString(),
					config: {},
					files: [],
				},
			};
			const result = checkDependencies(spec, installed);
			expect(result.satisfied).toBe(false);
			expect(result.missing[0]?.brick).toBe("auth");
		});

		it("returns satisfied for brick with no deps", () => {
			const spec = mockSpec("auth");
			const result = checkDependencies(spec, {});
			expect(result.satisfied).toBe(true);
		});

		it("returns missing extensions that are not installed", () => {
			const spec = mockSpec(
				"catalog",
				[{ brick: "entities", version: ">=1.0.0" }],
				[
					{ brick: "catalog-item-types", version: ">=1.0.0" },
					{ brick: "catalog-categories", version: ">=1.0.0" },
				],
			);
			const installed = {
				entities: {
					version: "1.0.0",
					installed_at: new Date().toISOString(),
					config: {},
					files: [],
				},
			};
			const result = checkDependencies(spec, installed);
			expect(result.satisfied).toBe(false);
			expect(result.missing).toHaveLength(2);
			expect(result.missing.map((m) => m.brick)).toContain("catalog-item-types");
			expect(result.missing.map((m) => m.brick)).toContain("catalog-categories");
		});

		it("returns satisfied when both requires and extensions are installed", () => {
			const spec = mockSpec(
				"catalog",
				[{ brick: "entities", version: ">=1.0.0" }],
				[{ brick: "catalog-item-types", version: ">=1.0.0" }],
			);
			const installed = {
				entities: {
					version: "1.0.0",
					installed_at: new Date().toISOString(),
					config: {},
					files: [],
				},
				"catalog-item-types": {
					version: "1.0.0",
					installed_at: new Date().toISOString(),
					config: {},
					files: [],
				},
			};
			const result = checkDependencies(spec, installed);
			expect(result.satisfied).toBe(true);
		});
	});

	describe("getInstallOrder", () => {
		it("returns correct topological order", async () => {
			const specs = {
				auth: mockSpec("auth"),
				users: mockSpec("users", [{ brick: "auth", version: ">=1.0.0" }]),
				entities: mockSpec("entities", [{ brick: "auth", version: ">=1.0.0" }]),
			};
			const order = await getInstallOrder(["entities", "users", "auth"], mockLoadSpec(specs));
			expect(order.indexOf("auth")).toBeLessThan(order.indexOf("users"));
			expect(order.indexOf("auth")).toBeLessThan(order.indexOf("entities"));
		});

		it("auto-discovers transitive dependencies", async () => {
			const specs = {
				auth: mockSpec("auth"),
				users: mockSpec("users", [{ brick: "auth", version: ">=1.0.0" }]),
			};
			// Only request "users" — should auto-include "auth"
			const order = await getInstallOrder(["users"], mockLoadSpec(specs));
			expect(order).toEqual(["auth", "users"]);
		});

		it("returns single brick with no deps", async () => {
			const specs = { auth: mockSpec("auth") };
			const order = await getInstallOrder(["auth"], mockLoadSpec(specs));
			expect(order).toEqual(["auth"]);
		});

		it("detects circular dependency", async () => {
			const specs = {
				a: mockSpec("a", [{ brick: "b", version: ">=1.0.0" }]),
				b: mockSpec("b", [{ brick: "a", version: ">=1.0.0" }]),
			};
			try {
				await getInstallOrder(["a"], mockLoadSpec(specs));
				expect(true).toBe(false);
			} catch (e) {
				expect(e).toBeInstanceOf(BrickendError);
				expect((e as BrickendError).code).toBe("CIRCULAR_DEPENDENCY");
			}
		});

		it("installs extensions before the main brick", async () => {
			const specs = {
				"catalog-item-types": mockSpec("catalog-item-types"),
				"catalog-categories": mockSpec("catalog-categories"),
				catalog: mockSpec(
					"catalog",
					[],
					[
						{ brick: "catalog-item-types", version: ">=1.0.0" },
						{ brick: "catalog-categories", version: ">=1.0.0" },
					],
				),
			};
			const order = await getInstallOrder(["catalog"], mockLoadSpec(specs));
			expect(order.indexOf("catalog-item-types")).toBeLessThan(order.indexOf("catalog"));
			expect(order.indexOf("catalog-categories")).toBeLessThan(order.indexOf("catalog"));
		});

		it("extensions are auto-discovered from main brick", async () => {
			const specs = {
				"catalog-item-types": mockSpec("catalog-item-types"),
				catalog: mockSpec("catalog", [], [{ brick: "catalog-item-types", version: ">=1.0.0" }]),
			};
			// Only request "catalog" — should auto-include extension
			const order = await getInstallOrder(["catalog"], mockLoadSpec(specs));
			expect(order).toContain("catalog-item-types");
			expect(order.indexOf("catalog-item-types")).toBeLessThan(order.indexOf("catalog"));
		});
	});

	describe("canInstall", () => {
		it("returns ok for installable brick", async () => {
			const specs = { auth: mockSpec("auth") };
			const state = initState("test");
			const result = await canInstall("auth", state, mockLoadSpec(specs));
			expect(result.ok).toBe(true);
		});

		it("returns not ok for already installed brick", async () => {
			const specs = { auth: mockSpec("auth") };
			const state = initState("test");
			state.bricks.auth = {
				version: "1.0.0",
				installed_at: new Date().toISOString(),
				config: {},
				files: [],
			};
			const result = await canInstall("auth", state, mockLoadSpec(specs));
			expect(result.ok).toBe(false);
			expect(result.reason).toContain("already installed");
		});

		it("returns not ok for missing dependency", async () => {
			const specs = {
				auth: mockSpec("auth"),
				users: mockSpec("users", [{ brick: "auth", version: ">=1.0.0" }]),
			};
			const state = initState("test");
			const result = await canInstall("users", state, mockLoadSpec(specs));
			expect(result.ok).toBe(false);
			expect(result.reason).toContain("Missing dependencies");
		});

		it("returns not ok for nonexistent brick", async () => {
			const state = initState("test");
			const result = await canInstall("nonexistent", state, mockLoadSpec({}));
			expect(result.ok).toBe(false);
			expect(result.reason).toContain("not found");
		});

		it("returns not ok when extensions are missing", async () => {
			const specs = {
				"catalog-item-types": mockSpec("catalog-item-types"),
				catalog: mockSpec("catalog", [], [{ brick: "catalog-item-types", version: ">=1.0.0" }]),
			};
			const state = initState("test");
			const result = await canInstall("catalog", state, mockLoadSpec(specs));
			expect(result.ok).toBe(false);
			expect(result.reason).toContain("Missing dependencies");
		});
	});
});
