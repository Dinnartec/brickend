import * as p from "@clack/prompts";
import chalk from "chalk";
import { loadState } from "../core/state.ts";

/**
 * CLI command handler for `brickend status`.
 * Uses process.cwd() as the project directory.
 */
export async function statusCommand(): Promise<void> {
	const projectDir = process.cwd();
	const state = await loadState(projectDir);

	const multiTenant = state.settings?.multi_tenant === true;

	p.intro(chalk.bold(`Project: ${state.project}`));

	p.log.info(
		[
			`${chalk.dim("Stack:")}    ${state.stack}`,
			state.template ? `${chalk.dim("Template:")} ${state.template}` : null,
		]
			.filter(Boolean)
			.join("\n"),
	);

	const brickEntries = Object.entries(state.bricks);

	if (brickEntries.length === 0) {
		p.log.info("No bricks installed.");
	} else {
		const lines = brickEntries.map(([name, brick]) => {
			const isExtension = brick.type === "extension";
			const prefix = isExtension ? "  " : "";
			const typeLabel = isExtension ? chalk.dim(" (extension)") : "";
			const fileCount = brick.files.length;
			return `${prefix}${chalk.cyan(name)} ${chalk.dim(`v${brick.version}`)}${typeLabel}  ${chalk.dim(`${fileCount} file${fileCount !== 1 ? "s" : ""}`)}`;
		});

		p.log.step(`Bricks (${brickEntries.length}):\n${lines.join("\n")}`);
	}

	// Count migrations across all bricks
	const migrationCount = brickEntries.reduce((count, [, brick]) => {
		return count + brick.files.filter((f) => f.includes("/migrations/")).length;
	}, 0);

	const summaryParts = [
		`${state.roles.length} role${state.roles.length !== 1 ? "s" : ""}`,
		`${migrationCount} migration${migrationCount !== 1 ? "s" : ""}`,
		`Multi-tenant: ${multiTenant ? chalk.green("yes") : chalk.dim("no")}`,
	];

	p.outro(summaryParts.join(" · "));
}
