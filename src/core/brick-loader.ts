import { readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { BrickendError } from "./errors.ts";

export {
	type ApiSection,
	type BrickConfigField,
	type BrickSpec,
	BrickSpecSchema,
	type Endpoint,
	type FieldDef,
	FieldDefSchema,
	type SchemaSection,
} from "./brick-spec.ts";

import { BrickSpecSchema } from "./brick-spec.ts";

// Default bricks directory: <package-root>/bricks/
const PACKAGE_ROOT = resolve(import.meta.dir, "../..");
const DEFAULT_BRICKS_DIR = join(PACKAGE_ROOT, "bricks");

/**
 * Find the YAML file for a brick by name.
 * Resolution order:
 *   1. <bricksDir>/<name>/<name>.brick.yaml  (new convention)
 *   2. <bricksDir>/<name>/brick.yaml          (legacy fallback)
 *   3. Recursive scan for <name>.brick.yaml anywhere under bricksDir
 *      (supports extension bricks nested in a parent brick's folder)
 */
async function findBrickFile(bricksDir: string, name: string): Promise<string | null> {
	const newPath = join(bricksDir, name, `${name}.brick.yaml`);
	if (await Bun.file(newPath).exists()) return newPath;

	const legacyPath = join(bricksDir, name, "brick.yaml");
	if (await Bun.file(legacyPath).exists()) return legacyPath;

	// Recursive search for <name>.brick.yaml in any subdirectory
	try {
		const allFiles = (await readdir(bricksDir, { recursive: true })) as string[];
		const target = `${name}.brick.yaml`;
		const found = allFiles.find(
			(f) => f === target || f.endsWith(`/${target}`) || f.endsWith(`\\${target}`),
		);
		if (found) return join(bricksDir, found);
	} catch {
		// ignore — bricksDir may not exist
	}

	return null;
}

async function loadBrickSpec(bricksDir: string, name: string): Promise<BrickSpec> {
	const yamlPath = await findBrickFile(bricksDir, name);

	if (!yamlPath) {
		throw new BrickendError(`Brick "${name}" not found`, "BRICK_NOT_FOUND", {
			brick: name,
			bricksDir,
		});
	}

	const content = await Bun.file(yamlPath).text();
	let parsed: unknown;
	try {
		parsed = parseYaml(content);
	} catch (e) {
		throw new BrickendError(
			`Invalid YAML in brick "${name}": ${e instanceof Error ? e.message : String(e)}`,
			"BRICK_INVALID",
			{ brick: name, path: yamlPath },
		);
	}

	const result = BrickSpecSchema.safeParse(parsed);
	if (!result.success) {
		throw new BrickendError(
			`Brick "${name}" spec validation failed: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`,
			"BRICK_INVALID",
			{ brick: name, issues: result.error.issues },
		);
	}

	return result.data;
}

async function listAvailableBricks(bricksDir: string): Promise<BrickSpec[]> {
	let files: string[];
	try {
		const allFiles = (await readdir(bricksDir, { recursive: true })) as string[];
		files = allFiles.filter((f) => f.endsWith(".brick.yaml")).sort();
	} catch {
		return [];
	}

	const specs: BrickSpec[] = [];
	for (const relPath of files) {
		const fullPath = join(bricksDir, relPath);
		const brickName = basename(relPath, ".brick.yaml");
		try {
			const content = await Bun.file(fullPath).text();
			const parsed = parseYaml(content);
			const result = BrickSpecSchema.safeParse(parsed);
			if (result.success && result.data.brick.name === brickName) {
				specs.push(result.data);
			}
		} catch {
			// Skip invalid bricks silently
		}
	}

	return specs;
}

export function createBrickLoader(bricksDir: string = DEFAULT_BRICKS_DIR) {
	return {
		loadBrickSpec: (name: string) => loadBrickSpec(bricksDir, name),
		listAvailableBricks: () => listAvailableBricks(bricksDir),
		loadBrickYamlContent: async (name: string): Promise<string> => {
			const yamlPath = await findBrickFile(bricksDir, name);
			if (!yamlPath) {
				throw new BrickendError(`Brick "${name}" not found`, "BRICK_NOT_FOUND", {
					brick: name,
					bricksDir,
				});
			}
			return Bun.file(yamlPath).text();
		},
	};
}
