#!/usr/bin/env bun
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import chalk from "chalk";
import { Command } from "commander";
import packageJson from "../../package.json";
import { BrickendError } from "../core/errors.ts";
import { addCommand } from "./add.ts";
import { createBrickCommand } from "./create-brick.ts";
import { generateCommand } from "./generate.ts";
import { initCommand } from "./init.ts";
import { lintCommand } from "./lint.ts";
import { listCommand } from "./list.ts";
import { statusCommand } from "./status.ts";

function handleError(error: unknown): void {
	if (error instanceof BrickendError) {
		console.error(chalk.red(`Error [${error.code}]: ${error.message}`));
		if (error.details && process.env.DEBUG) {
			console.error(chalk.dim(JSON.stringify(error.details, null, 2)));
		}
	} else if (error instanceof Error) {
		console.error(chalk.red(`Error: ${error.message}`));
		if (process.env.DEBUG) {
			console.error(chalk.dim(error.stack));
		}
	} else {
		console.error(chalk.red(`Unknown error: ${String(error)}`));
	}
}

const program = new Command()
	.name("brickend")
	.version(packageJson.version)
	.description("Build software brick by brick");

program
	.command("init [project-name]")
	.description("Initialize a new Brickend project (use '.' or omit for current directory)")
	.option("--bricks <bricks>", "Comma-separated list of bricks to install")
	.option("--template <template>", "Project template to use")
	.option("--dry-run", "Preview what would be created without writing files")
	.action(
		async (
			projectName: string | undefined,
			options: { bricks?: string; template?: string; dryRun?: boolean },
		) => {
			try {
				await initCommand(projectName ?? ".", options);
			} catch (error) {
				handleError(error);
				process.exit(1);
			}
		},
	);

program
	.command("add [bricks...]")
	.description("Add one or more bricks to the project")
	.option("--config <config...>", "Brick configuration as key=value pairs")
	.option("--dry-run", "Preview what would be generated without writing files")
	.action(async (bricks: string[], options?: { config?: string[]; dryRun?: boolean }) => {
		try {
			await addCommand(bricks, options);
		} catch (error) {
			handleError(error);
			process.exit(1);
		}
	});

program
	.command("generate <brick-name>")
	.description("Regenerate code for a modified brick")
	.option("--force", "Overwrite files even if manually modified")
	.option("--dry-run", "Preview changes without writing files")
	.option("--no-migration", "Skip migration generation")
	.option("--no-reset", "Skip local database reset after migration")
	.action(
		async (
			brickName: string,
			options: { force?: boolean; dryRun?: boolean; migration?: boolean; reset?: boolean },
		) => {
			try {
				await generateCommand(brickName, options);
			} catch (error) {
				handleError(error);
				process.exit(1);
			}
		},
	);

program
	.command("create-brick <name>")
	.description("Create a new custom brick definition in the project")
	.option("--table <table>", "Database table name (default: brick name)")
	.option("--primary-key <pk>", "Primary key column name (default: singularized table + _id)")
	.option("--fields <fields>", "Field definitions: name:type[:required][:nullable][:ref=brick]")
	.option("--owner", "Add owner_id field referencing auth")
	.option("--endpoints <handlers>", "Comma-separated: list,get,create,update,softDelete")
	.option("--auth-required", "Require authentication (default: true)")
	.option("--no-auth-required", "Do not require authentication")
	.option("--search-field <field>", "Field for ?q= search")
	.option("--requires <bricks>", "Comma-separated brick dependencies")
	.option("--description <desc>", "Brick description")
	.option("--version <ver>", "Brick version (default: 1.0.0)")
	.option("--dry-run", "Preview YAML without writing")
	.option("--no-generate", "Create manifest only, skip code generation")
	.option("--no-workspace", "Opt out of workspace scoping in multi-tenant projects")
	.action(
		async (
			name: string,
			options: {
				table?: string;
				primaryKey?: string;
				fields?: string;
				owner?: boolean;
				endpoints?: string;
				authRequired?: boolean;
				searchField?: string;
				requires?: string;
				description?: string;
				version?: string;
				dryRun?: boolean;
				noGenerate?: boolean;
				noWorkspace?: boolean;
			},
		) => {
			try {
				await createBrickCommand(name, options);
			} catch (error) {
				handleError(error);
				process.exit(1);
			}
		},
	);

program
	.command("status")
	.description("Show project status")
	.action(async () => {
		try {
			await statusCommand();
		} catch (error) {
			handleError(error);
			process.exit(1);
		}
	});

program
	.command("lint [path]")
	.description("Validate brick.yaml file(s)")
	.action(async (path?: string) => {
		try {
			await lintCommand(path);
		} catch (error) {
			handleError(error);
			process.exit(1);
		}
	});

program
	.command("list")
	.description("List available templates and bricks")
	.option("--templates", "Show only templates")
	.option("--bricks", "Show only bricks")
	.option("--json", "Output as JSON")
	.action(async (options: { json?: boolean; templates?: boolean; bricks?: boolean }) => {
		try {
			await listCommand(options);
		} catch (error) {
			handleError(error);
			process.exit(1);
		}
	});

program
	.command("install-skill")
	.description("Install Brickend skill into Claude Code (~/.claude/skills/)")
	.action(() => {
		try {
			const claudeDir = join(homedir(), ".claude");
			if (!existsSync(claudeDir)) {
				console.error(
					chalk.red(
						"Claude Code not detected (~/.claude/ does not exist). Install Claude Code first.",
					),
				);
				process.exit(1);
			}

			const packageRoot = resolve(import.meta.dir, "../..");
			const skillsSource = join(packageRoot, "skills");
			if (!existsSync(skillsSource)) {
				console.error(chalk.red("Skills directory not found in package."));
				process.exit(1);
			}

			const dest = join(claudeDir, "skills");
			mkdirSync(dest, { recursive: true });
			cpSync(skillsSource, dest, { recursive: true });
			console.log(chalk.green("Brickend skill installed in Claude Code (~/.claude/skills/)"));
		} catch (error) {
			handleError(error);
			process.exit(1);
		}
	});

program.parse();
