import type { AccessRule } from "../brick-spec.ts";
import type { RoleConfig } from "./brickend-yaml.ts";

export function rbacMigrationTemplate(roles: RoleConfig[], multiTenant = false): string {
	const roleSeeds = roles
		.map((r) => {
			const isDefault = r.is_default ? "true" : "false";
			return `INSERT INTO rbac.roles (name, description, is_default) VALUES ('${r.name}', '${r.description}', ${isDefault}) ON CONFLICT (name) DO NOTHING;`;
		})
		.join("\n");

	if (multiTenant) {
		return `-- RBAC Infrastructure: roles, permissions, workspaces, workspace_users
-- Created by brickend init (multi-tenant mode)

-- Core utility: keeps updated_at current on every row update
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Dedicated schema for RBAC
CREATE SCHEMA IF NOT EXISTS rbac;

GRANT USAGE ON SCHEMA rbac TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA rbac TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA rbac TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA rbac TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA rbac GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA rbac GRANT ALL ON ROUTINES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA rbac GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- Roles table
CREATE TABLE rbac.roles (
  role_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Permissions: what each role can do on each resource
CREATE TABLE rbac.permissions (
  permission_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES rbac.roles(role_id) ON DELETE CASCADE,
  resource TEXT NOT NULL,
  action TEXT NOT NULL,
  own_only BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(role_id, resource, action)
);

-- Workspaces table (multi-tenant: each workspace is an isolated tenant)
CREATE TABLE rbac.workspaces (
  workspace_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

ALTER TABLE rbac.workspaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_read_own_workspaces" ON rbac.workspaces FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "service_role_all_workspaces" ON rbac.workspaces FOR ALL TO service_role USING (true);

-- Workspace-user join table: one role per user per workspace
CREATE TABLE rbac.workspace_users (
  workspace_id UUID NOT NULL REFERENCES rbac.workspaces(workspace_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES rbac.roles(role_id) ON DELETE CASCADE,
  invited_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

ALTER TABLE rbac.workspace_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_read_own_workspace_users" ON rbac.workspace_users FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "service_role_all_workspace_users" ON rbac.workspace_users FOR ALL TO service_role USING (true);

-- Centralized permission check function (workspace-scoped).
-- ALL tables delegate to this via RLS policies.
-- Changing permissions in the rbac tables = instant effect everywhere.
CREATE OR REPLACE FUNCTION rbac.has_permission(
  p_resource TEXT,
  p_action TEXT,
  p_owner_id UUID DEFAULT NULL,
  p_workspace_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM rbac.workspace_users wu
    JOIN rbac.permissions p ON p.role_id = wu.role_id
    WHERE wu.user_id = auth.uid()
      AND wu.workspace_id = p_workspace_id
      AND p.resource = p_resource
      AND p.action = p_action
      AND (
        p.own_only = false
        OR (p.own_only = true AND p_owner_id = auth.uid())
      )
  );
$$;

-- RLS on RBAC tables themselves
ALTER TABLE rbac.roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_read_roles" ON rbac.roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "service_role_all_roles" ON rbac.roles FOR ALL TO service_role USING (true);

ALTER TABLE rbac.permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_read_permissions" ON rbac.permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "service_role_all_permissions" ON rbac.permissions FOR ALL TO service_role USING (true);

-- updated_at trigger for roles
CREATE TRIGGER roles_updated_at
  BEFORE UPDATE ON rbac.roles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- updated_at trigger for workspaces
CREATE TRIGGER workspaces_updated_at
  BEFORE UPDATE ON rbac.workspaces
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed roles
${roleSeeds}
`;
	}

	return `-- RBAC Infrastructure: roles, permissions, user_roles
-- Created by brickend init

-- Core utility: keeps updated_at current on every row update
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Dedicated schema for RBAC
CREATE SCHEMA IF NOT EXISTS rbac;

GRANT USAGE ON SCHEMA rbac TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA rbac TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA rbac TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA rbac TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA rbac GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA rbac GRANT ALL ON ROUTINES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA rbac GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- Roles table
CREATE TABLE rbac.roles (
  role_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Permissions: what each role can do on each resource
CREATE TABLE rbac.permissions (
  permission_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES rbac.roles(role_id) ON DELETE CASCADE,
  resource TEXT NOT NULL,
  action TEXT NOT NULL,
  own_only BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(role_id, resource, action)
);

-- User-role assignments
CREATE TABLE rbac.user_roles (
  user_role_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES rbac.roles(role_id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role_id)
);

-- Centralized permission check function.
-- ALL tables delegate to this via RLS policies.
-- Changing permissions in the rbac tables = instant effect everywhere.
CREATE OR REPLACE FUNCTION rbac.has_permission(
  p_resource TEXT,
  p_action TEXT,
  p_owner_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM rbac.user_roles ur
    JOIN rbac.permissions p ON p.role_id = ur.role_id
    WHERE ur.user_id = auth.uid()
      AND p.resource = p_resource
      AND p.action = p_action
      AND (
        p.own_only = false
        OR (p.own_only = true AND p_owner_id = auth.uid())
      )
  );
$$;

-- Helper: check if user has a specific role
CREATE OR REPLACE FUNCTION rbac.has_role(role_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM rbac.user_roles ur
    JOIN rbac.roles r ON r.role_id = ur.role_id
    WHERE ur.user_id = auth.uid()
      AND r.name = role_name
  );
$$;

-- RLS on RBAC tables themselves
ALTER TABLE rbac.roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_read_roles" ON rbac.roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "service_role_all_roles" ON rbac.roles FOR ALL TO service_role USING (true);

ALTER TABLE rbac.permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_read_permissions" ON rbac.permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "service_role_all_permissions" ON rbac.permissions FOR ALL TO service_role USING (true);

ALTER TABLE rbac.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_read_own_roles" ON rbac.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "service_role_all_user_roles" ON rbac.user_roles FOR ALL TO service_role USING (true);

-- updated_at trigger for roles
CREATE TRIGGER roles_updated_at
  BEFORE UPDATE ON rbac.roles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed roles
${roleSeeds}
`;
}

export function rbacMiddlewareTemplate(multiTenant = false): string {
	if (multiTenant) {
		return `import { createSupabaseClient } from "./supabase.ts";
import { ForbiddenError } from "./errors.ts";

/**
 * Validates permissions at API level by calling the centralized DB function.
 * Multi-tenant: reads X-Workspace-Id header for workspace-scoped checks.
 */
export async function checkPermission(
  req: Request,
  resource: string,
  action: string,
  ownerId?: string,
): Promise<void> {
  const workspaceId = req.headers.get("x-workspace-id") ?? null;
  const supabase = createSupabaseClient(req);
  const { data, error } = await supabase.schema("rbac").rpc("has_permission", {
    p_resource: resource,
    p_action: action,
    p_owner_id: ownerId ?? null,
    p_workspace_id: workspaceId,
  });
  if (error || !data) {
    throw new ForbiddenError(\`No permission to \${action} on \${resource}\`);
  }
}
`;
	}

	return `import { createSupabaseClient } from "./supabase.ts";
import { ForbiddenError } from "./errors.ts";

/**
 * Validates permissions at API level by calling the centralized DB function.
 * Same logic as RLS — defense in depth.
 */
export async function checkPermission(
  req: Request,
  resource: string,
  action: string,
  ownerId?: string,
): Promise<void> {
  const supabase = createSupabaseClient(req);
  const { data, error } = await supabase.schema("rbac").rpc("has_permission", {
    p_resource: resource,
    p_action: action,
    p_owner_id: ownerId ?? null,
  });
  if (error || !data) {
    throw new ForbiddenError(\`No permission to \${action} on \${resource}\`);
  }
}
`;
}

export function rbacPermissionsSeedSql(brickName: string, accessRules: AccessRule[]): string {
	const lines: string[] = [];
	lines.push(`-- RBAC permissions for ${brickName}`);
	for (const rule of accessRules) {
		for (const action of rule.actions) {
			const ownOnly = rule.own_only ? "true" : "false";
			lines.push(
				`INSERT INTO rbac.permissions (role_id, resource, action, own_only) SELECT r.role_id, '${brickName}', '${action}', ${ownOnly} FROM rbac.roles r WHERE r.name = '${rule.role}' ON CONFLICT (role_id, resource, action) DO NOTHING;`,
			);
		}
	}
	lines.push("");
	return lines.join("\n");
}

/**
 * SQL appended to the workspaces brick migration to create workspace_users
 * join table and replace has_permission() with the workspace-aware version.
 */
export function workspaceInfrastructureSql(): string {
	return `
-- Workspace-user join table: one role per user per workspace
CREATE TABLE rbac.workspace_users (
  workspace_id UUID NOT NULL REFERENCES rbac.workspaces(workspace_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES rbac.roles(role_id) ON DELETE CASCADE,
  invited_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

ALTER TABLE rbac.workspace_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_read_own_workspace_users" ON rbac.workspace_users FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "service_role_all_workspace_users" ON rbac.workspace_users FOR ALL TO service_role USING (true);

-- Replace has_permission() with workspace-aware version.
-- When p_workspace_id IS NOT NULL → checks workspace_users (workspace-scoped roles).
-- When p_workspace_id IS NULL → checks user_roles (global roles, backward compat).
CREATE OR REPLACE FUNCTION rbac.has_permission(
  p_resource TEXT,
  p_action TEXT,
  p_owner_id UUID DEFAULT NULL,
  p_workspace_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM (
      -- Workspace-scoped (when workspace_id provided)
      SELECT p.own_only FROM rbac.workspace_users wu
      JOIN rbac.permissions p ON p.role_id = wu.role_id
      WHERE wu.user_id = auth.uid()
        AND wu.workspace_id = p_workspace_id
        AND p.resource = p_resource AND p.action = p_action
        AND p_workspace_id IS NOT NULL
      UNION ALL
      -- Global fallback (when no workspace_id)
      SELECT p.own_only FROM rbac.user_roles ur
      JOIN rbac.permissions p ON p.role_id = ur.role_id
      WHERE ur.user_id = auth.uid()
        AND p.resource = p_resource AND p.action = p_action
        AND p_workspace_id IS NULL
    ) perms
    WHERE perms.own_only = false
      OR (perms.own_only = true AND p_owner_id = auth.uid())
  );
$$;
`;
}
