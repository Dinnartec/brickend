import { join } from "node:path";
import { z } from "zod";
import { BrickendError } from "./errors.ts";

const InstalledBrickSchema = z.object({
	version: z.string(),
	type: z.string().optional(),
	installed_at: z.string().datetime(),
	config: z.record(z.unknown()),
	files: z.array(z.string()),
	fileHashes: z.record(z.string()).optional().default({}),
	specSnapshot: z.record(z.unknown()).optional(),
});

const RoleSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	is_default: z.boolean().optional(),
});

const BrickendStateSchema = z.object({
	project: z.string(),
	type: z.literal("api"),
	stack: z.string(),
	bricks: z.record(InstalledBrickSchema),
	schemas: z.array(z.string()),
	roles: z.array(RoleSchema).optional().default([]),
	template: z.string().optional(),
	settings: z.record(z.unknown()).optional().default({}),
	created_at: z.string().datetime(),
	updated_at: z.string().datetime(),
});

export type BrickendState = z.infer<typeof BrickendStateSchema>;
export type InstalledBrick = z.infer<typeof InstalledBrickSchema>;
export { BrickendStateSchema, InstalledBrickSchema };

const STATE_FILE = "brickend.state.json";

export function initState(
	projectName: string,
	roles: Array<{ name: string; description?: string; is_default?: boolean }> = [],
	options?: { template?: string; settings?: Record<string, unknown> },
): BrickendState {
	const now = new Date().toISOString();
	return {
		project: projectName,
		type: "api",
		stack: "typescript/supabase-edge-functions",
		bricks: {},
		schemas: [],
		roles,
		template: options?.template,
		settings: options?.settings ?? {},
		created_at: now,
		updated_at: now,
	};
}

export async function loadState(projectPath: string): Promise<BrickendState> {
	const filePath = join(projectPath, STATE_FILE);
	const file = Bun.file(filePath);

	if (!(await file.exists())) {
		throw new BrickendError(
			`State file not found: ${filePath}. Is this a Brickend project? Run \`brickend init\` first.`,
			"STATE_NOT_FOUND",
			{ path: filePath },
		);
	}

	let raw: unknown;
	try {
		raw = await file.json();
	} catch {
		throw new BrickendError(`State file is not valid JSON: ${filePath}`, "STATE_INVALID", {
			path: filePath,
		});
	}

	const result = BrickendStateSchema.safeParse(raw);
	if (!result.success) {
		throw new BrickendError(
			`State file validation failed: ${result.error.issues.map((i) => i.message).join(", ")}`,
			"STATE_INVALID",
			{ path: filePath, issues: result.error.issues },
		);
	}

	return result.data;
}

export async function saveState(projectPath: string, state: BrickendState): Promise<void> {
	const filePath = join(projectPath, STATE_FILE);
	state.updated_at = new Date().toISOString();
	await Bun.write(filePath, JSON.stringify(state, null, 2));
}
