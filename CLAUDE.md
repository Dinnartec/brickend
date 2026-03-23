# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Brickend

A CLI tool and MCP server that scaffolds software projects incrementally using composable, production-ready modules called **bricks**. The first supported stack is TypeScript + Supabase Edge Functions. The CLI runs on **Bun**; the generated code runs on **Deno** (Supabase Edge Functions).

## Commands

```bash
# Development
bun run dev          # Run CLI with file watching
bun run build        # Compile to dist/cli/ and dist/mcp/

# Testing
bun test                                          # Run all tests
bun test tests/core/generator.test.ts             # Run a single test file
bun test --watch                                  # Watch mode

# Linting
bunx biome check .          # Lint + format check
bunx biome check --fix .    # Auto-fix
```

## Architecture

```
src/
  cli/
    index.ts         # Commander.js entry — registers init, add, status, lint commands
    init.ts          # brickend init: creates project dir, scaffolds _shared/, selects bricks
    add.ts           # brickend add: resolves deps, generates files, updates state
    status.ts        # brickend status: shows installed bricks and project info
    lint.ts          # brickend lint: validates brick YAML files
    spinner.ts       # @clack/prompts spinner wrapper
  core/
    brick-loader.ts  # Scans bricks/**/*.brick.yaml, validates with Zod schema
    brick-spec.ts    # Zod schemas for brick YAML (BrickSpecSchema, FieldDef, etc.)
    compose.ts       # Dependency resolution (Kahn's topological sort) + install-order
    generator.ts     # Core code generation: dispatches from schema + api sections
    linter.ts        # Validates brick specs (name/filename match, references, etc.)
    state.ts         # brickend.state.json read/write (Zod-validated)
    file-writer.ts   # Writes generated files to disk
    supabase.ts      # Spawns supabase CLI commands
    errors.ts        # BrickendError class with typed error codes
    openapi-generator.ts  # Generates OpenAPI/Swagger specs from brick definitions
    template-loader.ts    # Scans bricks/templates/*.template.yaml
    template-spec.ts      # Zod schemas for template YAML
    templates/
      index.ts             # Barrel export for all template modules
      auth-core.ts         # Auth infrastructure templates (JWT, session handling)
      brickend-yaml.ts     # brickend.yaml project config template
      cors.ts              # CORS headers template
      deploy.ts            # Deployment script template
      env-example.ts       # .env.example template
      errors.ts            # Error handling infrastructure template
      gitignore.ts         # .gitignore template
      rbac.ts              # RBAC (role-based access control) infrastructure template
      readme.ts            # Project README template
      responses.ts         # HTTP response helpers template
      scalar.ts            # Scalar API docs page template
      supabase-client.ts   # Supabase client init template
  mcp/
    index.ts         # MCP server entry point
    tools.ts         # MCP tool definitions

scripts/
  smoke-test.sh      # End-to-end smoke test script

bricks/
  auth/auth.brick.yaml                           # Auth brick
  users/users.brick.yaml                         # Users brick
  entities/entities.brick.yaml                   # Entities brick
  identification_types/identification_types.brick.yaml  # Lookup table + seed migration
  catalog/catalog.brick.yaml                     # Catalog brick (declares extensions)
  catalog/catalog-item-types.brick.yaml          # Extension brick (type: extension)
  catalog/catalog-categories.brick.yaml          # Extension brick (type: extension)
  workspaces/workspaces.brick.yaml               # Workspaces brick (multi-tenant)
  templates/                                     # Project templates
    starter.template.yaml
    business.template.yaml
    multi-tenant.template.yaml

demos/supabase/          # Reference implementation — source of truth for generator output
  functions/_shared/     # What generated _shared/ code should look like

tests/
  core/                  # Unit tests for core engine modules
  fixtures/bricks/       # Test brick fixtures (test-brick, dep-brick)
```

## Key Design Decisions

**Runtime split:** Brickend CLI uses Node/Bun APIs (`Bun.file`, `Bun.spawnSync`, `node:fs`). Generated Deno code uses `npm:` specifiers (e.g. `npm:zod`, `npm:@supabase/supabase-js@2`) and `jsr:` for edge runtime types.

**brick.yaml is the spec:** Each brick is a YAML file declaring `requires`, `config`, `schema`, `api`, and `access` sections. The generator dispatches from `schema` + `api` to produce code (there is no `files[]` array). Config values are injected via `$config.<key>` references in specs.

**Code generation is string-based:** `generator.ts` builds TypeScript/SQL as string arrays joined with `\n`. No AST, no templates engine — direct string concatenation.

**State file is the source of truth at runtime:** `brickend.state.json` in the generated project tracks which bricks are installed, their versions, configs, and generated file paths. It is Zod-validated on every load.

## TypeScript Path Aliases

```
@core/* -> ./src/core/*
@cli/*  -> ./src/cli/*
@mcp/*  -> ./src/mcp/*
```

## Code Style

- Formatter: Biome — tabs, line width 100, double quotes
- Strict TypeScript: `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `noImplicitOverride`
- All imports use `.ts` extensions (Bun bundler resolves them)

## Brick Definition Schema

```yaml
brick:
  name: <string>
  version: "<semver>"
  description: "<string>"
  type: brick | extension    # optional, default "brick"

requires:
  - brick: <name>
    version: "<semver range>"

extensions:                  # sub-bricks auto-installed before this brick
  - brick: <name>
    version: "<semver range>"

config:
  <key>:
    description: "<string>"
    type: "string"
    default: <value>

schema:
  db_schema: public          # optional, default "public"
  table: <string>
  primary_key: <string>
  workspace_scoped: false    # optional, explicit opt-out for multi-tenant
  fields:
    - name: <string>
      type: string | text | email | uuid | boolean | numeric | url
      required: <bool>
      nullable: <bool>
      references: auth | <brick-name>
      default: "<sql expr>"
  indexes: [...]
  constraints: { create: {...}, update: {...} }

access:                        # RBAC access rules (replaces old rls: section)
  - role: <string>             # role name (must match a role in brickend.yaml)
    actions: [<handler>...]    # list of endpoint handlers this role can access
    own_only: <bool>           # optional, default false — restrict to own records

api:
  type: rest | auth          # default "rest"
  auth_required: <bool>
  search_field: <string>
  endpoints:
    - method: GET | POST | PATCH | DELETE
      path: <string>
      handler: <camelCase>
      status: <number>
      has_pagination: <bool>
      body: [FieldDef...]    # auth endpoints only
```

Bricks with `type: extension` are auto-installed by their parent (via `extensions:`) and are hidden from the interactive `brickend add` selector. The generator dispatches from `schema` + `api` + `access` sections — there is no `files[]` array.

**RBAC:** Role-based access control is core infrastructure generated during `brickend init`. The `access:` section in brick YAMLs defines which roles can perform which actions. RLS policies on all tables delegate to a centralized `rbac.has_permission()` function — changing permissions in the RBAC tables takes effect instantly without modifying any policies. The auth entrypoint assigns the default role (marked `is_default: true` in `brickend.yaml`) on signup.

**Multi-Tenant Workspaces:** When `settings.multi_tenant: true` is set (via template or `brickend.yaml`), the system scopes all applicable tables with a `workspace_id` column. Tables with `with-owner` or `standard` create mode get workspace-scoped automatically; `with-id` tables (e.g. `user_profiles`), auth bricks, and tables with `workspace_scoped: false` are excluded. The `workspaces` brick is auto-installed in the baseline. Entrypoints read an `X-Workspace-Id` header for workspace context. Auth signup in multi-tenant mode creates a default workspace + `workspace_users` entry (instead of `user_roles`). The RBAC `has_permission()` function gains a `p_workspace_id` parameter to check workspace-level permissions.

**Templates:** Project templates (`bricks/templates/*.template.yaml`) define roles, settings (e.g. `multi_tenant`), baseline bricks, and optional bricks. Use `brickend init <name> --template <template-name>` to select a template. Available: `starter`, `business`, `multi-tenant`. Templates are loaded by `createTemplateLoader()` from `template-loader.ts`.

**`_shared/` structure in generated projects:**
```
supabase/functions/_shared/
  core/       cors.ts, errors.ts, supabase.ts, responses.ts, auth.ts, rbac.ts
  schemas/    <entity>.ts  (Zod schemas + TypeScript types)
  services/   <name>/index.ts + create/get/list/update/delete + const-<name>.ts
```

**Manifest location:** Brick specs live in the repo at `bricks/<name>/<name>.brick.yaml` (singular `.brick.yaml`). In a generated project, the installed-brick manifest is at `brickend/<name>/<name>.bricks.yaml` (plural `.bricks.yaml`, one subfolder per brick).

## demos/ Reference

`demos/supabase/` is a fully-working Supabase project that represents what Brickend generates. When updating generator templates, verify output matches the demo. The demo is also used for live testing with `supabase start` + `supabase functions serve`.
