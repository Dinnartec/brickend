import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrickendError } from "../../src/core/errors.ts";
import { initState, loadState, saveState } from "../../src/core/state.ts";

describe("State Manager", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "brickend-test-"));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	describe("initState", () => {
		it("returns valid state with correct defaults", () => {
			const state = initState("my-api");
			expect(state.project).toBe("my-api");
			expect(state.type).toBe("api");
			expect(state.stack).toBe("typescript/supabase-edge-functions");
			expect(state.bricks).toEqual({});
			expect(state.schemas).toEqual([]);
			expect(state.created_at).toBeTruthy();
			expect(state.updated_at).toBeTruthy();
		});
	});

	describe("saveState + loadState roundtrip", () => {
		it("preserves data through save and load", async () => {
			const state = initState("test-project");
			state.bricks.auth = {
				version: "1.0.0",
				installed_at: new Date().toISOString(),
				config: {},
				files: ["middleware/auth.ts"],
			};
			state.schemas.push("auth.sql");

			await saveState(tempDir, state);
			const loaded = await loadState(tempDir);

			expect(loaded.project).toBe("test-project");
			expect(loaded.bricks.auth?.version).toBe("1.0.0");
			expect(loaded.schemas).toEqual(["auth.sql"]);
		});

		it("updates updated_at on save", async () => {
			const state = initState("test-project");
			const originalUpdatedAt = state.updated_at;

			// Small delay to ensure different timestamp
			await new Promise((r) => setTimeout(r, 10));
			await saveState(tempDir, state);

			const loaded = await loadState(tempDir);
			expect(loaded.updated_at).not.toBe(originalUpdatedAt);
		});
	});

	describe("loadState errors", () => {
		it("throws STATE_NOT_FOUND when file missing", async () => {
			try {
				await loadState(tempDir);
				expect(true).toBe(false); // should not reach
			} catch (e) {
				expect(e).toBeInstanceOf(BrickendError);
				expect((e as BrickendError).code).toBe("STATE_NOT_FOUND");
			}
		});

		it("throws STATE_INVALID when JSON is malformed", async () => {
			await Bun.write(join(tempDir, "brickend.state.json"), "not json{{{");
			try {
				await loadState(tempDir);
				expect(true).toBe(false);
			} catch (e) {
				expect(e).toBeInstanceOf(BrickendError);
				expect((e as BrickendError).code).toBe("STATE_INVALID");
			}
		});

		it("throws STATE_INVALID when schema validation fails", async () => {
			await Bun.write(
				join(tempDir, "brickend.state.json"),
				JSON.stringify({ project: "test", missing: "fields" }),
			);
			try {
				await loadState(tempDir);
				expect(true).toBe(false);
			} catch (e) {
				expect(e).toBeInstanceOf(BrickendError);
				expect((e as BrickendError).code).toBe("STATE_INVALID");
			}
		});
	});
});
