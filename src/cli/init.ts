import { mkdir, readdir as readdirFs } from "node:fs/promises";
import { join } from "node:path";
import * as p from "@clack/prompts";
import chalk from "chalk";
import { createBrickLoader } from "../core/brick-loader.ts";
import { BrickendError } from "../core/errors.ts";
import type { GeneratedFile } from "../core/file-writer.ts";
import { writeFiles } from "../core/file-writer.ts";
import { initState, loadState, saveState } from "../core/state.ts";
import {
	getSupabaseVersion,
	installSupabase,
	runSupabase,
	runSupabaseLive,
} from "../core/supabase.ts";
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
import { installBrick, updateBrickendYaml, writeApiDocs } from "./add.ts";
import { startSpinner } from "./spinner.ts";

const PROJECT_NAME_REGEX = /^[a-z0-9][a-z0-9-]*$/;

// Bricks always installed during init (in order) — fallback when no template selected
const BASELINE_BRICKS = ["identification_types", "auth", "users"];

interface InitOptions {
	bricks?: string;
	template?: string;
	dryRun?: boolean;
}

export async function initCommand(projectName: string, options: InitOptions = {}): Promise<void> {
	const dryRun = options.dryRun ?? false;
	p.intro(chalk.bold(`brickend init ${projectName}${dryRun ? chalk.dim("  [dry run]") : ""}`));

	// 1. Validate project name
	if (!PROJECT_NAME_REGEX.test(projectName)) {
		throw new BrickendError(
			`Invalid project name "${projectName}". Use lowercase alphanumeric characters and hyphens.`,
			"INVALID_NAME",
		);
	}

	const projectDir = join(process.cwd(), projectName);
	if (await Bun.file(join(projectDir, "brickend.state.json")).exists()) {
		throw new BrickendError(
			`Directory "${projectName}" already contains a Brickend project.`,
			"ALREADY_EXISTS",
		);
	}

	// 2. Check prerequisites (skip in dry-run — no tools will be invoked)
	if (!dryRun) {
		await checkPrerequisites();
	}

	// 3. Template selection (before any file creation)
	if (options.template && options.bricks) {
		throw new BrickendError(
			"--template and --bricks are mutually exclusive. Use one or the other.",
			"INVALID_OPTIONS",
		);
	}

	let selectedTemplate: TemplateSpec | null = null;
	const templateLoader = createTemplateLoader();

	if (options.template) {
		// Non-interactive: load specified template
		selectedTemplate = await templateLoader.loadTemplateSpec(options.template);
	} else if (process.stdout.isTTY && !options.bricks) {
		// Interactive: show template picker
		const availableTemplates = await templateLoader.listAvailableTemplates();

		if (availableTemplates.length > 0) {
			const templateOptions = [
				...availableTemplates.map((t) => ({
					value: t.template.name,
					label: t.template.name,
					hint: t.template.description,
				})),
				{ value: "__custom__", label: "Custom", hint: "Manual brick selection" },
			];

			const selected = await p.select({
				message: "Select a project template:",
				options: templateOptions,
			});

			if (p.isCancel(selected)) {
				p.cancel("Operation cancelled.");
				process.exit(0);
			}

			if (selected !== "__custom__") {
				selectedTemplate = availableTemplates.find((t) => t.template.name === selected) ?? null;
			}
		}
	}

	// Resolve roles and settings from template (or defaults)
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

	// 4. Dry-run: print plan and exit early
	if (dryRun) {
		let baselineBricks: string[];
		if (selectedTemplate) {
			baselineBricks = selectedTemplate.baseline.map((b) => b.brick);
			if (multiTenant && !baselineBricks.includes("workspaces")) baselineBricks.push("workspaces");
		} else {
			baselineBricks = multiTenant ? [...BASELINE_BRICKS, "workspaces"] : [...BASELINE_BRICKS];
		}

		const roleNames = resolvedRoles.map((r) => (r.is_default ? `${r.name}*` : r.name)).join(", ");
		const lines = [
			`  Template:     ${templateName ?? "custom"}`,
			`  Roles:        ${roleNames}  (* = default)`,
			`  Multi-tenant: ${multiTenant ? "yes" : "no"}`,
			"",
			"  Would run:",
			"    git init",
			"    supabase init",
			"    Write 9 shared/config files (_shared/core/, brickend.yaml, .env.example, .gitignore)",
			"    Create RBAC migration",
			...baselineBricks.map((b) => `    Install brick: ${b}`),
			"    Write README.md, scripts/deploy.sh, openapi.yaml",
			"    supabase start",
		];
		console.log(lines.join("\n"));
		p.outro(chalk.dim("No files created  (dry run)"));
		return;
	}

	// 4. Create project directory and initialize tools
	const spin = startSpinner("Creating project directory...");
	await mkdir(projectDir, { recursive: true });

	spin.update("Initializing git...");
	try {
		const gitResult = Bun.spawnSync(["git", "init"], { cwd: projectDir, stderr: "pipe" });
		if (gitResult.exitCode !== 0) {
			spin.stop("git init failed", "x");
			throw new BrickendError("git init failed", "INIT_FAILED", {
				stderr: gitResult.stderr.toString(),
			});
		}
	} catch (e) {
		if (e instanceof BrickendError) throw e;
		spin.stop("git init failed", "x");
		throw new BrickendError(
			`git init failed: ${e instanceof Error ? e.message : String(e)}`,
			"INIT_FAILED",
		);
	}

	spin.update("Initializing Supabase...");
	const supaResult = runSupabase(["init"], { cwd: projectDir });
	if (supaResult.exitCode !== 0) {
		if (!supaResult.stderr.includes("already initialized")) {
			spin.stop("supabase init failed", "x");
			throw new BrickendError("supabase init failed", "INIT_FAILED", {
				stderr: supaResult.stderr,
			});
		}
	}

	// Patch config.toml: disable JWT verification for the auth function
	const configTomlPath = join(projectDir, "supabase/config.toml");
	const existingConfig = await Bun.file(configTomlPath).text();
	await Bun.write(configTomlPath, `${existingConfig}\n[functions.auth]\nverify_jwt = false\n`);

	// 4. Create _shared/ directories
	spin.update("Generating project files...");
	const sharedDirs = [
		"supabase/functions/_shared/core",
		"supabase/functions/_shared/schemas",
		"supabase/functions/_shared/services",
	];
	for (const dir of sharedDirs) {
		await mkdir(join(projectDir, dir), { recursive: true });
	}

	// 5. Generate shared core files
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
			content: brickendYamlTemplate(projectName, resolvedRoles, {
				template: templateName,
				settings: resolvedSettings,
			}),
		},
		{ path: ".env.example", content: envExampleTemplate() },
		{ path: ".gitignore", content: gitignoreTemplate() },
	];

	const writtenShared = await writeFiles(projectDir, sharedFiles);
	const writtenConfig = await writeFiles(projectDir, configFiles);

	// 5b. Create RBAC infrastructure migration (must be BEFORE baseline bricks)
	spin.update("Creating RBAC infrastructure...");
	const rbacMigResult = runSupabase(["migration", "new", "rbac_infrastructure"], {
		cwd: projectDir,
	});
	if (rbacMigResult.exitCode !== 0) {
		spin.stop("RBAC migration creation failed", "x");
		throw new BrickendError("supabase migration new rbac_infrastructure failed", "INIT_FAILED", {
			stderr: rbacMigResult.stderr,
		});
	}

	// Find the created migration file and write RBAC SQL into it
	const migDir = join(projectDir, "supabase/migrations");
	const migFiles = (await readdirFs(migDir)).filter((f) => f.endsWith(".sql")).sort();
	const rbacMigFile = migFiles.find((f) => f.includes("rbac_infrastructure"));
	if (rbacMigFile) {
		await Bun.write(join(migDir, rbacMigFile), rbacMigrationTemplate(resolvedRoles, multiTenant));
	}

	// Expose rbac schema in Supabase API config
	const configTomlContent = await Bun.file(configTomlPath).text();
	const schemaMatch = configTomlContent.match(/^(schemas\s*=\s*\[)([^\]]*)\]/m);
	if (schemaMatch && !schemaMatch[2]?.includes('"rbac"')) {
		const updated = configTomlContent.replace(
			/^(schemas\s*=\s*\[)([^\]]*)\]/m,
			`$1${schemaMatch[2]?.trimEnd()}, "rbac"]`,
		);
		await Bun.write(configTomlPath, updated);
	}

	// 6. Create initial state
	const state = initState(projectName, resolvedRoles, {
		template: templateName,
		settings: resolvedSettings,
	});
	await saveState(projectDir, state);

	const totalFiles = writtenShared.length + writtenConfig.length + 1; // +1 for state
	spin.stop(`Project created  (git · supabase · ${totalFiles} files)`);

	// 8. Install baseline bricks (creates migration files — supabase must NOT be
	//    running yet, because `supabase migration new` only needs the local dir)
	const brickLoader = createBrickLoader();
	p.log.step("Installing baseline bricks...");

	let baselineBricks: Array<{ name: string; config: Record<string, unknown> }>;
	if (selectedTemplate) {
		baselineBricks = selectedTemplate.baseline.map((b) => ({ name: b.brick, config: b.config }));
		// Ensure workspaces is in baseline for multi-tenant templates
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

	const baselineNames = baselineBricks.map((b) => b.name);
	p.log.success(`Baseline ready  ${baselineNames.join(" → ")}`);

	// 9. Optional: prompt for additional bricks (excluding baseline)
	let selectedExtras: string[] = [];

	if (selectedTemplate && selectedTemplate.bricks.length > 0) {
		// Template mode: show extras defined by the template
		const templateExtras = selectedTemplate.bricks.filter((b) => !baselineNames.includes(b.brick));

		if (templateExtras.length > 0 && process.stdout.isTTY) {
			const allBricks = await brickLoader.listAvailableBricks();
			const extraOptions = templateExtras.map((ref) => {
				const spec = allBricks.find((s) => s.brick.name === ref.brick);
				return {
					value: ref.brick,
					label: ref.brick,
					hint: spec?.brick.description ?? "",
				};
			});

			const selected = await p.multiselect({
				message: "Select additional bricks to install:",
				options: extraOptions,
				required: false,
			});

			if (!p.isCancel(selected) && Array.isArray(selected) && selected.length > 0) {
				selectedExtras = selected as string[];
			}
		}
	} else if (!selectedTemplate) {
		// Custom mode: show all available bricks (existing behavior)
		const availableBricks = await brickLoader.listAvailableBricks();
		const extraBricks = availableBricks.filter(
			(spec) => !baselineNames.includes(spec.brick.name) && spec.brick.type !== "extension",
		);

		if (extraBricks.length > 0) {
			if (options.bricks) {
				selectedExtras = options.bricks
					.split(",")
					.map((b) => b.trim())
					.filter((b) => !baselineNames.includes(b));
			} else if (process.stdout.isTTY) {
				const selected = await p.multiselect({
					message: "Select additional bricks to install:",
					options: extraBricks.map((spec) => ({
						value: spec.brick.name,
						label: spec.brick.name,
						hint: spec.brick.description,
					})),
					required: false,
				});

				if (!p.isCancel(selected) && Array.isArray(selected) && selected.length > 0) {
					selectedExtras = selected as string[];
				}
			}
		}
	}

	if (selectedExtras.length > 0) {
		try {
			for (const brickName of selectedExtras) {
				await installBrick(brickName, projectDir, brickLoader);
			}
			p.log.success(`Extras installed: ${selectedExtras.join(", ")}`);
		} catch (e) {
			p.log.warn(`Could not install extra bricks: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	// 10. Generate README, deploy script, API docs
	const finalState = await loadState(projectDir);
	const readmeContent = readmeTemplate(projectName, Object.keys(finalState.bricks));
	await Bun.write(join(projectDir, "README.md"), readmeContent);
	await mkdir(join(projectDir, "scripts"), { recursive: true });
	await Bun.write(join(projectDir, "scripts/deploy.sh"), deployScriptTemplate(projectName));
	p.log.success("README and deploy script generated");
	await writeApiDocs(projectDir, brickLoader);
	await updateBrickendYaml(projectDir, finalState);

	// 11. All migration files are in place — now start Supabase so it applies
	//     them in order on the first `supabase start`.
	await ensureDocker();

	p.log.step("Starting Supabase local server (this may take a moment on first run)...");
	const startExitCode = await runSupabaseLive(["start"], { cwd: projectDir });
	if (startExitCode === 0) {
		p.log.success("Supabase started");
	} else {
		p.log.warn("Could not start Supabase. Run `supabase start` manually.");
	}

	// 12. Output summary
	p.note(
		[`cd ${projectName}`, "supabase functions serve    # Start Edge Functions locally"].join("\n"),
		"Next steps",
	);

	p.outro(chalk.green("Project initialized successfully!"));
}

async function checkPrerequisites(): Promise<void> {
	const spin = startSpinner("Checking prerequisites...");

	const gitVersion = getToolVersion(["git", "--version"]);
	if (!gitVersion) {
		spin.stop("git is required but not installed", "x");
		throw new BrickendError(
			"git is required but not installed. Please install it manually.",
			"PREREQUISITE_MISSING",
			{ tool: "git" },
		);
	}

	const dockerVersion = getToolVersion(["docker", "--version"]);
	if (!dockerVersion) {
		spin.stop("docker is required but not installed", "x");
		throw new BrickendError(
			"docker is required but not installed. Please install it manually.",
			"PREREQUISITE_MISSING",
			{ tool: "docker" },
		);
	}

	let supaVersion = getSupabaseVersion();
	if (!supaVersion) {
		spin.update("Installing supabase CLI...");
		const installed = installSupabase();
		if (installed) {
			supaVersion = getSupabaseVersion() ?? "unknown";
		} else {
			spin.stop("Failed to install supabase CLI", "x");
			throw new BrickendError(
				[
					"supabase CLI is required but could not be installed automatically.",
					"",
					"Install it manually using one of these methods:",
					"  npm i supabase --save-dev     # as project dependency (use with npx)",
					"  scoop install supabase        # Windows (via Scoop)",
					"  brew install supabase/tap/supabase  # macOS",
					"",
					"More info: https://supabase.com/docs/guides/cli/getting-started",
				].join("\n"),
				"PREREQUISITE_MISSING",
				{ tool: "supabase" },
			);
		}
	}

	const gitVer = gitVersion.replace(/^git version /, "");
	const dockerVer = dockerVersion.match(/(\d+\.\d+\.\d+)/)?.[1] ?? dockerVersion;
	spin.stop(`Prerequisites ready  git ${gitVer} · docker ${dockerVer} · supabase ${supaVersion}`);
}

function isDockerRunning(): boolean {
	try {
		const result = Bun.spawnSync(["docker", "info"], { stderr: "pipe", stdout: "pipe" });
		return result.exitCode === 0;
	} catch {
		return false;
	}
}

async function startDocker(): Promise<boolean> {
	const platform = process.platform;

	let startCmd: string[];
	if (platform === "win32") {
		startCmd = ["cmd", "/c", "start", "", "Docker Desktop"];
	} else if (platform === "darwin") {
		startCmd = ["open", "-a", "Docker"];
	} else {
		startCmd = ["sudo", "systemctl", "start", "docker"];
	}

	try {
		const result = Bun.spawnSync(startCmd, { stderr: "pipe", stdout: "pipe" });
		if (result.exitCode !== 0) return false;
	} catch {
		return false;
	}

	// Wait for Docker daemon to be ready (up to 60 seconds)
	const spin = startSpinner("Waiting for Docker daemon to be ready");
	for (let i = 0; i < 30; i++) {
		if (isDockerRunning()) {
			spin.stop("Docker daemon is ready");
			return true;
		}
		spin.update(`Waiting for Docker daemon to be ready (${(i + 1) * 2}s)`);
		await new Promise((r) => setTimeout(r, 2000));
	}

	spin.stop("Docker daemon did not start in time", "x");
	return false;
}

async function ensureDocker(): Promise<void> {
	if (isDockerRunning()) {
		p.log.success("Docker is running");
		return;
	}

	p.log.warn("Docker is not running. Attempting to start...");
	const started = await startDocker();

	if (started) {
		p.log.success("Docker started");
	} else {
		throw new BrickendError(
			"Docker is required but could not be started. Please start Docker Desktop manually and try again.",
			"PREREQUISITE_MISSING",
			{ tool: "docker" },
		);
	}
}

function getToolVersion(command: string[]): string | null {
	try {
		const result = Bun.spawnSync(command, { stderr: "pipe", stdout: "pipe" });
		if (result.exitCode === 0) {
			return result.stdout.toString().trim().split("\n")[0] ?? "";
		}
		return null;
	} catch {
		return null;
	}
}
