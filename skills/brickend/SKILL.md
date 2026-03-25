---
name: brickend
description: Create and manage Brickend projects — scaffold production-ready backends with composable bricks on Supabase Edge Functions. Use this skill whenever the user wants to create a new backend, REST API, or app project, add CRUD endpoints, define database schemas, set up authentication, configure RBAC roles, manage multi-tenant workspaces, modify installed bricks (add/remove fields, endpoints), regenerate code, or check project status. Also trigger when the user mentions Brickend, bricks, Supabase Edge Functions, TypeScript API scaffolding, or wants to build a backend incrementally. Even if they just say "create an API" or "I need a backend" — this skill applies.
allowed-tools: Bash(brickend *), Bash(bun *), Bash(supabase *), Bash(npx supabase *), Read, Write, Glob, Grep
---

# Brickend Project Skill

Brickend scaffolds backend projects incrementally using composable modules called **bricks**. Each brick declares a database schema, REST API endpoints, and RBAC rules, then generates TypeScript code for Supabase Edge Functions. Projects track state in `brickend.state.json` so every session knows what was built before.

**Brickend requires Bun.** It will not work with Node.js alone.

## Always Discover First

Before recommending templates or bricks, discover what's available. The catalog changes — never hardcode or guess.

**Primary (CLI):**
```bash
brickend list --json
```
Returns `{ templates: [...], bricks: [...] }` with names, descriptions, dependencies, and settings. Use `--templates` or `--bricks` to filter.

**Fallback (MCP):** If the Brickend MCP server is configured, use `brickend_list_templates` and `brickend_list_bricks` tools.

**Rules:**
- Templates with `multi_tenant: true` include workspace isolation
- Bricks with `type: "extension"` are auto-installed by their parent — never suggest them directly
- Always match the template to the user's domain (CRM, marketplace, SaaS, etc.) before defaulting to `starter`

## CLI Commands Reference

| Command | Purpose |
|---------|---------|
| `brickend init <name>` | Create a new project (git, Supabase, baseline bricks, migrations) |
| `brickend add [bricks...]` | Add bricks to an existing project (resolves dependencies) |
| `brickend generate <brick>` | Regenerate code after editing a brick's manifest |
| `brickend status` | Show installed bricks, roles, settings |
| `brickend list` | List available templates and bricks |
| `brickend lint [path]` | Validate brick YAML files |
| `brickend install-skill` | Install Brickend skill into Claude Code (~/.claude/skills/) |

All commands support `--dry-run` to preview without writing. Run `brickend <command> --help` for full options.

## Workflow: New Project

1. **Discover** available templates and bricks
2. **Confirm** with the user: project name (lowercase, hyphens OK) and template choice
3. **Initialize:**
   ```bash
   brickend init <project-name> --template <template>
   ```
   This creates the directory, sets up git + Supabase, generates shared infrastructure (CORS, auth, RBAC, errors), installs baseline bricks, runs migrations, and starts Supabase locally.

4. **Add optional bricks:**
   ```bash
   cd <project-name>
   brickend add <brick-name>
   ```
   Dependencies resolve automatically. Run `brickend add` with no args for interactive selection.

5. **Verify and start:**
   ```bash
   brickend status
   supabase functions serve
   ```
   API available at `http://localhost:54321/functions/v1/`.

## Workflow: Existing Project

When working inside a project that already exists:

1. **Understand what's installed:**
   ```bash
   brickend status
   ```
   Shows installed bricks with versions, roles, migration count, multi-tenant flag.

2. **Decide the action:**
   - Need a new feature? → `brickend add <brick>`
   - Need to modify an installed brick? → Edit manifest + `brickend generate <brick>`
   - Need to validate YAML? → `brickend lint`

## Workflow: Modify an Installed Brick

When a user wants to add/remove fields, change endpoints, or update access rules on an already-installed brick:

1. **Edit the manifest:**
   ```
   brickend/<brick-name>/<brick-name>.bricks.yaml
   ```

2. **Regenerate:**
   ```bash
   brickend generate <brick-name>
   ```

3. **Options:**
   - `--dry-run` — preview without writing
   - `--force` — overwrite even manually modified files
   - `--no-migration` — skip ALTER TABLE generation
   - `--no-reset` — skip local database reset after migration

**What CAN be changed:**
- Add/remove fields in `schema.fields` — generates ALTER TABLE migration
- Add/remove endpoints in `api.endpoints` — regenerates entrypoint + services
- Change access rules in `access` — regenerates RBAC permission seeds
- Change config values

**What CANNOT be changed via generate:**
- `brick.name`, `schema.table`, `schema.primary_key` — require manual migration
- `requires` — use `brickend add` for new dependencies
- `api.type` (rest ↔ auth) — fundamentally different code paths

**File safety:** Files manually edited by the user are detected via content hashes and skipped with a warning. Use `--force` to overwrite.

**Migrations:** Field additions generate `ALTER TABLE ADD COLUMN`. Removals generate `DROP COLUMN IF EXISTS`. Type changes emit `-- TODO` comments for manual review. After creating a migration, the local database is automatically reset (`supabase db reset`) to apply it. Use `--no-reset` to skip.

### Example: Adding a field

Original manifest has:
```yaml
schema:
  table: user_profiles
  primary_key: user_id
  fields:
    - name: user_id
      type: uuid
      references: auth
    - name: full_name
      type: string
      required: true
```

Add a `phone` field:
```yaml
  fields:
    - name: user_id
      type: uuid
      references: auth
    - name: full_name
      type: string
      required: true
    - name: phone        # <-- new field
      type: string
```

Then run `brickend generate users` — regenerates the Zod schema, service files, and creates an ALTER TABLE migration.

## Brick Manifest YAML Reference

This is the structure of `.bricks.yaml` files. Claude needs this to help users edit manifests for `brickend generate`.

```yaml
brick:
  name: <string>            # Must match filename
  version: "<semver>"
  description: "<string>"

requires:                    # Dependencies (auto-installed)
  - brick: <name>
    version: "<semver>"

schema:
  db_schema: public          # Postgres schema (default: public)
  table: <string>
  primary_key: <string>
  workspace_scoped: false    # Opt-out of multi-tenant scoping
  fields:
    - name: <string>
      type: <field-type>     # See below
      required: <bool>
      nullable: <bool>
      references: auth | <brick-name>
      default: "<sql expr>"
  indexes:
    - name: <string>
      columns: [<string>...]
      type: gin | unique | btree
  constraints:
    create: { <name>: { type: "<ErrorType>", message: "<msg>" } }
    update: { <name>: { type: "<ErrorType>", message: "<msg>" } }

api:
  type: rest | auth          # rest = CRUD, auth = signup/signin
  auth_required: <bool>
  search_field: <string>     # Field for ?q= search (needs GIN index)
  endpoints:
    - method: GET | POST | PATCH | DELETE
      path: <string>
      handler: <camelCase>
      status: <number>
      has_pagination: <bool>

access:                      # RBAC rules
  - role: <string>
    actions: [<handler>...]
    own_only: <bool>
```

**Supported field types:** `string`, `text`, `email`, `uuid`, `boolean`, `numeric`, `url`

**Create mode** (inferred from fields):
- PK with `references: auth` → **with-id** (e.g., user_profiles)
- Non-PK with `references: auth` → **with-owner** (e.g., entities)
- Neither → **standard**

## What Gets Generated

```
<project>/
  brickend.state.json         # Source of truth for installed state
  brickend.yaml               # Project config (roles, settings)
  brickend/<brick>/           # Installed brick manifests
  supabase/
    functions/
      _shared/
        core/                 # Infrastructure: cors, auth, rbac, errors, responses
        schemas/              # Zod schemas per brick
        services/             # CRUD service files per brick (7 files each)
      <brick>/index.ts        # API entrypoints per brick
    migrations/               # SQL migrations (auto-generated)
  openapi.yaml                # API spec (auto-generated)
  docs/index.html             # Interactive API docs (Scalar)
  scripts/deploy.sh           # Deploy to production
```

## Key Endpoints

**Auth** (no token required):
- `POST /auth/signup` — `{"email", "password", "full_name"}`
- `POST /auth/signin` — `{"email", "password"}`
- `POST /auth/signout`
- `GET /auth/me`

**REST bricks** (require `Authorization: Bearer <token>`):
- `GET /<brick>` — List (pagination: `?page=1&limit=10`, search: `?q=term`)
- `GET /<brick>/:id` — Get by ID
- `POST /<brick>` — Create
- `PATCH /<brick>/:id` — Update
- `DELETE /<brick>/:id` — Soft delete

## Database & Deploy

**Local development:**
- `supabase db reset` — drops and recreates DB, reapplies all migrations (auto after `brickend generate`)
- `supabase migration up` — applies only pending migrations (non-destructive)

**Production deployment:**
```bash
supabase link --project-ref <ref>    # One-time: link to cloud project
bash scripts/deploy.sh               # Push migrations + deploy functions + secrets
bash scripts/deploy.sh --dry-run     # Preview without executing
```

The deploy script runs `supabase db push` (applies pending migrations to remote), deploys all Edge Functions, and sets secrets from `.env`.

## Examples

```bash
# Basic API
brickend init my-api --template starter
cd my-api && brickend add entities && supabase functions serve

# Multi-tenant SaaS
brickend init my-saas --template multi-tenant
cd my-saas && brickend add entities && supabase functions serve

# Modify an installed brick
cd my-api
# Edit brickend/users/users.bricks.yaml to add a field
brickend generate users
```

## Important Notes

- Brickend runs on **Bun** — install: `curl -fsSL https://bun.sh/install | bash`
- Generated code runs on **Deno** (Supabase Edge Functions) — no install needed
- Docker must be running for `supabase start`
- All tables have soft delete (`deleted_at`) — DELETE sets a timestamp
- RBAC via `rbac.has_permission()` in RLS — permission changes are instant
- `brickend.state.json` is the single source of truth for what's installed
- Multi-tenant mode adds `workspace_id` to applicable tables + `X-Workspace-Id` header
