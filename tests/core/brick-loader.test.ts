import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { createBrickLoader } from "../../src/core/brick-loader.ts";
import { BrickendError } from "../../src/core/errors.ts";

const FIXTURES_DIR = join(import.meta.dir, "../fixtures/bricks");

describe("Brick Loader", () => {
	const loader = createBrickLoader(FIXTURES_DIR);

	describe("loadBrickSpec", () => {
		it("loads and validates a valid brick spec", async () => {
			const spec = await loader.loadBrickSpec("test-brick");
			expect(spec.brick.name).toBe("test-brick");
			expect(spec.brick.version).toBe("1.0.0");
			expect(spec.brick.description).toBe("A test brick for unit tests");
			expect(spec.requires).toEqual([]);
			expect(spec.extensions).toEqual([]);
			expect(spec.config.some_option?.default).toBe("hello");
			expect(spec.schema).toBeDefined();
			expect(spec.schema?.table).toBe("test_items");
			expect(spec.schema?.primary_key).toBe("test_id");
			expect(spec.schema?.db_schema).toBe("public");
		});

		it("loads a brick with dependencies", async () => {
			const spec = await loader.loadBrickSpec("dep-brick");
			expect(spec.requires).toHaveLength(1);
			expect(spec.requires[0]?.brick).toBe("test-brick");
			expect(spec.requires[0]?.version).toBe(">=1.0.0");
		});

		it("throws BRICK_NOT_FOUND for nonexistent brick", async () => {
			try {
				await loader.loadBrickSpec("nonexistent");
				expect(true).toBe(false);
			} catch (e) {
				expect(e).toBeInstanceOf(BrickendError);
				expect((e as BrickendError).code).toBe("BRICK_NOT_FOUND");
			}
		});
	});

	describe("listAvailableBricks", () => {
		it("returns all valid bricks sorted by name", async () => {
			const bricks = await loader.listAvailableBricks();
			expect(bricks.length).toBe(2);
			expect(bricks[0]?.brick.name).toBe("dep-brick");
			expect(bricks[1]?.brick.name).toBe("test-brick");
		});

		it("returns empty array for nonexistent directory", async () => {
			const emptyLoader = createBrickLoader("/nonexistent/path");
			const bricks = await emptyLoader.listAvailableBricks();
			expect(bricks).toEqual([]);
		});
	});
});
