import { join } from "node:path";
import * as p from "@clack/prompts";
import chalk from "chalk";
import { stringify as stringifyYaml } from "yaml";
import type { BrickSpec } from "../core/brick-loader.ts";
import { createBrickLoader } from "../core/brick-loader.ts";
import { canInstall, checkDependencies, getInstallOrder } from "../core/compose.ts";
import { BrickendError } from "../core/errors.ts";
import { writeFiles } from "../core/file-writer.ts";
import { type GenerationContext, generateBrickFiles } from "../core/generator.ts";
import { buildOpenApiDoc } from "../core/openapi-generator.ts";
import { type BrickendState, loadState, saveState } from "../core/state.ts";
import { brickendYamlTemplate } from "../core/templates/brickend-yaml.ts";
import { scalarHtmlTemplate } from "../core/templates/scalar.ts";
import { startSpinner } from "./spinner.ts";

interface AddOptions {
	config?: string[];
}

/**
 * CLI command handler for `brickend add [brick]`.
 * Uses process.cwd() as the project directory.
 */
export async function addCommand(brickName?: string, options: AddOptions = {}): Promise<void> {
	const projectDir = process.cwd();
	const state = await loadState(projectDir);
	const brickLoader = createBrickLoader();

	// If no brick name, show interactive selection
	if (!brickName) {
		if (!process.stdout.isTTY) {
			throw new BrickendError(
				"No brick name provided. Usage: brickend add <brick>",
				"MISSING_ARGUMENT",
			);
		}

		const availableBricks = await brickLoader.listAvailableBricks();
		const installable = availableBricks.filter((s) => s.brick.type !== "extension");
		if (installable.length === 0) {
			throw new BrickendError("No bricks available.", "NO_BRICKS");
		}

		const selected = await p.select({
			message: "Select a brick to install:",
			options: installable.map((spec) => ({
				value: spec.brick.name,
				label: state.bricks[spec.brick.name]
					? `${chalk.dim("✓")} ${spec.brick.name} ${chalk.dim("(installed)")}`
					: spec.brick.name,
				hint: spec.brick.description,
				disabled: !!state.bricks[spec.brick.name],
			})),
		});

		if (p.isCancel(selected)) {
			p.cancel("Operation cancelled.");
			process.exit(0);
		}

		brickName = selected as string;
	}

	p.intro(chalk.bold(`brickend add ${brickName}`));

	// Handle dependencies interactively
	const check = await canInstall(brickName, state, brickLoader.loadBrickSpec);
	if (!check.ok) {
		const spec = await brickLoader.loadBrickSpec(brickName);
		const depResult = checkDependencies(spec, state.bricks);

		if (!depResult.satisfied && depResult.missing.length > 0) {
			const missingNames = depResult.missing.map((m) => m.brick);
			p.log.warn(`"${brickName}" requires: ${missingNames.join(", ")} (not installed)`);

			if (process.stdout.isTTY) {
				const shouldInstall = await p.confirm({
					message: `Install ${missingNames.join(", ")} first?`,
				});

				if (p.isCancel(shouldInstall) || !shouldInstall) {
					p.cancel("Installation cancelled.");
					process.exit(0);
				}

				const installOrder = await getInstallOrder(missingNames, brickLoader.loadBrickSpec);
				for (const dep of installOrder) {
					if (!state.bricks[dep]) {
						await installBrick(dep, projectDir, brickLoader, state);
					}
				}
			} else {
				throw new BrickendError(check.reason ?? "Unknown error", "DEPENDENCY_MISSING");
			}
		} else {
			throw new BrickendError(check.reason ?? "Unknown error", "INSTALL_FAILED");
		}
	}

	// Parse config overrides
	const configOverrides: Record<string, unknown> = {};
	if (options.config) {
		for (const pair of options.config) {
			const eqIdx = pair.indexOf("=");
			if (eqIdx > 0) {
				const key = pair.slice(0, eqIdx);
				const value = pair.slice(eqIdx + 1);
				try {
					configOverrides[key] = JSON.parse(value);
				} catch {
					if (value.includes(",")) {
						configOverrides[key] = value.split(",").map((v) => v.trim());
					} else {
						configOverrides[key] = value;
					}
				}
			}
		}
	}

	await installBrick(brickName, projectDir, brickLoader, state, configOverrides);
	const updatedState = await loadState(projectDir);
	await writeApiDocs(projectDir, brickLoader);
	await updateBrickendYaml(projectDir, updatedState);
	p.outro("Run `supabase functions serve` to start the API.");
}

/**
 * Install a single brick into a project.
 * Exported for use by `init` command and recursive dependency installation.
 * Pass `parentBrickName` when installing an extension so its manifest is written
 * inside the parent's brickend subfolder.
 */
export async function installBrick(
	brickName: string,
	projectDir: string,
	brickLoader: ReturnType<typeof createBrickLoader>,
	state?: BrickendState,
	configOverrides?: Record<string, unknown>,
	parentBrickName?: string,
): Promise<void> {
	// Load state if not provided
	if (!state) {
		state = await loadState(projectDir);
	}

	// Skip if already installed
	if (state.bricks[brickName]) {
		if (process.stdout.isTTY) p.log.info(`${brickName} already installed, skipping`);
		return;
	}

	// Load brick spec
	const spec = await brickLoader.loadBrickSpec(brickName);

	// Auto-install missing `requires` dependencies (non-interactive)
	const missingRequires = spec.requires.filter((r) => !state?.bricks[r.brick]);
	if (missingRequires.length > 0) {
		const installOrder = await getInstallOrder(
			missingRequires.map((r) => r.brick),
			brickLoader.loadBrickSpec,
		);
		for (const dep of installOrder) {
			if (!state.bricks[dep]) {
				await installBrick(dep, projectDir, brickLoader, state);
			}
		}
	}

	// Auto-install extensions with this brick as their parent
	for (const ext of spec.extensions) {
		if (!state.bricks[ext.brick]) {
			await installBrick(ext.brick, projectDir, brickLoader, state, undefined, brickName);
		}
	}

	// Merge config: defaults + overrides
	const resolvedConfig: Record<string, unknown> = {};
	for (const [key, field] of Object.entries(spec.config)) {
		resolvedConfig[key] = field.default;
	}
	if (configOverrides) {
		Object.assign(resolvedConfig, configOverrides);
	}

	// Load required brick specs for FK registry resolution
	const requiredBrickSpecs = await Promise.all(
		spec.requires.map((dep) => brickLoader.loadBrickSpec(dep.brick)),
	);

	// Build generation context
	const context: GenerationContext = {
		projectPath: projectDir,
		project: { name: state.project, type: state.type, stack: state.stack },
		brick: spec,
		config: resolvedConfig,
		state,
		existingBricks: Object.keys(state.bricks),
		requiredBrickSpecs,
	};

	// Generate and write files
	const spin = process.stdout.isTTY
		? startSpinner(`Generating ${brickName} v${spec.brick.version}`)
		: null;

	const generatedFiles = await generateBrickFiles(context);
	const writtenPaths = await writeFiles(projectDir, generatedFiles);

	// Expose non-public db_schema in config.toml [api] schemas
	const dbSchema = spec.schema?.db_schema;
	if (dbSchema && dbSchema !== "public") {
		await exposeSchemaInConfig(projectDir, dbSchema);
	}

	// Write brick manifest — extensions go inside the parent's folder
	const brickYamlContent = await brickLoader.loadBrickYamlContent(brickName);
	const manifestFolder = parentBrickName ?? brickName;
	const brickManifestPath = join(
		projectDir,
		"brickend",
		manifestFolder,
		`${brickName}.bricks.yaml`,
	);
	await Bun.write(brickManifestPath, brickYamlContent);

	spin?.stop(`${brickName} v${spec.brick.version}  (${writtenPaths.length} files)`);

	// Update state
	state.bricks[brickName] = {
		version: spec.brick.version,
		type: spec.brick.type ?? "brick",
		installed_at: new Date().toISOString(),
		config: resolvedConfig,
		files: writtenPaths,
	};

	for (const file of generatedFiles) {
		if (file.path.startsWith("supabase/migrations/") && !state.schemas.includes(file.path)) {
			state.schemas.push(file.path);
		}
	}

	await saveState(projectDir, state);
}

/**
 * Idempotently adds a schema name to the `schemas = [...]` array in the `[api]`
 * section of `supabase/config.toml`. No-ops if already present or line not found.
 */
async function exposeSchemaInConfig(projectDir: string, schema: string): Promise<void> {
	const configPath = join(projectDir, "supabase/config.toml");
	const content = await Bun.file(configPath).text();
	const match = content.match(/^(schemas\s*=\s*\[)([^\]]*)\]/m);
	if (!match) return;
	const existing = match[2] ?? "";
	if (existing.includes(`"${schema}"`)) return;
	const updated = content.replace(
		/^(schemas\s*=\s*\[)([^\]]*)\]/m,
		`$1${existing.trimEnd()}, "${schema}"]`,
	);
	await Bun.write(configPath, updated);
}

/**
 * Regenerate brickend.yaml with an up-to-date bricks section.
 * Splits installed bricks into main bricks and extensions.
 * Exported for use by the init command.
 */
export async function updateBrickendYaml(projectDir: string, state: BrickendState): Promise<void> {
	const installed = Object.entries(state.bricks)
		.filter(([, b]) => b.type !== "extension")
		.map(([name, b]) => ({ name, version: b.version }));
	const extensions = Object.entries(state.bricks)
		.filter(([, b]) => b.type === "extension")
		.map(([name, b]) => ({ name, version: b.version }));

	const content = brickendYamlTemplate(state.project, state.roles, {
		template: state.template,
		settings: state.settings,
		bricks: { installed, extensions },
	});
	await Bun.write(join(projectDir, "brickend.yaml"), content);
}

/**
 * Regenerate openapi.yaml and docs/index.html from all currently installed bricks.
 * Exported for use by the init command.
 */
export async function writeApiDocs(
	projectDir: string,
	brickLoader: ReturnType<typeof createBrickLoader>,
): Promise<void> {
	const state = await loadState(projectDir);
	const installedNames = Object.keys(state.bricks);
	const specs: BrickSpec[] = await Promise.all(
		installedNames.map((name) => brickLoader.loadBrickSpec(name)),
	);
	const doc = buildOpenApiDoc(specs);
	await Bun.write(join(projectDir, "openapi.yaml"), stringifyYaml(doc, { lineWidth: 120 }));
	await Bun.write(join(projectDir, "docs", "index.html"), scalarHtmlTemplate(JSON.stringify(doc)));
}
