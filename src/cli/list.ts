import { createBrickLoader } from "@core/brick-loader.ts";
import { createTemplateLoader } from "@core/template-loader.ts";
import chalk from "chalk";

export async function listCommand(options: {
	json?: boolean;
	templates?: boolean;
	bricks?: boolean;
}): Promise<void> {
	const showTemplates = !options.bricks || options.templates;
	const showBricks = !options.templates || options.bricks;
	const [bricks, templates] = await Promise.all([
		showBricks ? createBrickLoader().listAvailableBricks() : Promise.resolve([]),
		showTemplates ? createTemplateLoader().listAvailableTemplates() : Promise.resolve([]),
	]);

	const brickDtos = bricks.map((b) => ({
		name: b.brick.name,
		version: b.brick.version,
		description: b.brick.description,
		type: b.brick.type ?? "brick",
		requires: b.requires?.map((r) => r.brick) ?? [],
		endpoints: b.api?.endpoints?.map((e) => `${e.method} ${e.path}`) ?? [],
	}));

	const templateDtos = templates.map((t) => ({
		name: t.template.name,
		description: t.template.description,
		multi_tenant: t.settings?.multi_tenant === true,
		roles: t.roles.map((r) => ({ name: r.name, is_default: r.is_default ?? false })),
		baseline: t.baseline.map((b) => b.brick),
		optional: t.bricks?.map((b) => b.brick) ?? [],
	}));

	if (options.json) {
		const output: Record<string, unknown> = {};
		if (showTemplates) output.templates = templateDtos;
		if (showBricks) output.bricks = brickDtos;
		console.log(JSON.stringify(output, null, 2));
		return;
	}

	// Human-readable output
	if (showTemplates) console.log(chalk.bold("\nTemplates\n"));
	for (const t of templateDtos) {
		const tenantTag = t.multi_tenant ? chalk.cyan(" [multi-tenant]") : "";
		console.log(`  ${chalk.green(t.name)}${tenantTag}`);
		console.log(`  ${chalk.dim(t.description)}`);
		const roleNames = t.roles.map((r) => (r.is_default ? chalk.yellow(`${r.name}*`) : r.name));
		console.log(`  ${chalk.dim("roles:")} ${roleNames.join(", ")}  ${chalk.dim("(* = default)")}`);
		console.log(`  ${chalk.dim("baseline:")} ${t.baseline.join(", ")}`);
		if (t.optional.length > 0) console.log(`  ${chalk.dim("optional:")} ${t.optional.join(", ")}`);
		console.log();
	}

	if (showBricks) console.log(chalk.bold("Bricks\n"));
	const mainBricks = brickDtos.filter((b) => b.type !== "extension");
	const extensions = brickDtos.filter((b) => b.type === "extension");

	for (const b of mainBricks) {
		console.log(`  ${chalk.green(b.name)} ${chalk.dim(`v${b.version}`)}`);
		console.log(`  ${chalk.dim(b.description)}`);
		if (b.requires.length > 0) console.log(`  ${chalk.dim("requires:")} ${b.requires.join(", ")}`);
		if (b.endpoints.length > 0)
			console.log(`  ${chalk.dim("endpoints:")} ${b.endpoints.join("  ")}`);
		console.log();
	}

	if (extensions.length > 0) {
		console.log(chalk.bold("Extensions (auto-installed by parent)\n"));
		for (const b of extensions) {
			console.log(`  ${chalk.dim(`${b.name} v${b.version}`)}  ${chalk.dim(b.description)}`);
		}
		console.log();
	}

	const s = (n: number, word: string) => `${n} ${word}${n !== 1 ? "s" : ""}`;
	const summary = [
		showTemplates && s(templateDtos.length, "template"),
		showBricks && s(mainBricks.length, "brick"),
		showBricks && s(extensions.length, "extension"),
	]
		.filter(Boolean)
		.join("  ·  ");
	console.log(chalk.dim(summary));
}
