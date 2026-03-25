import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BrickendError } from "./errors.ts";

export function computeFileHash(content: string): string {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(content);
	return hasher.digest("hex") as string;
}

export function computeFileHashes(files: GeneratedFile[]): Record<string, string> {
	const hashes: Record<string, string> = {};
	for (const file of files) {
		hashes[file.path] = computeFileHash(file.content);
	}
	return hashes;
}

export async function readFileHash(projectDir: string, filePath: string): Promise<string | null> {
	const fullPath = join(projectDir, filePath);
	const file = Bun.file(fullPath);
	if (!(await file.exists())) return null;
	const content = await file.text();
	return computeFileHash(content);
}

export interface GeneratedFile {
	path: string;
	content: string;
	/** When true, the file was already written externally — skip write but still track path. */
	skipWrite?: boolean;
}

export async function writeFiles(
	projectDir: string,
	files: GeneratedFile[],
	options?: { overwrite?: boolean; dryRun?: boolean },
): Promise<string[]> {
	const written: string[] = [];

	for (const file of files) {
		if (file.skipWrite || options?.dryRun) {
			written.push(file.path);
			continue;
		}

		const fullPath = join(projectDir, file.path);
		await mkdir(dirname(fullPath), { recursive: true });

		if (!options?.overwrite) {
			const exists = await Bun.file(fullPath).exists();
			if (exists) {
				throw new BrickendError(`File already exists: ${file.path}`, "FILE_CONFLICT", {
					path: file.path,
				});
			}
		}

		await Bun.write(fullPath, file.content);
		written.push(file.path);
	}

	return written;
}
