import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { statusCommand } from "../../src/cli/status.ts";
import { BrickendError } from "../../src/core/errors.ts";
import { initState, saveState } from "../../src/core/state.ts";

describe("statusCommand", () => {
	let tempDir: string;
	let originalCwd: () => string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "brickend-status-test-"));
		originalCwd = process.cwd;
		process.cwd = () => tempDir;
	});

	afterEach(async () => {
		process.cwd = originalCwd;
		await rm(tempDir, { recursive: true, force: true });
	});

	it("completes without error for a project with bricks", async () => {
		const state = initState("my-project", [
			{ name: "admin", description: "Admin role" },
			{ name: "user", description: "User role", is_default: true },
		]);
		state.bricks.auth = {
			version: "1.0.0",
			installed_at: new Date().toISOString(),
			config: {},
			files: ["functions/auth/index.ts", "migrations/001_auth.sql"],
		};
		state.bricks.users = {
			version: "1.0.0",
			installed_at: new Date().toISOString(),
			config: {},
			files: ["functions/users/index.ts", "schemas/users.ts", "migrations/002_users.sql"],
		};
		await saveState(tempDir, state);

		await expect(statusCommand()).resolves.toBeUndefined();
	});

	it("completes without error for a project with no bricks", async () => {
		const state = initState("empty-project");
		await saveState(tempDir, state);

		await expect(statusCommand()).resolves.toBeUndefined();
	});

	it("throws STATE_NOT_FOUND outside a project", async () => {
		try {
			await statusCommand();
			expect(true).toBe(false); // should not reach
		} catch (e) {
			expect(e).toBeInstanceOf(BrickendError);
			expect((e as BrickendError).code).toBe("STATE_NOT_FOUND");
		}
	});

	it("shows extension bricks correctly", async () => {
		const state = initState("ext-project");
		state.bricks.catalog = {
			version: "1.0.0",
			installed_at: new Date().toISOString(),
			config: {},
			files: ["functions/catalog/index.ts"],
		};
		state.bricks["catalog-categories"] = {
			version: "1.0.0",
			type: "extension",
			installed_at: new Date().toISOString(),
			config: {},
			files: ["functions/catalog-categories/index.ts"],
		};
		await saveState(tempDir, state);

		await expect(statusCommand()).resolves.toBeUndefined();
	});
});
