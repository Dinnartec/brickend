import { stringify } from "yaml";
import type { BrickSpec, Endpoint, FieldDef } from "./brick-spec.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function singularize(name: string): string {
	if (name.endsWith("ies")) return `${name.slice(0, -3)}y`;
	if (name.endsWith("s")) return name.slice(0, -1);
	return name;
}

function toPascalCase(s: string): string {
	return s
		.split(/[-_]/)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join("");
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Convert a brick name to a PascalCase entity name (e.g. "users" → "User"). */
function entityName(brickName: string): string {
	return toPascalCase(singularize(brickName));
}

/** Article for a word ("a" or "an"), with common phonetic exceptions. */
function article(word: string): string {
	const lower = word.toLowerCase();
	// Words starting with a vowel letter but a consonant sound (e.g. "user" = /juːzər/)
	if (/^u[bcdfgjklmnpqstvwxyz]/i.test(lower)) return "a";
	return /^[aeiou]/i.test(lower) ? "an" : "a";
}

/** Base OpenAPI type properties for a FieldDef type (no nullable handling). */
function fieldBaseProps(type: FieldDef["type"]): Record<string, unknown> {
	switch (type) {
		case "email":
			return { type: "string", format: "email" };
		case "uuid":
			return { type: "string", format: "uuid" };
		case "boolean":
			return { type: "boolean" };
		case "numeric":
			return { type: "number" };
		case "url":
			return { type: "string", format: "uri" };
		default:
			return { type: "string" };
	}
}

/** Full OpenAPI property schema for a field, including nullable. */
function fieldToSchema(field: FieldDef): Record<string, unknown> {
	const base = fieldBaseProps(field.type);
	if (field.nullable) {
		return { ...base, type: [base.type as string, "null"] };
	}
	return base;
}

/** Convert brick endpoint path to OpenAPI path string. */
function toOpenApiPath(brickName: string, endpointPath: string): string {
	const normalized = endpointPath === "/" ? "" : endpointPath;
	return `/${brickName}${normalized}`.replace(/:(\w+)/g, "{$1}");
}

/** Auth endpoint handlers that require a bearer token. */
const AUTH_REQUIRED_HANDLERS = new Set(["signout", "me"]);

// ---------------------------------------------------------------------------
// Schema builders
// ---------------------------------------------------------------------------

function buildEntitySchemas(
	spec: BrickSpec,
	entity: string,
	brickName: string,
	schemas: Record<string, unknown>,
): void {
	const s = spec.schema;
	if (!s) return;
	const fields = s.fields ?? [];
	const pk = s.primary_key;

	// --- Entity response schema (all fields + standard timestamps) ---
	const required: string[] = [];
	const properties: Record<string, unknown> = {};

	for (const field of fields) {
		if (!field.nullable && (field.name === pk || field.references === "auth" || field.required)) {
			required.push(field.name);
		}
		properties[field.name] = fieldToSchema(field);
	}
	required.push("created_at", "updated_at");
	properties.created_at = { type: "string", format: "date-time" };
	properties.updated_at = { type: "string", format: "date-time" };
	properties.deleted_at = { type: ["string", "null"], format: "date-time" };

	schemas[entity] = { type: "object", required, properties };

	// Only generate request schemas for REST endpoints
	if (!spec.api?.endpoints?.length || spec.api.type === "auth") return;

	// Fields eligible for create/update requests:
	//   - Exclude PK if it references auth (set from JWT) or has a default (auto-generated)
	//   - Exclude non-PK fields that reference auth (owner fields, set from JWT)
	const requestFields = fields.filter((f) => {
		if (f.name === pk) return !f.references && !f.default;
		if (f.references === "auth") return false;
		return true;
	});

	if (requestFields.length === 0) return;

	const createRequired = requestFields.filter((f) => f.required).map((f) => f.name);
	const createProperties: Record<string, unknown> = {};
	for (const field of requestFields) {
		createProperties[field.name] = fieldToSchema(field);
	}

	schemas[`Create${entity}Request`] = {
		type: "object",
		...(createRequired.length > 0 ? { required: createRequired } : {}),
		properties: createProperties,
	};

	const updateProperties: Record<string, unknown> = {};
	for (const field of requestFields) {
		updateProperties[field.name] = fieldToSchema(field);
	}
	schemas[`Update${entity}Request`] = {
		type: "object",
		minProperties: 1,
		properties: updateProperties,
	};

	// List response schema for paginated endpoints (use plural brick name: ListUsersResponse)
	if (spec.api.endpoints.some((e) => e.has_pagination)) {
		schemas[`List${toPascalCase(brickName)}Response`] = {
			type: "object",
			required: ["data", "total", "limit", "offset"],
			properties: {
				data: { type: "array", items: { $ref: `#/components/schemas/${entity}` } },
				total: { type: "integer", example: 10 },
				limit: { type: "integer", example: 20 },
				offset: { type: "integer", example: 0 },
			},
		};
	}
}

function buildAuthSchemas(spec: BrickSpec, schemas: Record<string, unknown>): void {
	for (const endpoint of spec.api?.endpoints ?? []) {
		if (!endpoint.body?.length) continue;
		const schemaName = `${capitalize(endpoint.handler)}Request`;
		const required = endpoint.body.filter((f) => f.required).map((f) => f.name);
		const properties: Record<string, unknown> = {};
		for (const field of endpoint.body) {
			properties[field.name] = fieldToSchema(field);
		}
		schemas[schemaName] = {
			type: "object",
			...(required.length > 0 ? { required } : {}),
			properties,
		};
	}
}

// ---------------------------------------------------------------------------
// Path builders
// ---------------------------------------------------------------------------

function operationSummary(handler: string, singular: string, brickName: string): string {
	switch (handler) {
		case "list":
			return `List ${brickName}`;
		case "get":
			return `Get ${article(singular)} ${singular} by ID`;
		case "create":
			return `Create ${article(singular)} ${singular}`;
		case "update":
			return `Update ${article(singular)} ${singular}`;
		case "softDelete":
		case "delete":
			return `Delete ${article(singular)} ${singular}`;
		default:
			return capitalize(handler);
	}
}

function authOperationSummary(handler: string): string {
	switch (handler) {
		case "signup":
			return "Sign up a new user";
		case "signin":
			return "Sign in with email and password";
		case "signout":
			return "Sign out the current user";
		case "me":
			return "Get the authenticated user";
		default:
			return capitalize(handler);
	}
}

function errorResponse(): Record<string, unknown> {
	return {
		description: "Validation error",
		content: {
			"application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } },
		},
	};
}

function unauthorizedResponse(): Record<string, unknown> {
	return {
		description: "Unauthorized",
		content: {
			"application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } },
		},
	};
}

function notFoundResponse(): Record<string, unknown> {
	return {
		description: "Not found",
		content: {
			"application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } },
		},
	};
}

function forbiddenResponse(): Record<string, unknown> {
	return {
		description: "Forbidden",
		content: {
			"application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } },
		},
	};
}

function buildRestOperation(
	endpoint: Endpoint,
	brickName: string,
	entity: string,
	api: NonNullable<BrickSpec["api"]>,
	schemas: Record<string, unknown>,
	access?: BrickSpec["access"],
): Record<string, unknown> {
	const singular = singularize(brickName);
	const status = endpoint.status ?? 200;
	const hasPathParam = endpoint.path.includes(":");
	const isPaginated = endpoint.has_pagination ?? false;
	const requiresAuth = api.auth_required ?? false;

	// Compute x-roles from access rules
	const rolesForEndpoint =
		access?.filter((rule) => rule.actions.includes(endpoint.handler)).map((rule) => rule.role) ??
		[];

	const operation: Record<string, unknown> = {
		tags: [brickName],
		summary: operationSummary(endpoint.handler, singular, brickName),
		...(requiresAuth ? { security: [{ bearerAuth: [] }] } : {}),
		...(rolesForEndpoint.length > 0 ? { "x-roles": rolesForEndpoint } : {}),
	};

	// Query parameters for list endpoints
	if (!hasPathParam && endpoint.method === "GET") {
		const params: unknown[] = [];
		if (api.search_field) {
			params.push({
				name: "search",
				in: "query",
				schema: { type: "string" },
				description: `Filter by ${api.search_field} (case-insensitive)`,
			});
		}
		if (isPaginated) {
			params.push(
				{
					name: "limit",
					in: "query",
					schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
				},
				{ name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 } },
			);
		}
		if (params.length > 0) operation.parameters = params;
	}

	// Request body
	if (endpoint.method === "POST" || endpoint.method === "PATCH") {
		const schemaName =
			endpoint.method === "POST" ? `Create${entity}Request` : `Update${entity}Request`;
		if (schemas[schemaName]) {
			operation.requestBody = {
				required: true,
				content: { "application/json": { schema: { $ref: `#/components/schemas/${schemaName}` } } },
			};
		}
	}

	// Responses
	const responses: Record<string, unknown> = {};

	if (status === 204) {
		responses["204"] = { description: "Deleted (no content)" };
	} else if (isPaginated) {
		responses[String(status)] = {
			description: `Paginated list of ${brickName}`,
			content: {
				"application/json": {
					schema: { $ref: `#/components/schemas/List${toPascalCase(brickName)}Response` },
				},
			},
		};
	} else {
		responses[String(status)] = {
			description: responseDescription(endpoint.handler, entity),
			content: { "application/json": { schema: { $ref: `#/components/schemas/${entity}` } } },
		};
	}

	if (endpoint.method === "POST" || endpoint.method === "PATCH") responses["400"] = errorResponse();
	if (requiresAuth) responses["401"] = unauthorizedResponse();
	if (rolesForEndpoint.length > 0) responses["403"] = forbiddenResponse();
	if (hasPathParam) responses["404"] = notFoundResponse();

	operation.responses = responses;
	return operation;
}

function responseDescription(handler: string, entity: string): string {
	switch (handler) {
		case "get":
			return `${entity} found`;
		case "create":
			return `${entity} created`;
		case "update":
			return `Updated ${entity.toLowerCase()}`;
		default:
			return "Success";
	}
}

function buildAuthOperation(
	endpoint: Endpoint,
	brickName: string,
	schemas: Record<string, unknown>,
): Record<string, unknown> {
	const requiresAuth = AUTH_REQUIRED_HANDLERS.has(endpoint.handler);

	const operation: Record<string, unknown> = {
		tags: [brickName],
		summary: authOperationSummary(endpoint.handler),
		...(requiresAuth ? { security: [{ bearerAuth: [] }] } : {}),
	};

	const schemaName = `${capitalize(endpoint.handler)}Request`;
	if (schemas[schemaName]) {
		operation.requestBody = {
			required: true,
			content: { "application/json": { schema: { $ref: `#/components/schemas/${schemaName}` } } },
		};
	}

	const responses: Record<string, unknown> = {};

	switch (endpoint.handler) {
		case "signup":
			responses["201"] = {
				description: "User created and session returned",
				content: {
					"application/json": {
						schema: {
							type: "object",
							properties: { user: { type: "object" }, session: { type: "object" } },
						},
					},
				},
			};
			responses["400"] = errorResponse();
			break;
		case "signin":
			responses["200"] = {
				description: "Session returned",
				content: {
					"application/json": {
						schema: {
							type: "object",
							properties: { user: { type: "object" }, session: { type: "object" } },
						},
					},
				},
			};
			responses["400"] = {
				description: "Invalid credentials",
				content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
			};
			break;
		case "signout":
			responses["200"] = {
				description: "Signed out",
				content: {
					"application/json": {
						schema: {
							type: "object",
							properties: { message: { type: "string", example: "Signed out" } },
						},
					},
				},
			};
			responses["401"] = unauthorizedResponse();
			break;
		case "me":
			responses["200"] = {
				description: "Current user",
				content: {
					"application/json": {
						schema: { type: "object", properties: { user: { type: "object" } } },
					},
				},
			};
			responses["401"] = unauthorizedResponse();
			break;
		default:
			responses[String(endpoint.status ?? 200)] = { description: "Success" };
	}

	operation.responses = responses;
	return operation;
}

function buildBrickPaths(
	spec: BrickSpec,
	brickName: string,
	entity: string,
	paths: Record<string, Record<string, unknown>>,
	schemas: Record<string, unknown>,
): void {
	const api = spec.api;
	if (!api) return;
	const isAuth = api.type === "auth";

	for (const endpoint of api.endpoints ?? []) {
		const oaPath = toOpenApiPath(brickName, endpoint.path);
		const method = endpoint.method.toLowerCase();
		const hasPathParam = endpoint.path.includes(":");

		if (!paths[oaPath]) {
			paths[oaPath] = {};
		}
		const pathEntry = paths[oaPath] as Record<string, unknown>;
		if (hasPathParam && !pathEntry.parameters) {
			pathEntry.parameters = [
				{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
			];
		}

		pathEntry[method] = isAuth
			? buildAuthOperation(endpoint, brickName, schemas)
			: buildRestOperation(endpoint, brickName, entity, api, schemas, spec.access);
	}
}

// ---------------------------------------------------------------------------
// Main exports
// ---------------------------------------------------------------------------

/**
 * Build the OpenAPI document object from the list of installed brick specs.
 * Used internally and by writeApiDocs to generate both YAML and embedded HTML.
 */
export function buildOpenApiDoc(installedBrickSpecs: BrickSpec[]): Record<string, unknown> {
	const schemas: Record<string, unknown> = {
		ErrorResponse: {
			type: "object",
			required: ["error"],
			properties: { error: { type: "string", example: "Unauthorized" } },
		},
	};

	const paths: Record<string, Record<string, unknown>> = {};

	for (const spec of installedBrickSpecs) {
		const brickName = spec.brick.name;
		const entity = entityName(brickName);

		if (spec.schema?.table) {
			buildEntitySchemas(spec, entity, brickName, schemas);
		}
		if (spec.api?.type === "auth") {
			buildAuthSchemas(spec, schemas);
		}
		if (spec.api?.endpoints?.length) {
			buildBrickPaths(spec, brickName, entity, paths, schemas);
		}
	}

	return {
		openapi: "3.2.0",
		info: { title: "Brickend API", version: "1.0.0" },
		servers: [
			{ url: "http://localhost:54321/functions/v1", description: "Local Supabase dev stack" },
		],
		security: [],
		components: {
			securitySchemes: {
				bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
			},
			schemas,
		},
		paths,
	};
}

/**
 * Generate an OpenAPI 3.2 YAML string from the list of installed brick specs.
 * Called after every `brickend add` and at the end of `brickend init`.
 */
export function generateOpenApiSpec(installedBrickSpecs: BrickSpec[]): string {
	return stringify(buildOpenApiDoc(installedBrickSpecs), { lineWidth: 120 });
}
