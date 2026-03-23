import semver from "semver";
import type { BrickSpec } from "./brick-loader.ts";
import { BrickendError } from "./errors.ts";
import type { BrickendState, InstalledBrick } from "./state.ts";

export interface DependencyResult {
	satisfied: boolean;
	missing: Array<{ brick: string; version: string }>;
}

export interface InstallCheck {
	ok: boolean;
	reason?: string;
}

export function checkDependencies(
	brickSpec: BrickSpec,
	installedBricks: Record<string, InstalledBrick>,
): DependencyResult {
	const missing: Array<{ brick: string; version: string }> = [];

	const allDeps = [...brickSpec.requires, ...(brickSpec.extensions ?? [])];
	for (const req of allDeps) {
		const installed = installedBricks[req.brick];
		if (!installed) {
			missing.push(req);
		} else if (!semver.satisfies(installed.version, req.version)) {
			missing.push(req);
		}
	}

	return { satisfied: missing.length === 0, missing };
}

export async function getInstallOrder(
	brickNames: string[],
	loadSpec: (name: string) => Promise<BrickSpec>,
): Promise<string[]> {
	// Build dependency graph
	const graph = new Map<string, string[]>(); // brick -> dependencies
	const allBricks = new Set<string>(brickNames);

	// Recursively discover all required bricks
	const queue = [...brickNames];
	while (queue.length > 0) {
		const name = queue.pop() as string;
		if (graph.has(name)) continue;

		const spec = await loadSpec(name);
		// Both requires and extensions are treated as dependencies (extensions install first)
		const deps = [
			...spec.requires.map((r) => r.brick),
			...(spec.extensions ?? []).map((r) => r.brick),
		];
		graph.set(name, deps);

		for (const dep of deps) {
			allBricks.add(dep);
			if (!graph.has(dep)) {
				queue.push(dep);
			}
		}
	}

	// Kahn's algorithm — build reverse adjacency: if A requires B, edge B→A (B before A)
	const reverseInDegree = new Map<string, number>();
	const reverseAdj = new Map<string, string[]>();
	for (const brick of allBricks) {
		reverseInDegree.set(brick, 0);
		reverseAdj.set(brick, []);
	}

	for (const [brick, deps] of graph) {
		// brick depends on deps -> deps must come before brick
		// Reverse edge: dep -> brick
		reverseInDegree.set(brick, (reverseInDegree.get(brick) ?? 0) + deps.length);
		for (const dep of deps) {
			reverseAdj.get(dep)?.push(brick);
		}
	}

	const sorted: string[] = [];
	const ready: string[] = [];

	for (const [brick, degree] of reverseInDegree) {
		if (degree === 0) ready.push(brick);
	}
	ready.sort(); // deterministic order

	while (ready.length > 0) {
		const brick = ready.shift() as string;
		sorted.push(brick);

		for (const dependent of reverseAdj.get(brick) ?? []) {
			const newDegree = (reverseInDegree.get(dependent) ?? 1) - 1;
			reverseInDegree.set(dependent, newDegree);
			if (newDegree === 0) {
				ready.push(dependent);
				ready.sort();
			}
		}
	}

	if (sorted.length !== allBricks.size) {
		const remaining = [...allBricks].filter((b) => !sorted.includes(b));
		throw new BrickendError(
			`Circular dependency detected among: ${remaining.join(", ")}`,
			"CIRCULAR_DEPENDENCY",
			{ bricks: remaining },
		);
	}

	return sorted;
}

export async function canInstall(
	brickName: string,
	state: BrickendState,
	loadSpec: (name: string) => Promise<BrickSpec>,
): Promise<InstallCheck> {
	if (state.bricks[brickName]) {
		return { ok: false, reason: `Brick "${brickName}" is already installed.` };
	}

	let spec: BrickSpec;
	try {
		spec = await loadSpec(brickName);
	} catch (e) {
		if (e instanceof BrickendError && e.code === "BRICK_NOT_FOUND") {
			return { ok: false, reason: `Brick "${brickName}" not found.` };
		}
		throw e;
	}

	const depResult = checkDependencies(spec, state.bricks);
	if (!depResult.satisfied) {
		const missingList = depResult.missing.map((m) => `${m.brick} ${m.version}`).join(", ");
		return {
			ok: false,
			reason: `Missing dependencies: ${missingList}`,
		};
	}

	return { ok: true };
}
