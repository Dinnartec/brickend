import { cpSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const claudeDir = join(homedir(), ".claude");

if (!existsSync(claudeDir)) process.exit(0); // No Claude Code → skip silently

const skillsDir = join(__dirname, "../skills");
const dest = join(claudeDir, "skills");
mkdirSync(dest, { recursive: true });
cpSync(skillsDir, dest, { recursive: true });
console.log("✓ Brickend skills installed in Claude Code (~/.claude/skills/)");
