import semver from "semver";
import type { BrickSpec } from "./brick-spec.ts";

export interface LintDiagnostic {
	path: string;
	rule: string;
	message: string;
	severity: "error" | "warning";
}

const JS_IDENTIFIER = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
const SNAKE_KEBAB_CASE = /^[a-z0-9_-]+$/;

export interface LintOptions {
	knownRoles?: string[];
}

export function lintBrickSpec(
	spec: BrickSpec,
	options: LintOptions = {},
): LintDiagnostic[] {
	const diags: LintDiagnostic[] = [];

	// semver-valid: brick.version must be a valid semver
	if (!semver.valid(spec.brick.version)) {
		diags.push({
			path: "brick.version",
			rule: "semver-valid",
			message: `"${spec.brick.version}" is not a valid semver version`,
			severity: "error",
		});
	}

	// name-matches-dir: brick.name should be lowercase snake_case or kebab-case
	if (!SNAKE_KEBAB_CASE.test(spec.brick.name)) {
		diags.push({
			path: "brick.name",
			rule: "name-matches-dir",
			message: `Name "${spec.brick.name}" should be lowercase (no uppercase letters or spaces)`,
			severity: "warning",
		});
	}

	// semver-valid: each requires[].version must be a valid semver range
	for (let i = 0; i < spec.requires.length; i++) {
		const req = spec.requires[i];
		if (!req) continue;
		if (!semver.validRange(req.version)) {
			diags.push({
				path: `requires[${i}].version`,
				rule: "semver-valid",
				message: `"${req.version}" is not a valid semver range`,
				severity: "error",
			});
		}
	}

	// semver-valid: each extensions[].version must be a valid semver range
	for (let i = 0; i < spec.extensions.length; i++) {
		const ext = spec.extensions[i];
		if (!ext) continue;
		if (!semver.validRange(ext.version)) {
			diags.push({
				path: `extensions[${i}].version`,
				rule: "semver-valid",
				message: `"${ext.version}" is not a valid semver range`,
				severity: "error",
			});
		}
	}

	const schema = spec.schema;
	const api = spec.api;

	if (schema) {
		const fields = schema.fields;
		const fieldNames = new Set(fields.map((f) => f.name));

		// pk-in-fields: primary_key must match a field name in schema.fields
		if (schema.primary_key && fields.length > 0 && !fieldNames.has(schema.primary_key)) {
			diags.push({
				path: "schema.primary_key",
				rule: "pk-in-fields",
				message: `Primary key "${schema.primary_key}" not found in schema.fields`,
				severity: "error",
			});
		}

		// uuid-reference-type: fields that reference "auth" must have type "uuid"
		for (const field of fields) {
			if (field.references === "auth" && field.type !== "uuid") {
				diags.push({
					path: `schema.fields[${field.name}]`,
					rule: "uuid-reference-type",
					message: `Field "${field.name}" references "auth" and must have type "uuid" (got "${field.type}")`,
					severity: "error",
				});
			}
		}
	}

	// access-actions-match-handlers: every action in access[].actions must match a handler
	const accessRules = spec.access ?? [];
	if (accessRules.length > 0 && api) {
		const handlerNames = new Set(api.endpoints.map((e) => e.handler));
		for (let i = 0; i < accessRules.length; i++) {
			const rule = accessRules[i];
			if (!rule) continue;
			for (const action of rule.actions) {
				if (!handlerNames.has(action)) {
					diags.push({
						path: `access[${i}].actions`,
						rule: "access-actions-match-handlers",
						message: `Action "${action}" does not match any endpoint handler`,
						severity: "error",
					});
				}
			}
		}
	}

	// access-own-only-needs-owner: if own_only is true, schema must have a field with references: auth
	if (accessRules.some((r) => r.own_only) && schema) {
		const hasOwnerField = schema.fields.some(
			(f) => f.name !== schema.primary_key && f.references === "auth",
		);
		// Also check PK referencing auth (e.g. user_id)
		const pkRefsAuth = schema.fields.some(
			(f) => f.name === schema.primary_key && f.references === "auth",
		);
		if (!hasOwnerField && !pkRefsAuth) {
			diags.push({
				path: "access",
				rule: "access-own-only-needs-owner",
				message: "own_only is true but schema has no field with references: auth (no owner field)",
				severity: "warning",
			});
		}
	}

	if (api) {
		const endpoints = api.endpoints;

		// auth-no-table: api.type "auth" bricks should not define schema.table
		if (api.type === "auth" && schema?.table) {
			diags.push({
				path: "schema.table",
				rule: "auth-no-table",
				message: `Bricks with api.type "auth" should not define schema.table`,
				severity: "warning",
			});
		}

		// rest-needs-table: api.type "rest" bricks with endpoints require schema.table
		if (api.type === "rest" && endpoints.length > 0 && !schema?.table) {
			diags.push({
				path: "schema.table",
				rule: "rest-needs-table",
				message: `REST bricks with endpoints require schema.table to be defined`,
				severity: "error",
			});
		}

		for (let i = 0; i < endpoints.length; i++) {
			const ep = endpoints[i];
			if (!ep) continue;

			// pagination-on-get: has_pagination is only valid on GET endpoints
			if (ep.has_pagination && ep.method !== "GET") {
				diags.push({
					path: `api.endpoints[${i}].has_pagination`,
					rule: "pagination-on-get",
					message: `has_pagination is only valid on GET endpoints (endpoint ${i} uses ${ep.method})`,
					severity: "error",
				});
			}

			// handler-identifier: handler must be a valid JavaScript identifier
			if (!JS_IDENTIFIER.test(ep.handler)) {
				diags.push({
					path: `api.endpoints[${i}].handler`,
					rule: "handler-identifier",
					message: `Handler "${ep.handler}" is not a valid JavaScript identifier`,
					severity: "error",
				});
			}
		}
	}

	// access-role-exists: access roles should exist in known project roles
	if (options.knownRoles && options.knownRoles.length > 0) {
		for (const rule of accessRules) {
			if (!options.knownRoles.includes(rule.role)) {
				diags.push({
					path: "access",
					rule: "access-role-exists",
					message: `Role "${rule.role}" is not defined in project roles (available: ${options.knownRoles.join(", ")}). Permissions for this role will not be created.`,
					severity: "warning",
				});
			}
		}
	}

	return diags;
}
