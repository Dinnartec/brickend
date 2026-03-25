export function agentsTemplate(
	projectName: string,
	installedBricks: string[],
	multiTenant: boolean,
): string {
	const brickList = installedBricks.length > 0 ? installedBricks.join(", ") : "none";
	const multiTenantLabel = multiTenant ? "yes (workspace isolation enabled)" : "no";

	return `# AGENTS.md — AI Agent Instructions for ${projectName}

This project is managed with **[Brickend](https://github.com/Dinnartec/brickend)** — a CLI that scaffolds production-ready Supabase Edge Function backends using composable modules called **bricks**. Each brick owns a database schema, REST API endpoints, and RBAC rules.

## Project architecture

- **Stack:** TypeScript + Supabase Edge Functions (Deno runtime)
- **Installed bricks:** ${brickList}
- **Multi-tenant:** ${multiTenantLabel}
- **State file:** \`brickend.state.json\` — source of truth for installed bricks, files, and versions

## Key directories

\`\`\`
supabase/functions/
  _shared/
    core/          # Infrastructure: cors, auth, rbac, errors, responses  ← managed by Brickend
    schemas/       # Zod schemas per brick                                ← managed by Brickend
    services/      # CRUD service files per brick                         ← managed by Brickend
  <brick>/index.ts # API entrypoint per brick                             ← managed by Brickend
  migrations/      # SQL migrations (auto-generated, never edit manually)
brickend/<brick>/  # Installed brick manifests (edit to trigger generate)
\`\`\`

## How to make changes

### Add a new feature module
\`\`\`bash
brickend add <brick-name>
brickend list --json    # See all available bricks
\`\`\`

### Modify an installed brick (add/remove fields, endpoints, access rules)
\`\`\`bash
# 1. Edit the manifest
#    brickend/<brick-name>/<brick-name>.bricks.yaml
# 2. Regenerate code + migration
brickend generate <brick-name>
# Options: --dry-run, --force, --no-migration, --no-reset
\`\`\`

### Check project status
\`\`\`bash
brickend status
\`\`\`

### Deploy to production
\`\`\`bash
supabase link --project-ref <ref>   # One-time setup
bash scripts/deploy.sh              # Pushes migrations + deploys functions + secrets
\`\`\`

## For AI agents

When the user asks for backend changes in this project, **always use the \`brickend\` skill** for architectural decisions:

- Adding new endpoints or resources → \`brickend add\`
- Adding/removing fields or endpoints on existing bricks → edit manifest + \`brickend generate\`
- Changing RBAC access rules → edit \`access:\` in the manifest + \`brickend generate\`
- Understanding what's installed → \`brickend status\` or read \`brickend.state.json\`

The Brickend skill knows the project conventions and ensures generated code stays consistent (schemas, services, entrypoints, migrations, RBAC policies) without breaking the shared infrastructure.

**Only edit files manually** when the user needs custom business logic beyond what Brickend generates — for example, adding complex calculations inside a service function. Never overwrite files in \`supabase/functions/_shared/core/\` or \`supabase/migrations/\` manually.
`;
}
