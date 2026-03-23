import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BrickendError } from "./errors.ts";

export interface GeneratedFile {
	path: string;
	content: string;
	/** When true, the file was already written externally — skip write but still track path. */
	skipWrite?: boolean;
}

export async function writeFiles(
	projectDir: string,
	files: GeneratedFile[],
	options?: { overwrite?: boolean },
): Promise<string[]> {
	const written: string[] = [];

	for (const file of files) {
		if (file.skipWrite) {
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
