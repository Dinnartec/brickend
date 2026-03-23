export interface RoleConfig {
	name: string;
	description?: string;
	is_default?: boolean;
}

export interface InstalledBrickEntry {
	name: string;
	version: string;
}

export interface BricksSection {
	installed: InstalledBrickEntry[];
	extensions: InstalledBrickEntry[];
}

const DEFAULT_ROLES: RoleConfig[] = [
	{ name: "admin", description: "Full access to all resources", is_default: true },
	{ name: "member", description: "Standard user with limited access" },
	{ name: "viewer", description: "Read-only access" },
];

export interface BrickendYamlOptions {
	template?: string;
	settings?: Record<string, unknown>;
	bricks?: BricksSection;
}

export function brickendYamlTemplate(
	projectName: string,
	roles: RoleConfig[] = DEFAULT_ROLES,
	optionsOrBricks?: BrickendYamlOptions | BricksSection,
): string {
	// Support both old signature (BricksSection) and new (BrickendYamlOptions)
	let template: string | undefined;
	let settings: Record<string, unknown> | undefined;
	let bricks: BricksSection | undefined;

	if (optionsOrBricks) {
		if ("installed" in optionsOrBricks) {
			// Legacy: direct BricksSection
			bricks = optionsOrBricks;
		} else {
			template = optionsOrBricks.template;
			settings = optionsOrBricks.settings;
			bricks = optionsOrBricks.bricks;
		}
	}

	const roleLines = roles
		.map((r) => {
			let line = `  - name: ${r.name}\n    description: "${r.description}"`;
			if (r.is_default) line += "\n    is_default: true";
			return line;
		})
		.join("\n");

	let templateSection = "";
	if (template) {
		templateSection = `\ntemplate: ${template}\n`;
	}

	let settingsSection = "";
	if (settings && Object.keys(settings).length > 0) {
		const settingsLines = Object.entries(settings)
			.map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
			.join("\n");
		settingsSection = `\nsettings:\n${settingsLines}\n`;
	}

	let bricksSection = "";
	if (bricks && (bricks.installed.length > 0 || bricks.extensions.length > 0)) {
		const installedLines = bricks.installed
			.map((b) => `    - name: ${b.name}\n      version: "${b.version}"`)
			.join("\n");
		const extensionLines = bricks.extensions
			.map((b) => `    - name: ${b.name}\n      version: "${b.version}"`)
			.join("\n");

		bricksSection = "\nbricks:\n  installed:\n";
		bricksSection += installedLines.length > 0 ? `${installedLines}\n` : "";
		if (bricks.extensions.length > 0) {
			bricksSection += `  extensions:\n${extensionLines}\n`;
		}
	}

	return `# Brickend project configuration
project: ${projectName}
type: api
stack: typescript/supabase-edge-functions
${templateSection}
roles:
${roleLines}
${settingsSection}${bricksSection}`;
}
