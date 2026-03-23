import { describe, expect, it } from "bun:test";
import {
	rbacMiddlewareTemplate,
	rbacMigrationTemplate,
	rbacPermissionsSeedSql,
} from "../../src/core/templates/rbac.ts";

describe("RBAC Templates", () => {
	describe("rbacMigrationTemplate", () => {
		const roles = [
			{ name: "admin", description: "Full access", is_default: true },
			{ name: "member", description: "Limited access" },
			{ name: "viewer", description: "Read-only" },
		];

		it("creates rbac schema", () => {
			const sql = rbacMigrationTemplate(roles);
			expect(sql).toContain("CREATE SCHEMA IF NOT EXISTS rbac");
		});

		it("creates roles table", () => {
			const sql = rbacMigrationTemplate(roles);
			expect(sql).toContain("CREATE TABLE rbac.roles");
			expect(sql).toContain("name TEXT NOT NULL UNIQUE");
			expect(sql).toContain("is_default BOOLEAN");
		});

		it("creates permissions table", () => {
			const sql = rbacMigrationTemplate(roles);
			expect(sql).toContain("CREATE TABLE rbac.permissions");
			expect(sql).toContain("resource TEXT NOT NULL");
			expect(sql).toContain("action TEXT NOT NULL");
			expect(sql).toContain("own_only BOOLEAN");
			expect(sql).toContain("UNIQUE(role_id, resource, action)");
		});

		it("creates user_roles table", () => {
			const sql = rbacMigrationTemplate(roles);
			expect(sql).toContain("CREATE TABLE rbac.user_roles");
			expect(sql).toContain("REFERENCES auth.users(id)");
			expect(sql).toContain("REFERENCES rbac.roles(role_id)");
			expect(sql).toContain("UNIQUE(user_id, role_id)");
		});

		it("creates has_permission function", () => {
			const sql = rbacMigrationTemplate(roles);
			expect(sql).toContain("CREATE OR REPLACE FUNCTION rbac.has_permission");
			expect(sql).toContain("p_resource TEXT");
			expect(sql).toContain("p_action TEXT");
			expect(sql).toContain("p_owner_id UUID DEFAULT NULL");
			expect(sql).toContain("SECURITY DEFINER");
		});

		it("creates has_role function", () => {
			const sql = rbacMigrationTemplate(roles);
			expect(sql).toContain("CREATE OR REPLACE FUNCTION rbac.has_role");
		});

		it("enables RLS on RBAC tables", () => {
			const sql = rbacMigrationTemplate(roles);
			expect(sql).toContain("ALTER TABLE rbac.roles ENABLE ROW LEVEL SECURITY");
			expect(sql).toContain("ALTER TABLE rbac.permissions ENABLE ROW LEVEL SECURITY");
			expect(sql).toContain("ALTER TABLE rbac.user_roles ENABLE ROW LEVEL SECURITY");
		});

		it("seeds roles from parameter", () => {
			const sql = rbacMigrationTemplate(roles);
			expect(sql).toContain(
				"INSERT INTO rbac.roles (name, description, is_default) VALUES ('admin'",
			);
			expect(sql).toContain(
				"INSERT INTO rbac.roles (name, description, is_default) VALUES ('member'",
			);
			expect(sql).toContain(
				"INSERT INTO rbac.roles (name, description, is_default) VALUES ('viewer'",
			);
			expect(sql).toContain("true"); // admin is_default
		});

		it("grants schema permissions", () => {
			const sql = rbacMigrationTemplate(roles);
			expect(sql).toContain("GRANT USAGE ON SCHEMA rbac TO anon, authenticated, service_role");
		});
	});

	describe("rbacMiddlewareTemplate", () => {
		it("generates TypeScript middleware", () => {
			const ts = rbacMiddlewareTemplate();
			expect(ts).toContain("export async function checkPermission");
			expect(ts).toContain("resource: string");
			expect(ts).toContain("action: string");
			expect(ts).toContain("ownerId?: string");
			expect(ts).toContain('.schema("rbac")');
			expect(ts).toContain('.rpc("has_permission"');
			expect(ts).toContain("ForbiddenError");
		});

		it("imports from core modules", () => {
			const ts = rbacMiddlewareTemplate();
			expect(ts).toContain('from "./supabase.ts"');
			expect(ts).toContain('from "./errors.ts"');
		});
	});

	describe("rbacPermissionsSeedSql", () => {
		it("generates INSERT for each role-action pair", () => {
			const sql = rbacPermissionsSeedSql("entities", [
				{ role: "admin", actions: ["list", "get", "create"], own_only: false },
				{ role: "member", actions: ["list", "get"], own_only: true },
			]);
			expect(sql).toContain("INSERT INTO rbac.permissions");
			// admin gets 3 INSERTs
			expect(sql).toContain("'entities', 'list', false");
			expect(sql).toContain("'entities', 'get', false");
			expect(sql).toContain("'entities', 'create', false");
			// member gets 2 INSERTs with own_only=true
			expect(sql).toContain("'entities', 'list', true");
			expect(sql).toContain("'entities', 'get', true");
			expect(sql).toContain("WHERE r.name = 'admin'");
			expect(sql).toContain("WHERE r.name = 'member'");
			expect(sql).toContain("ON CONFLICT (role_id, resource, action) DO NOTHING");
		});

		it("returns comment-only when no access rules", () => {
			const sql = rbacPermissionsSeedSql("empty", []);
			expect(sql).toContain("RBAC permissions for empty");
			expect(sql).not.toContain("INSERT");
		});
	});
});
