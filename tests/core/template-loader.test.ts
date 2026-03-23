import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrickendError } from "../../src/core/errors.ts";
import { createTemplateLoader } from "../../src/core/template-loader.ts";
import { TemplateSpecSchema } from "../../src/core/template-spec.ts";

describe("Template Loader", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = join(tmpdir(), `brickend-tpl-test-${Date.now()}`);
		await mkdir(tempDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	const VALID_TEMPLATE = `
template:
  name: test
  version: "1.0.0"
  description: "Test template"
settings:
  multi_tenant: false
roles:
  - name: admin
    description: "Admin role"
    is_default: true
  - name: viewer
    description: "Viewer role"
baseline:
  - { brick: auth, version: ">=1.0.0" }
bricks:
  - { brick: entities, version: ">=1.0.0" }
`;

	describe("loadTemplateSpec", () => {
		it("loads a valid template", async () => {
			await Bun.write(join(tempDir, "test.template.yaml"), VALID_TEMPLATE);
			const loader = createTemplateLoader(tempDir);
			const spec = await loader.loadTemplateSpec("test");

			expect(spec.template.name).toBe("test");
			expect(spec.template.version).toBe("1.0.0");
			expect(spec.settings).toEqual({ multi_tenant: false });
			expect(spec.roles).toHaveLength(2);
			expect(spec.roles[0]?.name).toBe("admin");
			expect(spec.roles[0]?.is_default).toBe(true);
			expect(spec.baseline).toHaveLength(1);
			expect(spec.baseline[0]?.brick).toBe("auth");
			expect(spec.bricks).toHaveLength(1);
			expect(spec.bricks[0]?.brick).toBe("entities");
		});

		it("throws TEMPLATE_NOT_FOUND for missing template", async () => {
			const loader = createTemplateLoader(tempDir);
			try {
				await loader.loadTemplateSpec("nonexistent");
				expect(true).toBe(false);
			} catch (e) {
				expect(e).toBeInstanceOf(BrickendError);
				expect((e as BrickendError).code).toBe("TEMPLATE_NOT_FOUND");
			}
		});

		it("throws TEMPLATE_INVALID for bad YAML", async () => {
			await Bun.write(join(tempDir, "bad.template.yaml"), "{{invalid yaml");
			const loader = createTemplateLoader(tempDir);
			try {
				await loader.loadTemplateSpec("bad");
				expect(true).toBe(false);
			} catch (e) {
				expect(e).toBeInstanceOf(BrickendError);
				expect((e as BrickendError).code).toBe("TEMPLATE_INVALID");
			}
		});

		it("throws TEMPLATE_INVALID for schema mismatch", async () => {
			await Bun.write(join(tempDir, "invalid.template.yaml"), "name: missing-structure\n");
			const loader = createTemplateLoader(tempDir);
			try {
				await loader.loadTemplateSpec("invalid");
				expect(true).toBe(false);
			} catch (e) {
				expect(e).toBeInstanceOf(BrickendError);
				expect((e as BrickendError).code).toBe("TEMPLATE_INVALID");
			}
		});

		it("defaults settings and bricks to empty when omitted", async () => {
			const minimal = `
template:
  name: minimal
  version: "1.0.0"
  description: "Minimal"
roles:
  - name: admin
    description: "Admin"
    is_default: true
baseline:
  - { brick: auth, version: ">=1.0.0" }
`;
			await Bun.write(join(tempDir, "minimal.template.yaml"), minimal);
			const loader = createTemplateLoader(tempDir);
			const spec = await loader.loadTemplateSpec("minimal");

			expect(spec.settings).toEqual({});
			expect(spec.bricks).toEqual([]);
		});

		it("supports config overrides in brick refs", async () => {
			const withConfig = `
template:
  name: withconfig
  version: "1.0.0"
  description: "With config"
roles:
  - name: admin
    description: "Admin"
    is_default: true
baseline:
  - brick: auth
    version: ">=1.0.0"
    config:
      jwt_secret: "custom-secret"
bricks: []
`;
			await Bun.write(join(tempDir, "withconfig.template.yaml"), withConfig);
			const loader = createTemplateLoader(tempDir);
			const spec = await loader.loadTemplateSpec("withconfig");

			expect(spec.baseline[0]?.config).toEqual({ jwt_secret: "custom-secret" });
		});
	});

	describe("listAvailableTemplates", () => {
		it("lists all valid templates", async () => {
			await Bun.write(join(tempDir, "test.template.yaml"), VALID_TEMPLATE);
			const loader = createTemplateLoader(tempDir);
			const templates = await loader.listAvailableTemplates();

			expect(templates).toHaveLength(1);
			expect(templates[0]?.template.name).toBe("test");
		});

		it("returns empty array for empty directory", async () => {
			const loader = createTemplateLoader(tempDir);
			const templates = await loader.listAvailableTemplates();
			expect(templates).toEqual([]);
		});

		it("returns empty array for nonexistent directory", async () => {
			const loader = createTemplateLoader("/nonexistent/path");
			const templates = await loader.listAvailableTemplates();
			expect(templates).toEqual([]);
		});

		it("skips templates where filename does not match spec name", async () => {
			const mismatch = VALID_TEMPLATE.replace("name: test", "name: different");
			await Bun.write(join(tempDir, "test.template.yaml"), mismatch);
			const loader = createTemplateLoader(tempDir);
			const templates = await loader.listAvailableTemplates();
			expect(templates).toEqual([]);
		});

		it("skips invalid template files silently", async () => {
			await Bun.write(join(tempDir, "bad.template.yaml"), "not: valid: template");
			await Bun.write(join(tempDir, "test.template.yaml"), VALID_TEMPLATE);
			const loader = createTemplateLoader(tempDir);
			const templates = await loader.listAvailableTemplates();
			expect(templates).toHaveLength(1);
		});
	});

	describe("loads bundled templates", () => {
		it("loads starter template from bricks/templates/", async () => {
			const loader = createTemplateLoader();
			const spec = await loader.loadTemplateSpec("starter");

			expect(spec.template.name).toBe("starter");
			expect(spec.baseline.length).toBeGreaterThanOrEqual(3);
			expect(spec.roles.length).toBeGreaterThanOrEqual(2);
		});

		it("loads business template from bricks/templates/", async () => {
			const loader = createTemplateLoader();
			const spec = await loader.loadTemplateSpec("business");

			expect(spec.template.name).toBe("business");
			expect(spec.baseline.length).toBeGreaterThanOrEqual(5);
		});

		it("lists all bundled templates", async () => {
			const loader = createTemplateLoader();
			const templates = await loader.listAvailableTemplates();

			expect(templates.length).toBeGreaterThanOrEqual(2);
			const names = templates.map((t) => t.template.name);
			expect(names).toContain("starter");
			expect(names).toContain("business");
		});
	});
});

describe("TemplateSpecSchema", () => {
	it("validates a complete template spec", () => {
		const raw = {
			template: { name: "test", version: "1.0.0", description: "Test" },
			settings: { multi_tenant: true },
			roles: [{ name: "admin", is_default: true }],
			baseline: [{ brick: "auth", version: ">=1.0.0" }],
			bricks: [{ brick: "users", version: ">=1.0.0" }],
		};
		const result = TemplateSpecSchema.safeParse(raw);
		expect(result.success).toBe(true);
	});

	it("rejects missing roles", () => {
		const raw = {
			template: { name: "test", version: "1.0.0", description: "Test" },
			baseline: [{ brick: "auth", version: ">=1.0.0" }],
		};
		const result = TemplateSpecSchema.safeParse(raw);
		expect(result.success).toBe(false);
	});

	it("rejects missing baseline", () => {
		const raw = {
			template: { name: "test", version: "1.0.0", description: "Test" },
			roles: [{ name: "admin" }],
		};
		const result = TemplateSpecSchema.safeParse(raw);
		expect(result.success).toBe(false);
	});

	it("defaults config in brick refs to empty object", () => {
		const raw = {
			template: { name: "test", version: "1.0.0", description: "Test" },
			roles: [{ name: "admin" }],
			baseline: [{ brick: "auth", version: ">=1.0.0" }],
		};
		const result = TemplateSpecSchema.safeParse(raw);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.baseline[0]?.config).toEqual({});
		}
	});
});

describe("State with template fields", () => {
	it("initState stores template and settings", async () => {
		const { initState, saveState, loadState } = await import("../../src/core/state.ts");

		const state = initState("test-project", [{ name: "admin", is_default: true }], {
			template: "business",
			settings: { multi_tenant: false },
		});

		expect(state.template).toBe("business");
		expect(state.settings).toEqual({ multi_tenant: false });

		// Roundtrip
		const dir = join(tmpdir(), `brickend-state-tpl-${Date.now()}`);
		await mkdir(dir, { recursive: true });
		try {
			await saveState(dir, state);
			const loaded = await loadState(dir);
			expect(loaded.template).toBe("business");
			expect(loaded.settings).toEqual({ multi_tenant: false });
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("initState defaults template and settings when not provided", () => {
		const { initState } = require("../../src/core/state.ts");
		const state = initState("test-project");
		expect(state.template).toBeUndefined();
		expect(state.settings).toEqual({});
	});
});
