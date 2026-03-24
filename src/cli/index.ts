#!/usr/bin/env bun
import chalk from "chalk";
import { Command } from "commander";
import { BrickendError } from "../core/errors.ts";
import { addCommand } from "./add.ts";
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
	.version("0.1.0")
	.description("Build software brick by brick");

program
	.command("init <project-name>")
	.description("Initialize a new Brickend project")
	.option("--bricks <bricks>", "Comma-separated list of bricks to install")
	.option("--template <template>", "Project template to use")
	.option("--dry-run", "Preview what would be created without writing files")
	.action(
		async (
			projectName: string,
			options: { bricks?: string; template?: string; dryRun?: boolean },
		) => {
			try {
				await initCommand(projectName, options);
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

program.parse();
