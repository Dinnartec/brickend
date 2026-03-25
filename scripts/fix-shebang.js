// Verify shebang in CLI binary points to Bun (not Node).
// The code is built with `bun build --target bun` and requires the Bun runtime.
import { readFileSync } from "node:fs";

const first = readFileSync("dist/cli/index.js", "utf8").split("\n")[0];
if (!first.includes("#!/usr/bin/env bun")) {
	console.error(`WARNING: dist/cli/index.js shebang is "${first}" — expected "#!/usr/bin/env bun"`);
	process.exit(1);
}
