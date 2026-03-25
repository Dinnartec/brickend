import * as p from "@clack/prompts";
import chalk from "chalk";
import { type BrickSpec, createBrickLoader, loadManifestSpec } from "../core/brick-loader.ts";
import { BrickSpecSchema } from "../core/brick-spec.ts";
import { BrickendError } from "../core/errors.ts";
import { computeFileHashes, readFileHash, writeFiles } from "../core/file-writer.ts";
import {
	buildBrickRegistry,
	type GenerationContext,
	generateAlterMigrationFiles,
	generateAlterMigrationSql,
	generateBrickFiles,
} from "../core/generator.ts";
import { type BrickSpecDiff, diffBrickSpecs, isDiffEmpty } from "../core/spec-diff.ts";
import { loadState, saveState } from "../core/state.ts";
import { updateBrickendYaml, writeApiDocs } from "./add.ts";
import { startSpinner } from "./spinner.ts";

interface GenerateOptions {
	force?: boolean;
	dryRun?: boolean;
	migration?: boolean;
	reset?: boolean;
}

export async function generateCommand(
	brickName: string,
	options: GenerateOptions = {},
): Promise<void> {
	const projectDir = process.cwd();
	const state = await loadState(projectDir);
	const {
		force = false,
		dryRun = false,
		migration: generateMigration = true,
		reset: resetDb = true,
	} = options;

	// 1. Validate brick is installed
	const installed = state.bricks[brickName];
	if (!installed) {
		throw new BrickendError(
			`Brick "${brickName}" is not installed. Use \`brickend add ${brickName}\` first.`,
			"BRICK_NOT_INSTALLED",
			{ brick: brickName, installed: Object.keys(state.bricks) },
		);
	}

	// 2. Load NEW spec from the project manifest (user-edited)
	const newSpec = await loadManifestSpec(projectDir, brickName);

	// 3. Load OLD spec from state snapshot
	let oldSpec: BrickSpec | null = null;
	if (installed.specSnapshot) {
		const result = BrickSpecSchema.safeParse(installed.specSnapshot);
		if (result.success) {
			oldSpec = result.data;
		} else {
			p.log.warn("Could not parse stored spec snapshot — treating as full regeneration.");
		}
	}

	if (!oldSpec) {
		p.log.warn(
			"No spec snapshot found (project predates generate support). Skipping diff — will regenerate all non-modified files.",
		);
	}

	// 4. Compute diff
	const diff: BrickSpecDiff | null = oldSpec ? diffBrickSpecs(oldSpec, newSpec) : null;

	if (diff && isDiffEmpty(diff) && !force) {
		p.log.info(`No changes detected in ${brickName} manifest. Use --force to regenerate anyway.`);
		return;
	}

	// 5. Build generation context
	const brickLoader = createBrickLoader();
	const requiredBrickSpecs = await Promise.all(
		newSpec.requires.map((dep) => brickLoader.loadBrickSpec(dep.brick)),
	);

	const context: GenerationContext = {
		projectPath: projectDir,
		project: { name: state.project, type: state.type, stack: state.stack },
		brick: newSpec,
		config: installed.config,
		state,
		existingBricks: Object.keys(state.bricks),
		requiredBrickSpecs,
		dryRun,
	};

	// 6. Generate new files
	const spin = process.stdout.isTTY
		? startSpinner(dryRun ? `Simulating regeneration of ${brickName}` : `Regenerating ${brickName}`)
		: null;

	const generatedFiles = await generateBrickFiles(context);

	// 7. File safety check — compare disk hashes vs stored hashes
	const oldFiles = new Set(installed.files);
	const oldHashes = installed.fileHashes ?? {};

	const safeToWrite: typeof generatedFiles = [];
	const skippedFiles: string[] = [];
	const newFiles: typeof generatedFiles = [];

	for (const file of generatedFiles) {
		// Never overwrite existing migration files — ALTER is always a new migration
		if (file.path.startsWith("supabase/migrations/")) {
			if (file.skipWrite) {
				// Migration was already written by generateBrickFiles (via supabase CLI)
				safeToWrite.push(file);
			}
			// Skip writing CREATE TABLE migrations that already exist
			continue;
		}

		if (oldFiles.has(file.path)) {
			// Existing file — check if manually modified
			const diskHash = await readFileHash(projectDir, file.path);
			const storedHash = oldHashes[file.path];

			if (!storedHash || !diskHash) {
				// No stored hash (pre-upgrade) or file missing on disk
				if (force) {
					safeToWrite.push(file);
				} else {
					skippedFiles.push(file.path);
				}
			} else if (diskHash === storedHash || force) {
				// File untouched or force mode — safe to overwrite
				safeToWrite.push(file);
			} else {
				// File was manually modified — skip
				skippedFiles.push(file.path);
			}
		} else {
			// New file
			newFiles.push(file);
		}
	}

	// Detect removed files (in old but not in new generated set)
	const newFilePaths = new Set(generatedFiles.map((f) => f.path));
	const removedFiles = installed.files.filter(
		(f) => !newFilePaths.has(f) && !f.startsWith("supabase/migrations/"),
	);

	// 8. Write files
	if (!dryRun) {
		if (safeToWrite.length > 0) {
			await writeFiles(projectDir, safeToWrite, { overwrite: true });
		}
		if (newFiles.length > 0) {
			await writeFiles(projectDir, newFiles, { overwrite: false });
		}
	}

	// 9. Generate ALTER TABLE migration if schema changed
	const migrationFiles: typeof generatedFiles = [];
	if (diff && generateMigration && hasSchemaChanges(diff) && newSpec.schema) {
		const registry = buildBrickRegistry([newSpec, ...requiredBrickSpecs]);
		const sql = generateAlterMigrationSql(
			newSpec.schema,
			brickName,
			registry,
			diff,
			newSpec.access,
			!!state.settings?.multi_tenant,
		);
		if (sql.trim()) {
			const files = await generateAlterMigrationFiles(
				sql,
				brickName,
				dryRun ? undefined : projectDir,
				dryRun,
			);
			migrationFiles.push(...files);
		}
	} else if (diff?.accessChanged && generateMigration) {
		// Access-only changes (no schema table) still need a migration
		const registry = buildBrickRegistry([newSpec, ...requiredBrickSpecs]);
		const sql = generateAlterMigrationSql(
			newSpec.schema ?? {
				fields: [],
				indexes: [],
				constraints: { create: {}, update: {} },
				db_schema: "public",
			},
			brickName,
			registry,
			diff,
			newSpec.access,
			!!state.settings?.multi_tenant,
		);
		if (sql.trim()) {
			const files = await generateAlterMigrationFiles(
				sql,
				brickName,
				dryRun ? undefined : projectDir,
				dryRun,
			);
			migrationFiles.push(...files);
		}
	}

	// 10. Update state
	const allWritten = [
		...safeToWrite.map((f) => f.path),
		...newFiles.map((f) => f.path),
		...migrationFiles.map((f) => f.path),
	];
	// Keep skipped files and old migrations in the file list
	const preservedFiles = installed.files.filter(
		(f) => skippedFiles.includes(f) || f.startsWith("supabase/migrations/"),
	);
	const updatedFiles = [...new Set([...allWritten, ...preservedFiles])];

	const allGeneratedForHashes = [...safeToWrite, ...newFiles, ...migrationFiles];
	const newHashes = computeFileHashes(allGeneratedForHashes);
	// Preserve hashes for skipped files
	for (const skipped of skippedFiles) {
		if (oldHashes[skipped]) {
			newHashes[skipped] = oldHashes[skipped];
		}
	}
	// Preserve hashes for old migrations
	for (const file of installed.files) {
		if (file.startsWith("supabase/migrations/") && oldHashes[file]) {
			newHashes[file] = oldHashes[file];
		}
	}

	state.bricks[brickName] = {
		version: newSpec.brick.version,
		type: newSpec.brick.type ?? "brick",
		installed_at: installed.installed_at,
		config: installed.config,
		files: updatedFiles,
		fileHashes: newHashes,
		specSnapshot: JSON.parse(JSON.stringify(newSpec)) as Record<string, unknown>,
	};

	for (const file of migrationFiles) {
		if (file.path.startsWith("supabase/migrations/") && !state.schemas.includes(file.path)) {
			state.schemas.push(file.path);
		}
	}

	if (!dryRun) {
		// Update manifest with the new spec (in case user made formatting-only changes)
		const manifestPath = `${projectDir}/brickend/${brickName}/${brickName}.bricks.yaml`;
		const { stringify: stringifyYaml } = await import("yaml");
		await Bun.write(manifestPath, stringifyYaml(newSpec, { lineWidth: 120 }));

		await saveState(projectDir, state);
		await writeApiDocs(projectDir, brickLoader);
		await updateBrickendYaml(projectDir, state);
	}

	spin?.stop(
		dryRun
			? `${brickName} would regenerate ${safeToWrite.length + newFiles.length} files`
			: `${brickName} regenerated (${safeToWrite.length + newFiles.length} files)`,
	);

	// 11. Print summary
	printSummary(
		diff,
		safeToWrite.length,
		newFiles.length,
		skippedFiles,
		removedFiles,
		migrationFiles,
		dryRun,
	);

	// 12. Reset local database to apply new migrations
	if (!dryRun && migrationFiles.length > 0 && resetDb) {
		p.log.step("Resetting local database to apply new migration...");
		const { runSupabaseLive } = await import("../core/supabase.ts");
		const exitCode = await runSupabaseLive(["db", "reset"], { cwd: projectDir });
		if (exitCode === 0) {
			p.log.success("Database reset — migration applied");
		} else {
			p.log.warn("Could not reset database. Run `supabase db reset` manually.");
		}
	}
}

function hasSchemaChanges(diff: BrickSpecDiff): boolean {
	return (
		diff.fieldsAdded.length > 0 || diff.fieldsRemoved.length > 0 || diff.fieldsChanged.length > 0
	);
}

function printSummary(
	diff: BrickSpecDiff | null,
	updatedCount: number,
	newCount: number,
	skippedFiles: string[],
	removedFiles: string[],
	migrationFiles: { path: string }[],
	dryRun: boolean,
): void {
	const prefix = dryRun ? chalk.dim("[dry-run] ") : "";

	if (diff) {
		if (diff.fieldsAdded.length > 0) {
			p.log.info(`${prefix}Fields added: ${diff.fieldsAdded.map((f) => f.name).join(", ")}`);
		}
		if (diff.fieldsRemoved.length > 0) {
			p.log.info(`${prefix}Fields removed: ${diff.fieldsRemoved.map((f) => f.name).join(", ")}`);
		}
		if (diff.fieldsChanged.length > 0) {
			p.log.info(
				`${prefix}Fields changed: ${diff.fieldsChanged.map((f) => f.new.name).join(", ")}`,
			);
		}
		if (diff.endpointsAdded.length > 0) {
			p.log.info(
				`${prefix}Endpoints added: ${diff.endpointsAdded.map((e) => e.handler).join(", ")}`,
			);
		}
		if (diff.endpointsRemoved.length > 0) {
			p.log.info(
				`${prefix}Endpoints removed: ${diff.endpointsRemoved.map((e) => e.handler).join(", ")}`,
			);
		}
	}

	if (updatedCount > 0) {
		p.log.success(`${prefix}${updatedCount} file(s) updated`);
	}
	if (newCount > 0) {
		p.log.success(`${prefix}${newCount} new file(s) created`);
	}
	if (skippedFiles.length > 0) {
		p.log.warn(`${prefix}${skippedFiles.length} file(s) skipped (manually modified):`);
		for (const f of skippedFiles) {
			console.log(chalk.dim(`    ${f}`));
		}
	}
	if (removedFiles.length > 0) {
		p.log.warn(`${prefix}${removedFiles.length} file(s) no longer generated (not deleted):`);
		for (const f of removedFiles) {
			console.log(chalk.dim(`    ${f}`));
		}
	}
	if (migrationFiles.length > 0) {
		p.log.success(`${prefix}Migration created: ${migrationFiles.map((f) => f.path).join(", ")}`);
	}
}
