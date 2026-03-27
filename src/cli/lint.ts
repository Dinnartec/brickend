import { readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import chalk from "chalk";
import { parse as parseYaml } from "yaml";
import { BrickSpecSchema } from "../core/brick-spec.ts";
import { type LintDiagnostic, lintBrickSpec } from "../core/linter.ts";
import { createTemplateLoader } from "../core/template-loader.ts";

async function collectBrickFiles(inputPath: string): Promise<string[]> {
	let isDir: boolean;
	try {
		const s = await stat(inputPath);
		isDir = s.isDirectory();
	} catch {
		return [];
	}

	if (!isDir) {
		return [inputPath];
	}

	try {
		const all = (await readdir(inputPath, { recursive: true })) as string[];
		return all
			.filter((f) => f.endsWith(".brick.yaml"))
			.map((f) => join(inputPath, f))
			.sort();
	} catch {
		return [];
	}
}

function formatDiagnostic(diag: LintDiagnostic): string {
	const sev = diag.severity === "error" ? chalk.red("error") : chalk.yellow("warn ");
	const path = chalk.dim(diag.path.padEnd(35));
	const rule = chalk.cyan(diag.rule.padEnd(22));
	return `  ${sev}  ${path}  ${rule}  ${diag.message}`;
}

export async function lintCommand(inputPath?: string): Promise<void> {
	const targetPath = resolve(inputPath ?? "./bricks");
	const files = await collectBrickFiles(targetPath);

	if (files.length === 0) {
		console.log(chalk.yellow(`No .brick.yaml files found at: ${targetPath}`));
		return;
	}

	// Collect all known roles from templates for role existence check
	const templateLoader = createTemplateLoader();
	const templates = await templateLoader.listAvailableTemplates();
	const knownRoles = [...new Set(templates.flatMap((t) => t.roles.map((r) => r.name)))];

	let totalErrors = 0;
	let totalWarnings = 0;
	const cwd = process.cwd();

	for (const filePath of files) {
		const displayPath = relative(cwd, filePath);
		const fileDiags: LintDiagnostic[] = [];
		let parseError: string | null = null;

		// Step 1: Parse YAML
		let parsed: unknown;
		try {
			const content = await Bun.file(filePath).text();
			parsed = parseYaml(content);
		} catch (e) {
			parseError = e instanceof Error ? e.message : String(e);
		}

		if (parseError !== null) {
			console.log(`\n${chalk.underline(displayPath)}`);
			console.log(
				`  ${chalk.red("error")}  ${chalk.dim("(yaml)".padEnd(35))}  ${chalk.cyan("yaml-parse".padEnd(22))}  ${parseError}`,
			);
			totalErrors++;
			continue;
		}

		// Step 2: Zod schema validation
		const result = BrickSpecSchema.safeParse(parsed);
		if (!result.success) {
			for (const issue of result.error.issues) {
				fileDiags.push({
					path: issue.path.join(".") || "(root)",
					rule: "schema-valid",
					message: issue.message,
					severity: "error",
				});
			}
		} else {
			// Step 3: Semantic validation
			const semanticDiags = lintBrickSpec(result.data, { knownRoles });
			fileDiags.push(...semanticDiags);
		}

		if (fileDiags.length > 0) {
			console.log(`\n${chalk.underline(displayPath)}`);
			for (const diag of fileDiags) {
				console.log(formatDiagnostic(diag));
				if (diag.severity === "error") totalErrors++;
				else totalWarnings++;
			}
		}
	}

	const errPart =
		totalErrors > 0 ? chalk.red(`${totalErrors} error${totalErrors === 1 ? "" : "s"}`) : `0 errors`;
	const warnPart =
		totalWarnings > 0
			? chalk.yellow(`${totalWarnings} warning${totalWarnings === 1 ? "" : "s"}`)
			: `0 warnings`;
	console.log(
		`\n${files.length} file${files.length === 1 ? "" : "s"} checked, ${errPart}, ${warnPart}`,
	);

	if (totalErrors > 0) {
		process.exit(1);
	}
}
