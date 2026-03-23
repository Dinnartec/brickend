# Brick Specification Reference

A **brick** is a YAML file (`<name>.brick.yaml`) that declares a composable, production-ready module for Brickend. This document is the authoritative human-readable reference for all supported fields.

---

## File naming

Brick files must follow the convention: `bricks/<name>/<name>.brick.yaml`

The filename stem (without `.brick.yaml`) must match `brick.name`.

---

## Top-level sections

| Section | Required | Description |
|---------|----------|-------------|
| `brick` | yes | Identity metadata |
| `requires` | no | Brick dependencies |
| `extensions` | no | Sub-bricks within a feature family |
| `config` | no | User-configurable values |
| `schema` | no | Database table, fields, indexes, constraints |
| `access` | no | RBAC access rules (which roles can perform which actions) |
| `api` | no | HTTP endpoints and authentication type |

---

## `brick`

Identity block. `name`, `version`, and `description` are required.

```yaml
brick:
  name: my-feature        # snake_case or kebab-case, matches filename
  version: "1.0.0"        # valid semver (e.g. "1.0.0", "2.3.1")
  description: "Short description of what this brick provides"
  type: brick             # "brick" (default) | "extension"
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Unique identifier. Must be lowercase (no spaces, no uppercase). |
| `version` | string | yes | Semver version string (e.g. `"1.0.0"`). |
| `description` | string | yes | Human-readable summary. |
| `type` | enum | no | `"brick"` (default) or `"extension"`. Extension bricks are auto-installed by their parent and are not shown in the interactive selector. |

---

## `requires`

List of other bricks that must be installed before this one.

```yaml
requires:
  - { brick: identification_types, version: ">=1.0.0" }
  - { brick: auth, version: ">=1.0.0" }
```

| Field | Type | Description |
|-------|------|-------------|
| `brick` | string | Name of the required brick. |
| `version` | string | Semver range (e.g. `">=1.0.0"`, `"^2.0.0"`). |

---

## `extensions`

Sub-bricks within a feature family that are implicitly installed before the parent brick. Same shape as `requires`.

```yaml
extensions:
  - { brick: catalog-item-types, version: ">=1.0.0" }
  - { brick: catalog-categories, version: ">=1.0.0" }
```

Extensions are treated as implicit dependencies in the topological sort — they install before the declaring brick.

Extension bricks must declare `type: extension` in their `brick:` block so they are excluded from the interactive selector in `brickend add`.

---

## `config`

Named configuration values that brick authors can declare. Currently used for documentation; future versions will prompt the user to fill them in during `brickend add`.

```yaml
config:
  table_name:
    description: "The Postgres table name to use"
    type: "string"
    default: "my_items"
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `description` | string | yes | Help text shown to the user. |
| `type` | string | yes | The kind of value (e.g. `"string"`, `"string[]"`). |
| `default` | any | no | Default value if the user does not provide one. |

---

## `schema`

Describes the Postgres table generated for this brick.

```yaml
schema:
  db_schema: public        # optional, defaults to "public"
  table: user_profiles
  primary_key: user_id
  workspace_scoped: false  # optional, multi-tenant opt-out
  fields: [...]
  indexes: [...]
  constraints: { create: {...}, update: {...} }
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `db_schema` | string | `"public"` | Postgres schema name. Use for non-public schemas (e.g. `"catalog"`). |
| `table` | string | — | Table name. Required for `api.type: rest` bricks with endpoints. |
| `primary_key` | string | — | Name of the primary key column. Must match a field in `fields`. |
| `workspace_scoped` | boolean | — | When `false`, opts out of `workspace_id` column in multi-tenant mode. Auto-inferred if not set. |
| `fields` | FieldDef[] | `[]` | Column definitions. |
| `indexes` | IndexDef[] | `[]` | Additional indexes. |
| `constraints` | object | `{}` | Error mapping for DB constraint violations. |

### `fields` — FieldDef

```yaml
fields:
  - name: user_id
    type: uuid
    references: auth           # foreign key to auth.users
  - name: full_name
    type: string
    required: true
  - name: balance
    type: numeric
    nullable: true
    default: "0"
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Column name. |
| `type` | enum | yes | One of: `string`, `text`, `email`, `uuid`, `boolean`, `numeric`, `url`. |
| `required` | boolean | no | If `true`, adds `NOT NULL` and makes the Zod field non-optional. |
| `nullable` | boolean | no | If `true`, adds `.nullable()` to the Zod type. |
| `references` | string | no | Cross-brick reference. Special values: `"auth"` → FK to `auth.users(id)`. Other values (e.g. `"identification_types"`) produce an FK to that brick's table. |
| `default` | string | no | Raw SQL default expression (e.g. `"gen_random_uuid()"`, `"true"`, `"''"`) |

**Type mapping:**

| `type` | Postgres | Zod |
|--------|----------|-----|
| `string` | `TEXT` | `z.string()` |
| `text` | `TEXT` | `z.string()` |
| `email` | `TEXT` | `z.string().email()` |
| `uuid` | `UUID` | `z.string().uuid()` |
| `boolean` | `BOOLEAN` | `z.boolean()` |
| `numeric` | `NUMERIC` | `z.number()` |
| `url` | `TEXT` | `z.string().url()` |

### `indexes` — IndexDef

```yaml
indexes:
  - name: items_name_gin_idx
    columns: [name]
    type: gin
    expression: "to_tsvector('simple', name)"
  - name: items_owner_unique_idx
    columns: [owner_id, slug]
    type: unique
    where: "deleted_at is null"
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Index name. |
| `columns` | string[] | Columns covered by the index. |
| `type` | enum | `gin` \| `unique` \| `btree` (default if omitted). |
| `expression` | string | Optional expression for functional indexes (e.g. `to_tsvector(...)`). |
| `where` | string | Optional partial index `WHERE` clause. |

### `workspace_scoped`

Controls whether a table receives a `workspace_id` column in multi-tenant projects (`settings.multi_tenant: true`).

**Auto-inference rules** (when `workspace_scoped` is not set):
- Tables with `with-owner` or `standard` create mode → workspace-scoped (get `workspace_id`)
- Tables with `with-id` create mode (e.g. `user_profiles`) → not workspace-scoped
- Tables without an API or with `api.type: auth` → not workspace-scoped

Set `workspace_scoped: false` explicitly to opt out even when auto-inference would add it:

```yaml
schema:
  db_schema: rbac
  table: workspaces
  workspace_scoped: false   # workspaces table manages workspaces, not scoped by them
```

In single-tenant projects (`multi_tenant: false`), this field has no effect.

### `constraints`

Maps Postgres constraint names to typed application errors for use by the generated service layer.

```yaml
constraints:
  create:
    user_profiles_pkey:
      type: ConflictError
      message: "A user profile with this ID already exists"
    user_profiles_id_type_fkey:
      type: ValidationError
      message: "Invalid identification type"
  update:
    user_profiles_id_type_fkey:
      type: ValidationError
      message: "Invalid identification type"
```

`type` must be one of the `AppError` subclasses defined in `_shared/core/errors.ts` (e.g. `ConflictError`, `ValidationError`, `NotFoundError`).

---

## `api`

Defines the HTTP API generated for this brick.

```yaml
api:
  type: rest          # "rest" (default) | "auth"
  auth_required: true
  search_field: full_name
  endpoints: [...]
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `type` | enum | `"rest"` | `"rest"` for standard CRUD; `"auth"` for authentication endpoints (signup/signin/etc.). |
| `auth_required` | boolean | `false` | Wraps every endpoint handler with `verifyAuth(req)`. |
| `search_field` | string | — | Column used for full-text search on list endpoints. |
| `endpoints` | Endpoint[] | `[]` | HTTP endpoint definitions. |

### `endpoints` — Endpoint

```yaml
endpoints:
  - { method: GET,    path: /,    handler: list,       has_pagination: true }
  - { method: GET,    path: /:id, handler: get }
  - { method: POST,   path: /,    handler: create,     status: 201 }
  - { method: PATCH,  path: /:id, handler: update }
  - { method: DELETE, path: /:id, handler: softDelete, status: 204 }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `method` | enum | yes | HTTP method: `GET`, `POST`, `PATCH`, `DELETE`. |
| `path` | string | yes | Path within the function (e.g. `/`, `/:id`). |
| `handler` | string | yes | Camel-case JavaScript identifier used as the function name. |
| `status` | number | no | Override default HTTP status code (default: `200`). |
| `has_pagination` | boolean | no | `true` adds `page`/`limit` query params and a `total` response field. Only valid on `GET` endpoints. |
| `body` | FieldDef[] | no | For `auth` endpoints: inline body field definitions. If omitted, schema `fields` are used. |

---

## `access`

RBAC access rules defining which roles can perform which actions. Roles must match roles defined in the project's `brickend.yaml` (or the template that created it).

```yaml
access:
  - role: admin
    actions: [list, get, create, update, softDelete]
  - role: member
    actions: [list, get, create]
    own_only: true
  - role: viewer
    actions: [list, get]
    own_only: true
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `role` | string | yes | Role name (must match a role in `brickend.yaml`). |
| `actions` | string[] | yes | Endpoint handler names this role can invoke (e.g. `list`, `get`, `create`, `update`, `softDelete`). |
| `own_only` | boolean | no | Restrict to own records (default: `false`). When `true`, RLS enforces that users can only access records they own. |

The generator produces RLS policies that delegate to a centralized `rbac.has_permission()` function. Permission changes in the RBAC tables take effect immediately without modifying policies.

---

## `create_mode` inference

The generator infers a `create_mode` from the schema to decide how to write the service's `create` function. No explicit field is needed.

| Condition | `create_mode` | Description |
|-----------|---------------|-------------|
| `primary_key` field has `references: auth` | `with-id` | The caller supplies the PK (the user's auth UID). |
| No PK field, but another field has `references: auth` | `with-owner` | A new UUID PK is generated; the `owner_id` column is set to the caller's UID. |
| Neither of the above | `standard` | Normal insert, all values from request body. |

**Examples:**

- `users` brick — `user_id` is both the PK and references `auth` → `with-id`
- `entities` brick — `entity_id` is the PK with a generated default; `owner_id` references `auth` → `with-owner`
- `identification_types` brick — no auth reference → `standard`

---

## Cross-brick `references`

The `references` field on a `FieldDef` establishes a foreign key relationship.

| Value | FK target | Notes |
|-------|-----------|-------|
| `"auth"` | `auth.users(id)` | Field **must** have `type: uuid`. |
| `"<brick-name>"` | That brick's primary table and PK | The referenced brick must be in `requires`. |

---

## Common patterns

### Soft-delete table

All generated tables include `created_at`, `updated_at`, and `deleted_at` columns automatically. Soft-delete filtering (`deleted_at is null`) is handled at the application level in all service queries (get, list, update, delete). RLS policies delegate to `rbac.has_permission()` without filtering on `deleted_at`, so that soft-delete UPDATEs are not blocked by PostgreSQL's policy evaluation on the new row state.

### Non-public Postgres schema

```yaml
schema:
  db_schema: catalog
  table: catalog_items
  ...
```

The generator produces `CREATE SCHEMA IF NOT EXISTS catalog` before the `CREATE TABLE catalog.catalog_items` statement. The service uses `supabase.schema('catalog').from('catalog_items')`.

---

## Full examples

### `users` brick (REST, with-id create mode)

```yaml
brick:
  name: users
  version: "1.0.0"
  description: "User profile management (CRUD)"

requires:
  - { brick: identification_types, version: ">=1.0.0" }
  - { brick: auth, version: ">=1.0.0" }

config: {}

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
    - name: email
      type: email
      required: true
    - name: identification_type
      type: string
      nullable: true
      references: identification_types
    - name: identification_number
      type: string
      nullable: true
  indexes:
    - name: user_profiles_full_name_idx
      columns: [full_name]
      type: gin
      expression: "to_tsvector('simple', full_name)"
  constraints:
    create:
      user_profiles_pkey:
        type: ConflictError
        message: "A user profile with this ID already exists"
      user_profiles_identification_type_fkey:
        type: ValidationError
        message: "Invalid identification type"
    update:
      user_profiles_identification_type_fkey:
        type: ValidationError
        message: "Invalid identification type"

access:
  - role: admin
    actions: [list, get, create, update, softDelete]
  - role: member
    actions: [list, get]
    own_only: true
  - role: viewer
    actions: [list, get]
    own_only: true

api:
  auth_required: true
  search_field: full_name
  endpoints:
    - { method: GET,    path: /,    handler: list,       has_pagination: true }
    - { method: GET,    path: /:id, handler: get }
    - { method: POST,   path: /,    handler: create,     status: 201 }
    - { method: PATCH,  path: /:id, handler: update }
    - { method: DELETE, path: /:id, handler: softDelete, status: 204 }
```

### `auth` brick (authentication endpoints)

```yaml
brick:
  name: auth
  version: "1.0.0"
  description: "Authentication (JWT, signup, signin, signout)"

requires: []
config: {}

schema:
  fields:
    - name: email
      type: email
      required: true
    - name: password
      type: string
      required: true
    - name: full_name
      type: string
      required: true

api:
  type: auth
  endpoints:
    - method: POST
      path: /signup
      handler: signup
      status: 201
      body:
        - { name: email,     type: email,  required: true }
        - { name: password,  type: string, required: true }
        - { name: full_name, type: string, required: true }
    - method: POST
      path: /signin
      handler: signin
      body:
        - { name: email,    type: email,  required: true }
        - { name: password, type: string, required: true }
    - { method: POST, path: /signout, handler: signout }
    - { method: GET,  path: /me,      handler: me }
```

### `workspaces` brick (multi-tenant, workspace_scoped: false)

```yaml
brick:
  name: workspaces
  version: "1.0.0"
  description: "Workspace management for multi-tenant projects"

requires:
  - { brick: auth, version: ">=1.0.0" }
  - { brick: users, version: ">=1.0.0" }

config: {}

schema:
  db_schema: rbac
  table: workspaces
  workspace_scoped: false
  primary_key: workspace_id
  fields:
    - name: workspace_id
      type: uuid
      default: "gen_random_uuid()"
    - name: name
      type: string
      required: true
    - name: slug
      type: string
      required: true
    - name: owner_id
      type: uuid
      references: auth

access:
  - role: admin
    actions: [list, get, create, update, softDelete]
  - role: member
    actions: [list, get]
    own_only: true
  - role: viewer
    actions: [list, get]
    own_only: true

api:
  auth_required: true
  endpoints:
    - { method: GET,    path: /,    handler: list,       has_pagination: true }
    - { method: GET,    path: /:id, handler: get }
    - { method: POST,   path: /,    handler: create,     status: 201 }
    - { method: PATCH,  path: /:id, handler: update }
    - { method: DELETE, path: /:id, handler: softDelete, status: 204 }
```
