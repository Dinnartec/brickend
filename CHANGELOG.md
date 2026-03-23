# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
