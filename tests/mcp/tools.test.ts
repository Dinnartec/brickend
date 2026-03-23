import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrickendError } from "../../src/core/errors.ts";
import { initState, saveState } from "../../src/core/state.ts";
import {
	AddInputSchema,
	handleAdd,
	handleInit,
	handleListBricks,
	handleListTemplates,
	handleStatus,
	InitInputSchema,
	StatusInputSchema,
} from "../../src/mcp/tools.ts";

describe("MCP Tools", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "brickend-mcp-test-"));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	describe("brickend_init", () => {
		it("rejects invalid project names", async () => {
			try {
				await handleInit({ project_name: "INVALID NAME!" });
				expect(true).toBe(false);
			} catch (e) {
				expect(e).toBeInstanceOf(BrickendError);
				expect((e as BrickendError).code).toBe("INVALID_NAME");
			}
		});

		it("rejects project names starting with hyphen", async () => {
			try {
				await handleInit({ project_name: "-bad-name" });
				expect(true).toBe(false);
			} catch (e) {
				expect(e).toBeInstanceOf(BrickendError);
				expect((e as BrickendError).code).toBe("INVALID_NAME");
			}
		});

		it("validates input schema correctly", () => {
			const valid = InitInputSchema.safeParse({
				project_name: "my-project",
				template: "starter",
				bricks: ["catalog"],
			});
			expect(valid.success).toBe(true);

			const invalid = InitInputSchema.safeParse({});
			expect(invalid.success).toBe(false);

			const invalidName = InitInputSchema.safeParse({ project_name: 123 });
			expect(invalidName.success).toBe(false);
		});

		it("rejects already-existing project", async () => {
			// Create a fake state file so it thinks a project exists
			const projectDir = join(tempDir, "existing-project");
			const { mkdir } = await import("node:fs/promises");
			await mkdir(projectDir, { recursive: true });
			const state = initState("existing-project");
			await saveState(projectDir, state);

			try {
				await handleInit({ project_name: "existing-project", parent_dir: tempDir });
				expect(true).toBe(false);
			} catch (e) {
				expect(e).toBeInstanceOf(BrickendError);
				expect((e as BrickendError).code).toBe("ALREADY_EXISTS");
			}
		});
	});

	describe("brickend_add", () => {
		it("validates input schema correctly", () => {
			const valid = AddInputSchema.safeParse({
				brick_name: "catalog",
				project_path: "/some/path",
				config: { key: "value" },
			});
			expect(valid.success).toBe(true);

			const minimal = AddInputSchema.safeParse({ brick_name: "catalog" });
			expect(minimal.success).toBe(true);

			const invalid = AddInputSchema.safeParse({});
			expect(invalid.success).toBe(false);
		});

		it("throws when project does not exist", async () => {
			try {
				await handleAdd({ brick_name: "catalog", project_path: tempDir });
				expect(true).toBe(false);
			} catch (e) {
				expect(e).toBeInstanceOf(BrickendError);
				expect((e as BrickendError).code).toBe("STATE_NOT_FOUND");
			}
		});
	});

	describe("brickend_status", () => {
		it("validates input schema correctly", () => {
			const valid = StatusInputSchema.safeParse({});
			expect(valid.success).toBe(true);

			const withPath = StatusInputSchema.safeParse({ project_path: "/some/path" });
			expect(withPath.success).toBe(true);
		});

		it("returns state for a valid project", async () => {
			const state = initState("test-project", [
				{ name: "admin", description: "Admin role", is_default: true },
			]);
			state.bricks.auth = {
				version: "1.0.0",
				type: "brick",
				installed_at: new Date().toISOString(),
				config: {},
				files: ["supabase/functions/auth/index.ts"],
			};
			await saveState(tempDir, state);

			const result = await handleStatus({ project_path: tempDir });
			expect(result.project).toBe("test-project");
			expect(result.bricks.auth).toBeDefined();
			expect(result.bricks.auth?.version).toBe("1.0.0");
			expect(result.roles).toHaveLength(1);
		});

		it("throws when project does not exist", async () => {
			try {
				await handleStatus({ project_path: join(tempDir, "nonexistent") });
				expect(true).toBe(false);
			} catch (e) {
				expect(e).toBeInstanceOf(BrickendError);
				expect((e as BrickendError).code).toBe("STATE_NOT_FOUND");
			}
		});
	});

	describe("brickend_list_templates", () => {
		it("returns available templates", async () => {
			const result = await handleListTemplates();
			expect(result.length).toBeGreaterThanOrEqual(3);
			const names = result.map((t: { name: string }) => t.name);
			expect(names).toContain("starter");
			expect(names).toContain("business");
			expect(names).toContain("multi-tenant");
		});

		it("includes roles and baseline bricks", async () => {
			const result = await handleListTemplates();
			const starter = result.find((t: { name: string }) => t.name === "starter");
			expect(starter).toBeDefined();
			expect(starter.roles.length).toBeGreaterThanOrEqual(3);
			expect(starter.baseline).toContain("auth");
			expect(starter.baseline).toContain("users");
		});
	});

	describe("brickend_list_bricks", () => {
		it("returns available bricks", async () => {
			const result = await handleListBricks();
			expect(result.length).toBeGreaterThanOrEqual(6);
			const names = result.map((b: { name: string }) => b.name);
			expect(names).toContain("auth");
			expect(names).toContain("users");
			expect(names).toContain("entities");
		});

		it("includes description and type", async () => {
			const result = await handleListBricks();
			const auth = result.find((b: { name: string }) => b.name === "auth");
			expect(auth).toBeDefined();
			expect(auth.description).toBeTruthy();
			expect(auth.type).toBe("brick");
		});
	});
});
