/**
 * Resolves the correct command to run the Supabase CLI.
 *
 * Supabase CLI can be available as:
 * 1. `supabase` — global install via scoop, brew, or npm -g
 * 2. `npx supabase` — local project dependency (npm i supabase --save-dev)
 *
 * This module detects which is available and provides a consistent interface.
 */

let resolvedCommand: string[] | null = null;

function tryCommand(command: string[]): boolean {
	try {
		const result = Bun.spawnSync([...command, "--version"], {
			stderr: "pipe",
			stdout: "pipe",
		});
		return result.exitCode === 0;
	} catch {
		return false;
	}
}

/**
 * Resolves the supabase CLI command. Tries `supabase` first, then `npx supabase`.
 * Caches the result for the process lifetime.
 */
export function getSupabaseCommand(): string[] | null {
	if (resolvedCommand !== null) return resolvedCommand;

	// Try direct `supabase` command (global install)
	if (tryCommand(["supabase"])) {
		resolvedCommand = ["supabase"];
		return resolvedCommand;
	}

	// Try `npx supabase` (local project dependency or npx cache)
	if (tryCommand(["npx", "supabase"])) {
		resolvedCommand = ["npx", "supabase"];
		return resolvedCommand;
	}

	return null;
}

/**
 * Gets the supabase version string.
 */
export function getSupabaseVersion(): string | null {
	const cmd = getSupabaseCommand();
	if (!cmd) return null;

	try {
		const result = Bun.spawnSync([...cmd, "--version"], {
			stderr: "pipe",
			stdout: "pipe",
		});
		if (result.exitCode === 0) {
			return result.stdout.toString().trim().split("\n")[0] ?? null;
		}
	} catch {
		// ignore
	}
	return null;
}

/**
 * Attempts to install the Supabase CLI as a local dependency.
 * Returns true if installation succeeds.
 */
export function installSupabase(): boolean {
	// Try npm first (most common)
	const strategies = [
		["npm", "i", "supabase", "--save-dev"],
		["bun", "add", "-d", "supabase"],
	];

	for (const cmd of strategies) {
		try {
			const result = Bun.spawnSync(cmd, { stderr: "pipe", stdout: "pipe" });
			if (result.exitCode === 0) {
				// Reset cache so getSupabaseCommand re-detects
				resolvedCommand = null;
				return getSupabaseCommand() !== null;
			}
		} catch {}
	}

	return false;
}

/**
 * Runs a supabase CLI command with the resolved command prefix (sync, captures output).
 * Example: runSupabase(["init"], { cwd: "/path" })
 * Executes: supabase init  OR  npx supabase init
 */
export function runSupabase(
	args: string[],
	options?: { cwd?: string },
): { exitCode: number; stdout: string; stderr: string } {
	const cmd = getSupabaseCommand();
	if (!cmd) {
		return { exitCode: 1, stdout: "", stderr: "Supabase CLI not found" };
	}

	try {
		const result = Bun.spawnSync([...cmd, ...args], {
			cwd: options?.cwd,
			stderr: "pipe",
			stdout: "pipe",
		});
		return {
			exitCode: result.exitCode,
			stdout: result.stdout.toString(),
			stderr: result.stderr.toString(),
		};
	} catch (e) {
		return {
			exitCode: 1,
			stdout: "",
			stderr: e instanceof Error ? e.message : String(e),
		};
	}
}

/**
 * Runs a supabase CLI command asynchronously, inheriting stdio so the user sees output.
 * Used for long-running commands like `supabase start`.
 */
export async function runSupabaseLive(args: string[], options?: { cwd?: string }): Promise<number> {
	const cmd = getSupabaseCommand();
	if (!cmd) {
		console.error("Supabase CLI not found");
		return 1;
	}

	try {
		const proc = Bun.spawn([...cmd, ...args], {
			cwd: options?.cwd,
			stderr: "inherit",
			stdout: "inherit",
			stdin: "inherit",
		});
		const exitCode = await proc.exited;
		return exitCode;
	} catch (e) {
		console.error(e instanceof Error ? e.message : String(e));
		return 1;
	}
}
