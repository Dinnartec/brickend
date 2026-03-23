import { readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { BrickendError } from "./errors.ts";
import { type TemplateSpec, TemplateSpecSchema } from "./template-spec.ts";

const PACKAGE_ROOT = resolve(import.meta.dir, "../..");
const DEFAULT_TEMPLATES_DIR = join(PACKAGE_ROOT, "bricks/templates");

async function loadTemplateSpec(templatesDir: string, name: string): Promise<TemplateSpec> {
	const yamlPath = join(templatesDir, `${name}.template.yaml`);
	const file = Bun.file(yamlPath);

	if (!(await file.exists())) {
		throw new BrickendError(`Template "${name}" not found`, "TEMPLATE_NOT_FOUND", {
			template: name,
			templatesDir,
		});
	}

	const content = await file.text();
	let parsed: unknown;
	try {
		parsed = parseYaml(content);
	} catch (e) {
		throw new BrickendError(
			`Invalid YAML in template "${name}": ${e instanceof Error ? e.message : String(e)}`,
			"TEMPLATE_INVALID",
			{ template: name, path: yamlPath },
		);
	}

	const result = TemplateSpecSchema.safeParse(parsed);
	if (!result.success) {
		throw new BrickendError(
			`Template "${name}" spec validation failed: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`,
			"TEMPLATE_INVALID",
			{ template: name, issues: result.error.issues },
		);
	}

	return result.data;
}

async function listAvailableTemplates(templatesDir: string): Promise<TemplateSpec[]> {
	let files: string[];
	try {
		files = (await readdir(templatesDir)).filter((f) => f.endsWith(".template.yaml")).sort();
	} catch {
		return [];
	}

	const specs: TemplateSpec[] = [];
	for (const file of files) {
		const name = basename(file, ".template.yaml");
		try {
			const content = await Bun.file(join(templatesDir, file)).text();
			const parsed = parseYaml(content);
			const result = TemplateSpecSchema.safeParse(parsed);
			if (result.success && result.data.template.name === name) {
				specs.push(result.data);
			}
		} catch {
			// Skip invalid templates silently
		}
	}

	return specs;
}

export function createTemplateLoader(templatesDir: string = DEFAULT_TEMPLATES_DIR) {
	return {
		loadTemplateSpec: (name: string) => loadTemplateSpec(templatesDir, name),
		listAvailableTemplates: () => listAvailableTemplates(templatesDir),
	};
}
