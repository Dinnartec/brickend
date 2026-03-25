# Brickend

Build software brick by brick.

Brickend is infrastructure that AI agents and humans use to build software incrementally using composable, production-ready modules called **bricks**. It provides persistent project state, structured operations, and a spec-driven code generation engine. The first supported stack is **TypeScript + Supabase Edge Functions**.

```
Without Brickend:  AI agent → generates code from scratch → inconsistent, stateless
With Brickend:     AI agent → operates on Brickend → consistent, incremental, tracked
```

---

## Table of Contents

- [Quick Start](#quick-start)
- [Installation](#installation)
- [Prerequisites](#prerequisites)
- [Commands](#commands)
  - [brickend init](#brickend-init)
  - [brickend add](#brickend-add)
  - [brickend create-brick](#brickend-create-brick)
  - [brickend status](#brickend-status)
- [Available Bricks](#available-bricks)
  - [identification_types](#identification_types)
  - [auth](#auth)
  - [users](#users)
  - [entities](#entities)
  - [catalog](#catalog)
  - [workspaces](#workspaces)
- [Project Structure](#project-structure)
- [Brick Configuration](#brick-configuration)
- [State Management](#state-management)
- [Development Workflow](#development-workflow)
- [Creating Custom Bricks](#creating-custom-bricks)
- [Multi-Tenant Workspaces](#multi-tenant-workspaces)
- [Templates](#templates)
- [MCP Server (AI Agent Integration)](#mcp-server-ai-agent-integration)
- [Architecture](#architecture)

---

## Quick Start

```bash
# 1. Initialize a new API project
brickend init my-api

# 2. Move into the project
cd my-api

# 3. Start local Supabase (DB, Auth, Storage)
supabase start

# 4. Add bricks
brickend add entities

# 5. Start the API
supabase functions serve

# 6. Test it
curl -X POST http://localhost:54321/functions/v1/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "password123", "full_name": "John Doe"}'

curl http://localhost:54321/functions/v1/entities \
  -H "Authorization: Bearer <token>"
```

---

## Installation

### 1. Install Bun (required)

Brickend runs on [Bun](https://bun.sh) — it uses Bun APIs internally and cannot run on Node.js alone.

```bash
curl -fsSL https://bun.sh/install | bash
```

> **Windows:** Use [WSL](https://learn.microsoft.com/en-us/windows/wsl/install) or install Bun via `powershell -c "irm bun.sh/install.ps1 | iex"`

### 2. Install Brickend

```bash
bun install -g brickend
```

### 3. Verify

```bash
brickend --version
```

### From source (for contributors)

```bash
git clone https://github.com/dinnartec/brickend.git
cd brickend
bun install
bun run build
bun run src/cli/index.ts --help
```

---

## Prerequisites

Brickend checks for these tools during `brickend init` and will attempt to install `supabase` automatically if missing:

| Tool | Required | Install |
|------|----------|---------|
| [Bun](https://bun.sh) | Yes — runs the CLI | `curl -fsSL https://bun.sh/install \| bash` |
| [Git](https://git-scm.com/) | Yes — version control | `brew install git` / `apt install git` |
| [Docker Desktop](https://www.docker.com/) | Yes — local Supabase | [Download](https://www.docker.com/products/docker-desktop/) |
| [Supabase CLI](https://supabase.com/docs/guides/cli) | Auto-installed | Brickend installs it if missing, or `npm install -g supabase` |

---

## Commands

### `brickend init`

Initialize a new Brickend API project.

```bash
brickend init [project-name] [options]
```

**Arguments:**
- `[project-name]` — Name for the project (lowercase alphanumeric + hyphens). Use `.` or omit to initialize in the current directory (derives name from folder).

**Options:**
- `--bricks <bricks>` — Comma-separated list of bricks to install
- `--template <name>` — Use a project template (`starter`, `business`, `multi-tenant`)

**What it does:**

1. Validates the project name
2. Checks prerequisites (git, docker, supabase CLI)
3. Creates the project directory
4. Runs `git init` and `supabase init`
5. Prompts for template selection (or uses `--template` flag)
6. Creates the shared code infrastructure (`_shared/core/` files)
7. Generates RBAC infrastructure (roles, permissions, RLS functions)
8. Creates `brickend.yaml` and `brickend.state.json`
9. Auto-installs baseline bricks (`identification_types` → `auth` → `users`)
10. Prompts for optional extra bricks from the template
11. Generates API docs (`openapi.yaml` + `docs/index.html`)
12. Shows next steps

**Examples:**

```bash
# Interactive mode — prompts for template and brick selection
brickend init my-api

# Use a specific template
brickend init my-api --template starter

# Initialize in current directory (derives name from folder)
mkdir my-api && cd my-api
brickend init .

# Omit name entirely — same as init .
brickend init --template starter

# Multi-tenant project with workspaces
brickend init my-api --template multi-tenant
```

**Output:**

```
 brickend init my-api

  Checking prerequisites...
    ✓ git found (git version 2.43.0)
    ✓ docker found (Docker version 24.0.7)
    ✓ supabase CLI found (1.187.0)

  ✓ Project directory created
  ✓ git initialized
  ✓ Supabase initialized
  ✓ Project files generated

  Generated files:
    supabase/functions/_shared/core/cors.ts
    supabase/functions/_shared/core/responses.ts
    supabase/functions/_shared/core/errors.ts
    supabase/functions/_shared/core/supabase.ts
    supabase/functions/_shared/core/auth.ts
    supabase/functions/_shared/core/rbac.ts
    brickend.yaml
    .env.example
    .gitignore
    brickend.state.json

  Installing baseline: identification_types → auth → users
    ✓ identification_types v1.0.0 installed
    ✓ auth v1.0.0 installed
    ✓ users v1.0.0 installed

  ┌ Next steps
  │ cd my-api
  │ supabase start              # Start local Supabase
  │ supabase functions serve    # Start Edge Functions locally
  └

  Project initialized successfully!
```

---

### `brickend add`

Add a brick to an existing project. Run this from inside a Brickend project directory.

```bash
brickend add [brick] [options]
```

**Arguments:**
- `[brick]` — Name of the brick to install (optional — shows interactive selection if omitted)

**Options:**
- `--config <key=value...>` — Override brick configuration values

**What it does:**

1. Loads the current project state from `brickend.state.json`
2. If no brick name given, shows an interactive selection menu
3. Checks if the brick is already installed
4. Validates dependencies — offers to install missing ones automatically
5. Resolves configuration (defaults + overrides)
6. Generates all brick files (schemas, services, migration, endpoints)
7. Creates migration via `supabase migration new`
8. Updates project state
9. Regenerates API docs
10. Shows generated files and next steps

**Examples:**

```bash
# Add a specific brick
brickend add entities

# Interactive selection
brickend add

# Add with custom configuration
brickend add entities --config identification_types=NIT,CC,RUT

# Add a brick that has dependencies (auto-installs missing deps first)
brickend add users
```

**Output:**

```
 brickend add entities

  Adding brick: entities (v1.0.0)
  Checking dependencies... ✓ auth (installed)

  ✓ Generated files

  Generated:
    supabase/functions/_shared/schemas/entity.ts
    supabase/functions/_shared/services/entities/index.ts
    supabase/functions/_shared/services/entities/const-entities.ts
    supabase/functions/_shared/services/entities/create-entity.ts
    supabase/functions/_shared/services/entities/get-entity.ts
    supabase/functions/_shared/services/entities/list-entities.ts
    supabase/functions/_shared/services/entities/update-entity.ts
    supabase/functions/_shared/services/entities/delete-entity.ts
    supabase/functions/entities/index.ts
    supabase/functions/entities/deno.json
    supabase/migrations/<timestamp>_add_entities.sql

  ✓ entities v1.0.0 installed

  Run `supabase functions serve` to start the API.
```

**Dependency auto-resolution:**

```
 brickend add users

  "users" requires: auth (not installed)
  ? Install auth first? Yes

  brickend add auth
  ✓ auth v1.0.0 installed

  ✓ users v1.0.0 installed
```

---

### `brickend create-brick`

Create a custom brick definition in the project. Generates a `.bricks.yaml` manifest and registers it in project state, ready for `brickend generate`.

```bash
brickend create-brick <name> [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--table <name>` | Table name (default: brick name) |
| `--primary-key <name>` | PK column name (default: singularized table + `_id`) |
| `--fields <defs>` | Field definitions: `name:type[:required][:nullable][:ref=brick]` |
| `--owner` | Add `owner_id` referencing auth (with-owner create mode) |
| `--endpoints <list>` | Handlers: `list,get,create,update,softDelete` (default: all) |
| `--auth-required` / `--no-auth-required` | Require authentication (default: true) |
| `--search-field <field>` | Field for `?q=` search |
| `--requires <bricks>` | Comma-separated brick dependencies |
| `--description <desc>` | Brick description |
| `--version <ver>` | Version (default: 1.0.0) |
| `--dry-run` | Preview YAML without writing |
| `--no-generate` | Create manifest only, skip code generation |
| `--no-workspace` | Opt out of workspace scoping in multi-tenant projects |

**Field definition format:** `name:type[:required][:nullable][:ref=brick]`

Supported types: `string`, `text`, `email`, `uuid`, `boolean`, `numeric`, `url`

**Examples:**

```bash
# Full specification (AI-friendly one-liner)
brickend create-brick invoices \
  --fields "title:string:required,amount:numeric:required,status:string:required" \
  --owner --search-field title --description "Invoice management"

# Scaffold mode — generates minimal YAML for manual editing
brickend create-brick invoices

# Preview without writing
brickend create-brick invoices --fields "title:string:required" --dry-run
```

By default, code is generated automatically (schema, services, entrypoint, migration). Use `--no-generate` to create the manifest only. Custom bricks can reference other custom bricks via `ref=<name>` in field definitions. In multi-tenant projects, bricks are automatically workspace-scoped (opt out with `--no-workspace`). OpenAPI docs are updated automatically.

---

### `brickend status`

Show current project status.

```bash
brickend status
```

**Output:**

```
 Project: my-api

  Stack:    typescript/supabase-edge-functions
  Template: starter

  Bricks (3):
  identification_types v1.0.0  2 files
  auth v1.0.0  4 files
  users v1.0.0  11 files

  3 roles · 3 migrations · Multi-tenant: no
```

---

## Available Bricks

### identification_types

Lookup table for identification document types (NIT, CC, CE, PASSPORT, etc.). Seed migration populates default values.

**Dependencies:** None
**Configuration:** None

**Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/identification_types` | List identification types |
| GET | `/identification_types/:id` | Get identification type by slug |
| POST | `/identification_types` | Create identification type |
| PATCH | `/identification_types/:id` | Update identification type |
| DELETE | `/identification_types/:id` | Soft-delete identification type |

**Generated files:**

```
supabase/functions/_shared/schemas/identification_type.ts                              # Zod schema
supabase/functions/_shared/services/identification_types/index.ts                      # Service barrel export
supabase/functions/_shared/services/identification_types/const-identification_types.ts  # Table/column constants
supabase/functions/_shared/services/identification_types/create-identification_type.ts  # Create
supabase/functions/_shared/services/identification_types/get-identification_type.ts     # Get by slug
supabase/functions/_shared/services/identification_types/list-identification_types.ts   # List
supabase/functions/_shared/services/identification_types/update-identification_type.ts  # Update
supabase/functions/_shared/services/identification_types/delete-identification_type.ts  # Soft delete
supabase/functions/identification_types/index.ts                                        # Edge Function entry point
supabase/functions/identification_types/deno.json                                       # Deno configuration
supabase/migrations/<timestamp>_add_identification_types.sql                            # Table + seed data + update_updated_at trigger
```

---

### auth

Authentication brick using Supabase Auth built-in. Generates signup, signin, signout, and me endpoints. On signup, assigns the default RBAC role.

**Dependencies:** None
**Configuration:** None

**Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/signup` | Register new user |
| POST | `/auth/signin` | Login with email/password |
| POST | `/auth/signout` | Logout (invalidate session) |
| GET | `/auth/me` | Get current authenticated user |

**Generated files:**

```
supabase/functions/_shared/core/auth.ts         # verifyAuth() — JWT verification
supabase/functions/_shared/schemas/auth.ts       # signinSchema, signupSchema (Zod)
supabase/functions/auth/index.ts                 # Edge Function entry point
supabase/functions/auth/deno.json                # Deno configuration
```

**Usage example:**

```bash
# Register
curl -X POST http://localhost:54321/functions/v1/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email": "user@test.com", "password": "mypassword", "full_name": "Jane Doe"}'

# Login
curl -X POST http://localhost:54321/functions/v1/auth/signin \
  -H "Content-Type: application/json" \
  -d '{"email": "user@test.com", "password": "mypassword"}'

# Get current user (requires token from login response)
curl http://localhost:54321/functions/v1/auth/me \
  -H "Authorization: Bearer <access_token>"
```

---

### users

User profile management with Supabase Auth integration.

**Dependencies:** `identification_types >= 1.0.0`, `auth >= 1.0.0`
**Configuration:** None

**Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/users` | List users (paginated) |
| GET | `/users/:id` | Get user profile |
| POST | `/users` | Create user profile |
| PATCH | `/users/:id` | Update user profile |
| DELETE | `/users/:id` | Soft-delete user |

**Generated files:**

```
supabase/functions/_shared/schemas/user.ts                  # User, CreateUser, UpdateUser (Zod)
supabase/functions/_shared/services/users/index.ts          # Service barrel export
supabase/functions/_shared/services/users/const-users.ts    # Table/column constants
supabase/functions/_shared/services/users/create-user.ts    # Create with auth ID
supabase/functions/_shared/services/users/get-user.ts       # Get by ID
supabase/functions/_shared/services/users/list-users.ts     # List with pagination/search
supabase/functions/_shared/services/users/update-user.ts    # Update by ID
supabase/functions/_shared/services/users/delete-user.ts    # Soft delete
supabase/functions/users/index.ts                           # Edge Function entry point
supabase/functions/users/deno.json                          # Deno configuration
supabase/migrations/<timestamp>_add_users.sql               # user_profiles table (FK to auth.users)
```

**Database schema:**
- `user_profiles` table with FK to `auth.users(id)` (cascade delete)
- PK: `user_id` (references `auth.users(id)`)
- Columns: `user_id`, `full_name`, `email`, `identification_type`, `identification_number`, `created_at`, `updated_at`, `deleted_at`
- RLS via `rbac.has_permission()` delegation

---

### entities

Business entity management (companies, people, organizations).

**Dependencies:** `identification_types >= 1.0.0`, `auth >= 1.0.0`

**Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/entities` | List entities (paginated, searchable) |
| GET | `/entities/:id` | Get entity by ID |
| POST | `/entities` | Create entity |
| PATCH | `/entities/:id` | Update entity |
| DELETE | `/entities/:id` | Soft-delete entity |

**Generated files:**

```
supabase/functions/_shared/schemas/entity.ts                    # Entity Zod schemas
supabase/functions/_shared/services/entities/index.ts           # Service barrel export
supabase/functions/_shared/services/entities/const-entities.ts  # Table/column constants
supabase/functions/_shared/services/entities/create-entity.ts   # Create with owner
supabase/functions/_shared/services/entities/get-entity.ts      # Get by ID
supabase/functions/_shared/services/entities/list-entities.ts   # List with pagination/search
supabase/functions/_shared/services/entities/update-entity.ts   # Update by ID
supabase/functions/_shared/services/entities/delete-entity.ts   # Soft delete
supabase/functions/entities/index.ts                            # Edge Function entry point
supabase/functions/entities/deno.json                           # Deno configuration
supabase/migrations/<timestamp>_add_entities.sql                # entities table
```

**Database schema:**
- `entities` table with `owner_id` FK to `auth.users(id)`
- PK: `entity_id` (auto-generated UUID)
- Columns: `entity_id`, `owner_id`, `name`, `identification_type`, `identification_number`, `created_at`, `updated_at`, `deleted_at`
- Unique constraint on `(owner_id, identification_type, identification_number)`
- GIN index on `name` for full-text search
- RLS via `rbac.has_permission()` delegation

---

### catalog

Product/service catalog with extensible item types and categories. Declares extensions (`catalog-item-types`, `catalog-categories`) that are auto-installed before the main brick.

**Dependencies:** `entities >= 1.0.0`, `auth >= 1.0.0`
**Extensions:** `catalog-item-types`, `catalog-categories`

Uses non-public Postgres schema: `db_schema: catalog`.

---

### workspaces

Workspace management for multi-tenant projects. Auto-installed when using the `multi-tenant` template or when `settings.multi_tenant: true`.

**Dependencies:** `auth >= 1.0.0`, `users >= 1.0.0`

**Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/workspaces` | List workspaces (paginated) |
| GET | `/workspaces/:id` | Get workspace |
| POST | `/workspaces` | Create workspace |
| PATCH | `/workspaces/:id` | Update workspace |
| DELETE | `/workspaces/:id` | Soft-delete workspace |

Uses `db_schema: rbac` and `workspace_scoped: false` (the workspaces table manages workspaces, it's not scoped by them). Migration also creates the `rbac.workspace_users` table and a workspace-aware `has_permission()` function.

### contacts

Contact management for CRM — people linked to business entities.

**Dependencies:** `auth >= 1.0.0`, `entities >= 1.0.0`

**Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/contacts` | List contacts (paginated, searchable) |
| GET | `/contacts/:id` | Get contact |
| POST | `/contacts` | Create contact |
| PATCH | `/contacts/:id` | Update contact |
| DELETE | `/contacts/:id` | Soft-delete contact |

**Fields:** full_name, email, phone, position, notes, entity_id (optional link to business entity)

### deals

Deal pipeline management for CRM.

**Dependencies:** `auth >= 1.0.0`, `contacts >= 1.0.0`

**Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/deals` | List deals (paginated, searchable) |
| GET | `/deals/:id` | Get deal |
| POST | `/deals` | Create deal |
| PATCH | `/deals/:id` | Update deal |
| DELETE | `/deals/:id` | Soft-delete deal |

**Fields:** title, value (numeric), stage, description, contact_id (optional link to contact)

### products

Product listings for marketplace.

**Dependencies:** `auth >= 1.0.0`

**Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/products` | List products (paginated, searchable) |
| GET | `/products/:id` | Get product |
| POST | `/products` | Create product |
| PATCH | `/products/:id` | Update product |
| DELETE | `/products/:id` | Soft-delete product |

**Fields:** name, description, price (numeric), category, stock (numeric), is_available (boolean)

### orders

Order management for marketplace.

**Dependencies:** `auth >= 1.0.0`, `products >= 1.0.0`

**Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/orders` | List orders (paginated) |
| GET | `/orders/:id` | Get order |
| POST | `/orders` | Create order |
| PATCH | `/orders/:id` | Update order |
| DELETE | `/orders/:id` | Soft-delete order |

**Fields:** product_id, quantity (numeric), total_amount (numeric), status, shipping_address

### properties

Property listings for real estate.

**Dependencies:** `auth >= 1.0.0`

**Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/properties` | List properties (paginated, searchable) |
| GET | `/properties/:id` | Get property |
| POST | `/properties` | Create property |
| PATCH | `/properties/:id` | Update property |
| DELETE | `/properties/:id` | Soft-delete property |

**Fields:** title, property_type, address, city, price (numeric), bedrooms, bathrooms, area_sqft, description, is_available (boolean)

### leads

Lead management for real estate agents.

**Dependencies:** `auth >= 1.0.0`

**Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/leads` | List leads (paginated, searchable) |
| GET | `/leads/:id` | Get lead |
| POST | `/leads` | Create lead |
| PATCH | `/leads/:id` | Update lead |
| DELETE | `/leads/:id` | Soft-delete lead |

**Fields:** name, email, phone, interest, status, source

---

## Project Structure

After `brickend init my-api --template starter` + `brickend add entities`:

```
my-api/
├── .git/
├── supabase/
│   ├── functions/
│   │   ├── _shared/                              # Shared code (generated by init)
│   │   │   ├── core/
│   │   │   │   ├── cors.ts                       # CORS headers helper
│   │   │   │   ├── auth.ts                       # [auth] JWT verification (verifyAuth)
│   │   │   │   ├── rbac.ts                       # RBAC middleware (checkPermission)
│   │   │   │   ├── responses.ts                  # HTTP response helpers
│   │   │   │   ├── errors.ts                     # AppError + typed subclasses
│   │   │   │   └── supabase.ts                   # Supabase client factory
│   │   │   ├── schemas/
│   │   │   │   ├── auth.ts                       # [auth] Signin, Signup Zod schemas
│   │   │   │   ├── identification_type.ts        # [identification_types] Schema
│   │   │   │   ├── user.ts                       # [users] User Zod schemas
│   │   │   │   └── entity.ts                     # [entities] Entity Zod schemas
│   │   │   └── services/
│   │   │       ├── users/                        # [users] Service folder
│   │   │       │   ├── index.ts                  # Barrel export
│   │   │       │   ├── const-users.ts            # Constants
│   │   │       │   ├── create-user.ts
│   │   │       │   ├── get-user.ts
│   │   │       │   ├── list-users.ts
│   │   │       │   ├── update-user.ts
│   │   │       │   └── delete-user.ts
│   │   │       └── entities/                     # [entities] Service folder
│   │   │           ├── index.ts
│   │   │           ├── const-entities.ts
│   │   │           ├── create-entity.ts
│   │   │           ├── get-entity.ts
│   │   │           ├── list-entities.ts
│   │   │           ├── update-entity.ts
│   │   │           └── delete-entity.ts
│   │   ├── auth/
│   │   │   ├── index.ts                          # [auth] Edge Function
│   │   │   └── deno.json                         # Deno configuration
│   │   ├── users/
│   │   │   ├── index.ts                          # [users] Edge Function
│   │   │   └── deno.json
│   │   └── entities/
│   │       ├── index.ts                          # [entities] Edge Function
│   │       └── deno.json
│   ├── migrations/                               # SQL migrations (via supabase migration new)
│   ├── config.toml                               # Created by supabase init
│   └── seed.sql                                  # Created by supabase init
├── openapi.yaml                                  # Generated OpenAPI 3.2 spec
├── docs/
│   └── index.html                                # Scalar API docs viewer
├── brickend.state.json                           # Persistent project state
├── brickend.yaml                                 # Project configuration (roles, settings)
├── .env.example
└── .gitignore
```

---

## Brick Configuration

Bricks can accept configuration values that flow into the generated code. Configuration is resolved at generation time — it affects both TypeScript schemas (Zod enums) and SQL schemas (CHECK constraints).

### Specifying configuration

```bash
# Single value
brickend add entities --config identification_types=NIT,CC,CE

# Multiple config keys
brickend add entities --config identification_types=NIT,CC --config max_results=50

# JSON format
brickend add entities --config 'identification_types=["NIT","CC","CE"]'
```

### How config flows into code

In `brick.yaml`, fields reference config with `$config.<key>`:

```yaml
fields:
  - name: identification_type
    zod: "$config.identification_types"    # -> z.enum(["NIT", "CC", "CE"])
    sql: "$config.identification_types"    # -> CHECK (... IN ('NIT', 'CC', 'CE'))
```

At generation time, `$config.identification_types` is replaced with the actual array value, and each generator (Zod/SQL) formats it appropriately.

---

## State Management

Brickend tracks project state in `brickend.state.json`. This file is the source of truth for what's installed and how.

```json
{
  "project": "my-api",
  "type": "api",
  "stack": "typescript/supabase-edge-functions",
  "template": "starter",
  "settings": {
    "multi_tenant": false
  },
  "schemas": [],
  "roles": [
    { "name": "admin", "description": "Full access", "is_default": true },
    { "name": "member", "description": "Standard user" },
    { "name": "viewer", "description": "Read-only access" }
  ],
  "bricks": {
    "identification_types": {
      "version": "1.0.0",
      "installed_at": "2026-03-13T21:29:30.000Z",
      "config": {},
      "files": [
        "supabase/functions/_shared/schemas/identification_type.ts",
        "supabase/migrations/20260313212930_add_identification_types.sql"
      ]
    },
    "auth": {
      "version": "1.0.0",
      "installed_at": "2026-03-13T21:30:00.000Z",
      "config": {},
      "files": [
        "supabase/functions/_shared/core/auth.ts",
        "supabase/functions/_shared/schemas/auth.ts",
        "supabase/functions/auth/index.ts",
        "supabase/functions/auth/deno.json"
      ]
    },
    "users": {
      "version": "1.0.0",
      "installed_at": "2026-03-13T21:30:30.000Z",
      "config": {},
      "files": [
        "supabase/functions/_shared/schemas/user.ts",
        "supabase/functions/_shared/services/users/index.ts",
        "supabase/functions/_shared/services/users/const-users.ts",
        "supabase/functions/_shared/services/users/create-user.ts",
        "supabase/functions/_shared/services/users/get-user.ts",
        "supabase/functions/_shared/services/users/list-users.ts",
        "supabase/functions/_shared/services/users/update-user.ts",
        "supabase/functions/_shared/services/users/delete-user.ts",
        "supabase/functions/users/index.ts",
        "supabase/functions/users/deno.json",
        "supabase/migrations/20260313213030_add_users.sql"
      ]
    }
  },
  "created_at": "2026-03-13T21:29:00.000Z",
  "updated_at": "2026-03-13T21:30:30.000Z"
}
```

**Key properties:**
- **Persists across sessions** — Any AI agent or human can read the state and understand what's installed
- **Tracks every generated file** — Knows exactly which files belong to which brick
- **Records configuration** — The exact config used for each brick installation
- **Validated with Zod** — Malformed state files produce clear error messages
- **Tracks roles and settings** — RBAC roles and multi-tenant config are part of the state

---

## Development Workflow

### Local development

```bash
# Start Supabase (database, auth, storage, edge functions runtime)
supabase start

# Serve Edge Functions locally (watches for changes)
supabase functions serve

# API is available at:
# http://localhost:54321/functions/v1/<brick-name>
```

### Adding bricks incrementally

```bash
# Start with the baseline (auto-installed by init)
# identification_types → auth → users

# Later, add entities
brickend add entities

# Even later, add catalog (auto-installs catalog-item-types + catalog-categories extensions)
brickend add catalog
```

Each `add` generates only the new files. Existing bricks are never touched.

### Database migrations

When you add a brick with a database schema, Brickend:

1. Generates the SQL migration content from the brick spec
2. Creates a migration file via `supabase migration new add_<brick>`
3. The migration contains `CREATE TABLE`, indexes, RLS policies, and seed data as needed

Apply migrations:

```bash
supabase start
supabase db reset   # Apply all migrations from scratch
```

### Soft delete

All bricks use soft delete by default:
- `DELETE` endpoints set `deleted_at = now()` instead of removing rows
- All `SELECT` queries filter by `deleted_at IS NULL`
- RLS policies respect `deleted_at IS NULL`
- Every table includes `created_at`, `updated_at`, `deleted_at` columns

---

## Creating Custom Bricks

### Using the CLI (recommended)

```bash
# Create a custom brick with fields and owner tracking:
brickend create-brick invoices \
  --fields "title:string:required,amount:numeric:required,due_date:string,status:string:required" \
  --owner --search-field title

# Generate the code, services, and migration:
brickend generate invoices
```

The `create-brick` command reads your project's roles and settings to pre-fill RBAC access rules. See [`brickend create-brick`](#brickend-create-brick) for all options.

### Manual YAML

Bricks are defined by a `<name>.bricks.yaml` file in `brickend/<name>/`. The format is declarative — you define `schema`, `api`, and `access` sections, and the generator produces all code.

### brick.yaml structure

```yaml
brick:
  name: my-brick              # Unique identifier (matches filename)
  version: "1.0.0"            # Semver version
  description: "What it does" # Shown in selection menus

requires:                      # Dependencies (checked before install)
  - brick: auth
    version: ">=1.0.0"

config:                        # User-configurable values
  some_option:
    description: "What this option controls"
    default: ["value1", "value2"]
    type: "string[]"

schema:                        # Database table definition
  table: my_items
  primary_key: item_id
  fields:
    - name: item_id
      type: uuid
      default: "gen_random_uuid()"
    - name: owner_id
      type: uuid
      references: auth         # FK to auth.users(id)
    - name: title
      type: string
      required: true
    - name: status
      type: string
      required: true
  indexes:
    - name: my_items_title_gin_idx
      columns: [title]
      type: gin
      expression: "to_tsvector('simple', title)"
  constraints:
    create:
      my_items_pkey:
        type: ConflictError
        message: "An item with this ID already exists"

access:                        # RBAC rules
  - role: admin
    actions: [list, get, create, update, softDelete]
  - role: member
    actions: [list, get, create]
    own_only: true
  - role: viewer
    actions: [list, get]
    own_only: true

api:                           # HTTP endpoints
  auth_required: true
  search_field: title
  endpoints:
    - { method: GET,    path: /,    handler: list,       has_pagination: true }
    - { method: GET,    path: /:id, handler: get }
    - { method: POST,   path: /,    handler: create,     status: 201 }
    - { method: PATCH,  path: /:id, handler: update }
    - { method: DELETE, path: /:id, handler: softDelete, status: 204 }
```

The generator infers `create_mode` from the schema:
- **with-id**: PK field has `references: auth` (e.g. `users` — caller provides their auth UID as PK)
- **with-owner**: Non-PK field has `references: auth` (e.g. `entities` — auto-generates PK, sets `owner_id`)
- **standard**: No auth reference (e.g. `identification_types`)

See [docs/brick-spec.md](docs/brick-spec.md) for the full specification reference.

---

## Multi-Tenant Workspaces

Brickend supports multi-tenant projects where data is scoped by workspaces.

### Enabling multi-tenant

```bash
# Via template
brickend init my-api --template multi-tenant

# Or set in brickend.yaml:
# settings:
#   multi_tenant: true
```

### How it works

When `settings.multi_tenant: true`:

- All applicable tables get a `workspace_id` column automatically
- Tables with `with-owner` or `standard` create mode are workspace-scoped
- Tables with `with-id` create mode (e.g. `user_profiles`) are NOT scoped
- The `workspaces` brick is auto-installed in the baseline
- Auth signup creates a default workspace + `workspace_users` entry
- Entrypoints read the `X-Workspace-Id` header for workspace context
- Service functions accept `workspaceId` and filter with `.eq("workspace_id", workspaceId)`
- RLS policies pass `workspace_id` to `rbac.has_permission()` for workspace-level checks
- CORS includes `X-Workspace-Id` in allowed headers

### Opting out

Bricks can opt out of workspace scoping:

```yaml
schema:
  workspace_scoped: false   # This table won't get workspace_id
```

---

## Templates

Templates are predefined project configurations that set up roles, settings, and baseline bricks.

### Available templates

| Template | Description | Multi-tenant | Baseline |
|----------|-------------|:------------:|----------|
| `starter` | Minimal API with auth and user management | No | identification_types, auth, users |
| `business` | Business management with entities and catalog | No | identification_types, auth, users, entities, catalog |
| `multi-tenant` | Multi-tenant API with workspaces | Yes | identification_types, auth, users, workspaces |
| `saas-admin` | Multi-tenant SaaS admin panel | Yes | identification_types, auth, users, workspaces, entities, catalog |
| `crm` | Simple CRM with contacts and deals | No | identification_types, auth, users, entities, contacts, deals |
| `marketplace` | Basic marketplace with products and orders | No | identification_types, auth, users, products, orders |
| `real-estate` | Property listings and lead management | No | identification_types, auth, users, properties, leads |

### Template file format

Templates are YAML files in `bricks/templates/`:

```yaml
template:
  name: starter
  version: "1.0.0"
  description: "Minimal API with auth and user management"

settings:
  multi_tenant: false

roles:
  - name: admin
    description: "Full access to all resources"
    is_default: true
  - name: member
    description: "Standard user with limited access"
  - name: viewer
    description: "Read-only access"

baseline:                    # Always installed during init
  - { brick: identification_types, version: ">=1.0.0" }
  - { brick: auth, version: ">=1.0.0" }
  - { brick: users, version: ">=1.0.0" }

bricks:                      # Offered as optional extras
  - { brick: entities, version: ">=1.0.0" }
  - { brick: catalog, version: ">=1.0.0" }
```

---

## MCP Server (AI Agent Integration)

Brickend includes an MCP server so AI agents (Claude Code, Cursor, etc.) can build software programmatically using the same operations as the CLI.

### Tools available

| Tool | Description |
|------|-------------|
| `brickend_init` | Initialize a new project (with optional template) |
| `brickend_add` | Add a brick to the project |
| `brickend_status` | Get current project state as JSON |
| `brickend_list_templates` | List available templates with roles and settings |
| `brickend_list_bricks` | List available bricks with dependencies and endpoints |

### Claude Code

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "brickend": {
      "command": "brickend-mcp"
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "brickend": {
      "command": "brickend-mcp"
    }
  }
}
```

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│               CLI (Commander.js)                  │
│  init, add, status, lint                          │
├──────────────────────────────────────────────────┤
│               Core Engine                         │
│  ┌────────────┐ ┌────────────┐ ┌──────────────┐  │
│  │   State    │ │   Brick    │ │  Dependency  │  │
│  │  Manager   │ │   Loader   │ │  Resolver    │  │
│  └────────────┘ └────────────┘ └──────────────┘  │
│  ┌────────────┐ ┌────────────────────────────┐   │
│  │  Template  │ │      Code Generator        │   │
│  │   Loader   │ │  schema | service | api    │   │
│  └────────────┘ └────────────────────────────┘   │
├──────────────────────────────────────────────────┤
│        Brick Definitions (14 bricks)              │
│  Core: auth, users, entities, catalog, workspaces │
│  CRM: contacts, deals                             │
│  Marketplace: products, orders                    │
│  Real Estate: properties, leads                   │
│  Templates: 7 (starter → real-estate)             │
├──────────────────────────────────────────────────┤
│          Generated Project (Supabase)             │
│  Edge Functions + Migrations + State + API Docs   │
└──────────────────────────────────────────────────┘
```

**Runtime separation:**
- Brickend itself runs on **Bun** (Node-compatible)
- Generated code runs on **Deno** (Supabase Edge Functions)
- Generated imports use `npm:zod`, `npm:@supabase/supabase-js@2`, and `.ts` extensions

---

## License

MIT
