import { mkdir, readdir as readdirFs } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { installBrick, updateBrickendYaml, writeApiDocs } from "../cli/add.ts";
import { createBrickLoader } from "../core/brick-loader.ts";
import { BrickendError } from "../core/errors.ts";
import type { GeneratedFile } from "../core/file-writer.ts";
import { writeFiles } from "../core/file-writer.ts";
import { initState, loadState, saveState } from "../core/state.ts";
import { runSupabase } from "../core/supabase.ts";
import { createTemplateLoader } from "../core/template-loader.ts";
import type { TemplateSpec } from "../core/template-spec.ts";
import type { RoleConfig } from "../core/templates/index.ts";
import {
	authCoreTemplate,
	brickendYamlTemplate,
	corsTemplate,
	deployScriptTemplate,
	envExampleTemplate,
	errorsTemplate,
	gitignoreTemplate,
	rbacMiddlewareTemplate,
	rbacMigrationTemplate,
	readmeTemplate,
	responsesTemplate,
	supabaseClientTemplate,
} from "../core/templates/index.ts";

const PROJECT_NAME_REGEX = /^[a-z0-9][a-z0-9-]*$/;
const BASELINE_BRICKS = ["identification_types", "auth", "users"];

// --- Tool input schemas ---

export const InitInputSchema = z.object({
	project_name: z.string().describe("Project name (lowercase alphanumeric + hyphens)"),
	template: z.string().optional().describe("Template name: starter, business, or multi-tenant"),
	bricks: z.array(z.string()).optional().describe("Additional bricks to install after baseline"),
	parent_dir: z.string().optional().describe("Parent directory (defaults to cwd)"),
});

export const AddInputSchema = z.object({
	brick_name: z.string().describe("Name of the brick to install"),
	project_path: z.string().optional().describe("Path to the Brickend project (defaults to cwd)"),
	config: z
		.record(z.unknown())
		.optional()
		.describe("Config overrides for the brick (key-value pairs)"),
});

export const StatusInputSchema = z.object({
	project_path: z.string().optional().describe("Path to the Brickend project (defaults to cwd)"),
});

// --- Tool handlers ---

export async function handleInit(input: z.infer<typeof InitInputSchema>) {
	const { project_name, template, bricks, parent_dir } = input;

	// 1. Validate name
	if (!PROJECT_NAME_REGEX.test(project_name)) {
		throw new BrickendError(
			`Invalid project name "${project_name}". Use lowercase alphanumeric characters and hyphens.`,
			"INVALID_NAME",
		);
	}

	const parentDir = parent_dir ?? process.cwd();
	const projectDir = join(parentDir, project_name);

	if (await Bun.file(join(projectDir, "brickend.state.json")).exists()) {
		throw new BrickendError(
			`Directory "${project_name}" already contains a Brickend project.`,
			"ALREADY_EXISTS",
		);
	}

	// 2. Create project directory
	await mkdir(projectDir, { recursive: true });

	// 3. Git init
	const gitResult = Bun.spawnSync(["git", "init"], { cwd: projectDir, stderr: "pipe" });
	if (gitResult.exitCode !== 0) {
		throw new BrickendError("git init failed", "INIT_FAILED", {
			stderr: gitResult.stderr.toString(),
		});
	}

	// 4. Supabase init
	const supaResult = runSupabase(["init"], { cwd: projectDir });
	if (supaResult.exitCode !== 0 && !supaResult.stderr.includes("already initialized")) {
		throw new BrickendError("supabase init failed", "INIT_FAILED", {
			stderr: supaResult.stderr,
		});
	}

	// 5. Patch config.toml for auth JWT
	const configTomlPath = join(projectDir, "supabase/config.toml");
	const existingConfig = await Bun.file(configTomlPath).text();
	await Bun.write(configTomlPath, `${existingConfig}\n[functions.auth]\nverify_jwt = false\n`);

	// 6. Resolve template
	let selectedTemplate: TemplateSpec | null = null;
	if (template) {
		const templateLoader = createTemplateLoader();
		selectedTemplate = await templateLoader.loadTemplateSpec(template);
	}

	// 7. Resolve roles and settings
	const resolvedRoles: RoleConfig[] = selectedTemplate
		? selectedTemplate.roles.map((r) => ({
				name: r.name,
				description: r.description,
				is_default: r.is_default,
			}))
		: [
				{ name: "admin", description: "Full access to all resources", is_default: true },
				{ name: "member", description: "Standard user with limited access" },
				{ name: "viewer", description: "Read-only access" },
			];

	const resolvedSettings: Record<string, unknown> = selectedTemplate?.settings ?? {};
	const templateName: string | undefined = selectedTemplate?.template.name;
	const multiTenant = resolvedSettings.multi_tenant === true;

	// 8. Create shared directories
	const sharedDirs = [
		"supabase/functions/_shared/core",
		"supabase/functions/_shared/schemas",
		"supabase/functions/_shared/services",
	];
	for (const dir of sharedDirs) {
		await mkdir(join(projectDir, dir), { recursive: true });
	}

	// 9. Generate shared core files
	const sharedFiles: GeneratedFile[] = [
		{ path: "supabase/functions/_shared/core/cors.ts", content: corsTemplate(multiTenant) },
		{ path: "supabase/functions/_shared/core/errors.ts", content: errorsTemplate() },
		{ path: "supabase/functions/_shared/core/supabase.ts", content: supabaseClientTemplate() },
		{ path: "supabase/functions/_shared/core/responses.ts", content: responsesTemplate() },
		{ path: "supabase/functions/_shared/core/auth.ts", content: authCoreTemplate() },
		{
			path: "supabase/functions/_shared/core/rbac.ts",
			content: rbacMiddlewareTemplate(multiTenant),
		},
	];

	const configFiles: GeneratedFile[] = [
		{
			path: "brickend.yaml",
			content: brickendYamlTemplate(project_name, resolvedRoles, {
				template: templateName,
				settings: resolvedSettings,
			}),
		},
		{ path: ".env.example", content: envExampleTemplate() },
		{ path: ".gitignore", content: gitignoreTemplate() },
	];

	await writeFiles(projectDir, sharedFiles);
	await writeFiles(projectDir, configFiles);

	// 10. RBAC infrastructure migration
	const rbacMigResult = runSupabase(["migration", "new", "rbac_infrastructure"], {
		cwd: projectDir,
	});
	if (rbacMigResult.exitCode !== 0) {
		throw new BrickendError("supabase migration new rbac_infrastructure failed", "INIT_FAILED", {
			stderr: rbacMigResult.stderr,
		});
	}

	const migDir = join(projectDir, "supabase/migrations");
	const migFiles = (await readdirFs(migDir)).filter((f) => f.endsWith(".sql")).sort();
	const rbacMigFile = migFiles.find((f) => f.includes("rbac_infrastructure"));
	if (rbacMigFile) {
		await Bun.write(join(migDir, rbacMigFile), rbacMigrationTemplate(resolvedRoles, multiTenant));
	}

	// 11. Expose rbac schema in config.toml
	const configTomlContent = await Bun.file(configTomlPath).text();
	const schemaMatch = configTomlContent.match(/^(schemas\s*=\s*\[)([^\]]*)\]/m);
	if (schemaMatch && !schemaMatch[2]?.includes('"rbac"')) {
		const updated = configTomlContent.replace(
			/^(schemas\s*=\s*\[)([^\]]*)\]/m,
			`$1${schemaMatch[2]?.trimEnd()}, "rbac"]`,
		);
		await Bun.write(configTomlPath, updated);
	}

	// 12. Create initial state
	const state = initState(project_name, resolvedRoles, {
		template: templateName,
		settings: resolvedSettings,
	});
	await saveState(projectDir, state);

	// 13. Install baseline bricks
	const brickLoader = createBrickLoader();

	let baselineBricks: Array<{ name: string; config: Record<string, unknown> }>;
	if (selectedTemplate) {
		baselineBricks = selectedTemplate.baseline.map((b) => ({ name: b.brick, config: b.config }));
		if (multiTenant && !baselineBricks.some((b) => b.name === "workspaces")) {
			baselineBricks.push({ name: "workspaces", config: {} });
		}
	} else {
		const names = multiTenant ? [...BASELINE_BRICKS, "workspaces"] : [...BASELINE_BRICKS];
		baselineBricks = names.map((name) => ({ name, config: {} }));
	}

	for (const brick of baselineBricks) {
		const configOverrides = Object.keys(brick.config).length > 0 ? brick.config : undefined;
		await installBrick(brick.name, projectDir, brickLoader, undefined, configOverrides);
	}

	// 14. Install extra bricks
	const extraBricksInstalled: string[] = [];
	if (bricks && bricks.length > 0) {
		const baselineNames = baselineBricks.map((b) => b.name);
		const extras = bricks.filter((b) => !baselineNames.includes(b));
		for (const brickName of extras) {
			await installBrick(brickName, projectDir, brickLoader);
			extraBricksInstalled.push(brickName);
		}
	}

	// 15. Generate README, deploy script, API docs + brickend.yaml
	const finalState = await loadState(projectDir);
	const readmeContent = readmeTemplate(project_name, Object.keys(finalState.bricks));
	await Bun.write(join(projectDir, "README.md"), readmeContent);
	await mkdir(join(projectDir, "scripts"), { recursive: true });
	await Bun.write(join(projectDir, "scripts/deploy.sh"), deployScriptTemplate(project_name));
	await writeApiDocs(projectDir, brickLoader);
	await updateBrickendYaml(projectDir, finalState);

	return {
		projectDir,
		template: templateName ?? null,
		baselineBricks: baselineBricks.map((b) => b.name),
		extraBricks: extraBricksInstalled,
		installedBricks: Object.keys(finalState.bricks),
		state: finalState,
	};
}

export async function handleAdd(input: z.infer<typeof AddInputSchema>) {
	const { brick_name, project_path, config } = input;
	const projectPath = project_path ?? process.cwd();

	const state = await loadState(projectPath);
	const brickLoader = createBrickLoader();

	await installBrick(brick_name, projectPath, brickLoader, state, config);

	const updatedState = await loadState(projectPath);
	await writeApiDocs(projectPath, brickLoader);
	await updateBrickendYaml(projectPath, updatedState);

	return {
		brick: brick_name,
		alreadyInstalled: !updatedState.bricks[brick_name],
		installedBricks: Object.keys(updatedState.bricks),
		state: updatedState,
	};
}

export async function handleStatus(input: z.infer<typeof StatusInputSchema>) {
	const projectPath = input.project_path ?? process.cwd();
	const state = await loadState(projectPath);
	return state;
}

export async function handleListTemplates() {
	const loader = createTemplateLoader();
	const templates = await loader.listAvailableTemplates();
	return templates.map((t) => ({
		name: t.template.name,
		description: t.template.description,
		multi_tenant: t.settings?.multi_tenant === true,
		roles: t.roles.map((r) => ({ name: r.name, is_default: r.is_default ?? false })),
		baseline: t.baseline.map((b) => b.brick),
		optional: t.bricks?.map((b) => b.brick) ?? [],
	}));
}

export async function handleListBricks() {
	const loader = createBrickLoader();
	const bricks = await loader.listAvailableBricks();
	return bricks.map((b) => ({
		name: b.brick.name,
		version: b.brick.version,
		description: b.brick.description,
		type: b.brick.type ?? "brick",
		requires: b.requires?.map((r) => r.brick) ?? [],
		endpoints: b.api?.endpoints?.map((e) => `${e.method} ${e.path}`) ?? [],
	}));
}
