import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import packageJson from "../../package.json";
import {
	AddInputSchema,
	handleAdd,
	handleInit,
	handleListBricks,
	handleListTemplates,
	handleStatus,
	InitInputSchema,
	StatusInputSchema,
} from "./tools.ts";

const server = new McpServer({
	name: "brickend",
	version: packageJson.version,
});

server.tool(
	"brickend_init",
	"Initialize a new Brickend project with Supabase Edge Functions, RBAC, and composable bricks. Creates project directory, sets up git + supabase, generates shared infrastructure, and installs baseline bricks.",
	InitInputSchema.shape,
	async (input) => {
		try {
			const result = await handleInit(InitInputSchema.parse(input));
			return {
				content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
			};
		} catch (e) {
			return {
				isError: true,
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({
							error: e instanceof Error ? e.message : String(e),
							code: (e as { code?: string }).code ?? "UNKNOWN",
						}),
					},
				],
			};
		}
	},
);

server.tool(
	"brickend_add",
	"Add a brick to an existing Brickend project. Resolves dependencies, generates code (schema, API, services), and updates project state.",
	AddInputSchema.shape,
	async (input) => {
		try {
			const result = await handleAdd(AddInputSchema.parse(input));
			return {
				content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
			};
		} catch (e) {
			return {
				isError: true,
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({
							error: e instanceof Error ? e.message : String(e),
							code: (e as { code?: string }).code ?? "UNKNOWN",
						}),
					},
				],
			};
		}
	},
);

server.tool(
	"brickend_status",
	"Get the current status of a Brickend project: installed bricks, versions, configs, roles, and settings.",
	StatusInputSchema.shape,
	async (input) => {
		try {
			const result = await handleStatus(StatusInputSchema.parse(input));
			return {
				content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
			};
		} catch (e) {
			return {
				isError: true,
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({
							error: e instanceof Error ? e.message : String(e),
							code: (e as { code?: string }).code ?? "UNKNOWN",
						}),
					},
				],
			};
		}
	},
);

server.tool(
	"brickend_list_templates",
	"List all available project templates with their roles, settings, and baseline bricks.",
	{},
	async () => {
		try {
			const result = await handleListTemplates();
			return {
				content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
			};
		} catch (e) {
			return {
				isError: true,
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({
							error: e instanceof Error ? e.message : String(e),
							code: (e as { code?: string }).code ?? "UNKNOWN",
						}),
					},
				],
			};
		}
	},
);

server.tool(
	"brickend_list_bricks",
	"List all available bricks with their descriptions, dependencies, and endpoints.",
	{},
	async () => {
		try {
			const result = await handleListBricks();
			return {
				content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
			};
		} catch (e) {
			return {
				isError: true,
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({
							error: e instanceof Error ? e.message : String(e),
							code: (e as { code?: string }).code ?? "UNKNOWN",
						}),
					},
				],
			};
		}
	},
);

async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch((e) => {
	process.stderr.write(`Brickend MCP server error: ${e}\n`);
	process.exit(1);
});
