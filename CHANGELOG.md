# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.3] - 2026-03-27

### Fixed

- **Business template role mismatch** — renamed `manager` → `member` to match brick access rules (users with `manager` got zero permissions)
- **Catalog extensions RLS** — removed `own_only: true` from `catalog-item-types` and `catalog-categories` (lookup tables with no owner field were blocking non-admin access)
- **Linter role validation** — new `access-role-exists` rule warns when access rules reference roles not defined in any template
- **Improved `singularize()`** — added exception list for words like status, business, address + handle -ses/-xes/-zes suffixes
- **CLAUDE.md updated** — now reflects all 8 commands, 14 bricks, 7 templates, and new files (spec-diff, agents template, scripts)
- **CHANGELOG updated** — added missing v0.1.1 and v0.1.2 entries

## [0.1.2] - 2026-03-25

### Added

- **`brickend create-brick <name>`** — scaffold custom bricks with `--fields`, `--owner`, `--endpoints`, `--search-field`, and 10+ flags
- **`brickend init .`** — initialize in current directory, derives project name from folder
- **Automated release workflow** — `.github/workflows/release.yml` with patch/minor/major bump
- **Resilient manifest handling** — `brickend generate` auto-registers manually created manifests
- **Custom brick dependency resolution** — `brickend add` and `brickend generate` fall back to project manifests for custom bricks
- **Custom bricks in OpenAPI** — custom bricks now appear in generated `openapi.yaml`

### Fixed

- Version read from `package.json` (no more hardcoded strings in CLI/MCP)
- `brickend generate` no longer requires `--force` on first generation after `create-brick`
- Better error messages suggesting `create-brick` for custom bricks

## [0.1.1] - 2026-03-24

### Added

- **`brickend generate <brick>`** — regenerate code after editing brick manifest with spec diffing and ALTER TABLE migrations
- **`brickend list`** — list available templates and bricks (with `--json`, `--templates`, `--bricks` flags)
- **`brickend install-skill`** — install Brickend skill into Claude Code (`~/.claude/skills/`)
- **AGENTS.md** — generated in every new project to guide AI agents
- **File hash tracking** — SHA-256 hashes detect manual edits, skip with warning (use `--force` to override)
- **Spec diff engine** — `src/core/spec-diff.ts` detects field, endpoint, and access changes between specs
- **ALTER TABLE migration generation** — ADD/DROP COLUMN with WARNING for required fields without defaults
- **MCP tools:** `brickend_list_templates`, `brickend_list_bricks` for dynamic discovery
- **Claude Code skill** — `.claude/skills/brickend/SKILL.md` with MCP-based discovery
- **Demo templates:** `saas-admin`, `crm`, `marketplace`, `real-estate`
- **Domain bricks:** `contacts`, `deals`, `products`, `orders`, `properties`, `leads`
- **Deploy script** — `scripts/deploy.sh` generated in projects for production deployment
- **Smoke test** — `scripts/smoke-test.sh` with 16 E2E assertions
- **SECURITY.md** and GitHub issue templates

### Fixed

- RLS SELECT policy no longer blocks soft delete (removed `deleted_at IS NULL` from SELECT, added `WITH CHECK` to UPDATE)
- GitHub Actions upgraded to v5 for Node 24 support
- Repository URL case corrected (`Dinnartec` not `dinnartec`)

## [0.1.0] - 2026-03-19

### Added

- **CLI commands:** `brickend init`, `brickend add`, `brickend lint`
- **Core bricks:** `auth`, `users`, `entities`, `identification_types`, `catalog` (with `catalog-item-types` and `catalog-categories` extensions), `workspaces`
- **RBAC infrastructure:** Centralized `rbac.has_permission()` function, role-based access control with `access:` section in brick YAMLs, automatic permission seeding, API-level `checkPermission()` middleware
- **Multi-tenant support:** Workspace scoping with `workspace_id`, `workspace_users` join table, workspace-aware `has_permission()`, auth signup with automatic workspace creation
- **Project templates:** `starter`, `business`, `multi-tenant` — configurable roles, settings, and baseline bricks
- **Code generation:** Zod schemas, service files (CRUD), entrypoints, SQL migrations with RBAC-based RLS policies
- **OpenAPI documentation:** Auto-generated OpenAPI 3.2 spec with Scalar UI, `x-roles` extension for role visibility
- **Brick linter:** Validates brick specs (semver, field types, handler identifiers, access rule consistency)
- **State management:** `brickend.state.json` tracks installed bricks, roles, settings, and migration files
