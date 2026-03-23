---
name: brickend
description: Create and manage Brickend projects — scaffold backends with composable bricks on Supabase Edge Functions. Use this skill whenever the user wants to create a new backend, API, or app project, scaffold from a template, add features/modules to an existing Brickend project, or check project status. Also use when the user mentions Brickend, bricks, Supabase Edge Functions project setup, or wants to build something incrementally with persistent state.
allowed-tools: Bash(brickend *), Bash(bun *), Bash(supabase *), Bash(npx supabase *), Read, Write, Glob, Grep
---

# Brickend Project Skill

Brickend scaffolds software projects incrementally using composable modules called **bricks**. Each brick declares a database schema, API endpoints, RBAC rules, and generates TypeScript code for Supabase Edge Functions. Projects track state in `brickend.state.json` so every session knows what was built before.

**Brickend requires Bun.** It will not work with Node.js alone.

## Discover Available Templates and Bricks

Before creating or modifying a project, discover what's available dynamically:

1. **List templates:** Call the `brickend_list_templates` MCP tool to get all available templates with their roles, settings, baseline bricks, and optional bricks.
2. **List bricks:** Call the `brickend_list_bricks` MCP tool to get all available bricks with their descriptions, dependencies, types, and endpoints.

Use this information to recommend the right template and bricks based on the user's needs. Templates with `multi_tenant: true` include workspace isolation. Bricks with `type: "extension"` are auto-installed by their parent brick.

**When to call these tools:**
- Before suggesting a template to the user
- Before recommending which bricks to add
- When the user asks what's available

## Workflow

### Creating a new project

1. **Confirm details with the user:**
   - Project name (lowercase, hyphens allowed)
   - Template choice — recommend based on use case:
     - Just getting started? → `starter`
     - Need entities + catalog? → `business`
     - Multi-tenant SaaS? → `multi-tenant`

2. **Initialize the project:**
   ```bash
   brickend init <project-name> --template <template>
   ```
   This creates the project directory, sets up git + Supabase, generates shared infrastructure (CORS, auth, RBAC, error handling), installs baseline bricks, runs migrations, and starts Supabase locally.

3. **Add optional bricks** (if the user wants more features):
   ```bash
   cd <project-name>
   brickend add entities
   brickend add catalog
   ```
   Dependencies are resolved automatically. If a brick requires another that isn't installed, Brickend prompts to install it.

4. **Verify the project:**
   ```bash
   brickend status
   ```

5. **Start the API:**
   ```bash
   supabase functions serve
   ```
   The API is available at `http://localhost:54321/functions/v1/`.

### Adding bricks to an existing project

```bash
cd <project-name>
brickend add <brick-name>
```

To see what's available interactively:
```bash
brickend add
```

### Checking project state

```bash
brickend status
```

Shows installed bricks, roles, migration count, and multi-tenant status.

## What gets generated

After `brickend init my-app --template starter && brickend add entities`:

```
my-app/
  brickend.state.json              # Project state (what's installed)
  brickend.yaml                    # Project config (roles, settings)
  supabase/
    functions/
      _shared/
        core/                      # Infrastructure: cors, auth, rbac, errors, responses
        schemas/                   # Zod schemas per brick
        services/                  # CRUD service files per brick
      auth/index.ts                # Auth endpoints
      users/index.ts               # User CRUD endpoints
      entities/index.ts            # Entity CRUD endpoints
    migrations/                    # SQL migrations (auto-generated)
  scripts/
    deploy.sh                      # Deploy to production
  openapi.yaml                     # API spec
  docs/index.html                  # Interactive API docs (Scalar)
```

## Key endpoints generated

**Auth** (no token required):
- `POST /auth/signup` — `{"email", "password", "full_name"}`
- `POST /auth/signin` — `{"email", "password"}`
- `POST /auth/signout`
- `GET /auth/me`

**Protected endpoints** (require `Authorization: Bearer <token>`):
- `GET /<brick>` — List (with pagination: `?page=1&limit=10`)
- `GET /<brick>/:id` — Get by ID
- `POST /<brick>` — Create
- `PATCH /<brick>/:id` — Update
- `DELETE /<brick>/:id` — Soft delete

## Deploy to production

```bash
cd <project-name>
supabase link --project-ref <ref>    # One-time: link to Supabase cloud project
bash scripts/deploy.sh               # Push migrations + deploy functions + set secrets
bash scripts/deploy.sh --dry-run     # Preview without executing
```

## Examples

**Basic API:**
```bash
brickend init my-api --template starter
cd my-api
brickend add entities
supabase functions serve
```

**Full business platform:**
```bash
brickend init my-platform --template business
cd my-platform
supabase functions serve
```

**Multi-tenant SaaS:**
```bash
brickend init my-saas --template multi-tenant
cd my-saas
brickend add entities
brickend add catalog
supabase functions serve
```

## Important notes

- Brickend runs on **Bun** — install with `curl -fsSL https://bun.sh/install | bash`
- Generated code runs on **Deno** (Supabase Edge Functions) — no Deno install needed
- Docker must be running for `supabase start` (local development)
- All tables include soft delete (`deleted_at` column) — DELETE endpoints set this timestamp
- RBAC is enforced via `rbac.has_permission()` in RLS policies — changing roles/permissions is instant
- The `brickend.state.json` file is the source of truth for what's installed
