// Fix shebang in built files so npm recognizes them as valid bin entries.
// Bun builds with #!/usr/bin/env bun but npm requires #!/usr/bin/env node.
// At runtime, users install with `bun install -g` so Bun resolves the binary.
import { readFileSync, writeFileSync } from "node:fs";

const files = ["dist/cli/index.js", "dist/mcp/index.js"];

for (const file of files) {
	const content = readFileSync(file, "utf8");
	writeFileSync(file, content.replace("#!/usr/bin/env bun", "#!/usr/bin/env node"));
}
