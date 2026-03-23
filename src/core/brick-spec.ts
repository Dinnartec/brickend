import { z } from "zod";

export const BrickConfigFieldSchema = z.object({
	description: z.string(),
	type: z.string(),
	default: z.unknown().optional(),
});

export const FieldDefSchema = z.object({
	name: z.string(),
	type: z.enum(["string", "text", "email", "uuid", "boolean", "numeric", "url"]),
	required: z.boolean().optional(),
	nullable: z.boolean().optional(),
	references: z.string().optional(),
	default: z.string().optional(),
});

export const IndexDefSchema = z.object({
	name: z.string(),
	columns: z.array(z.string()),
	type: z.enum(["gin", "unique", "btree"]).optional(),
	expression: z.string().optional(),
	where: z.string().optional(),
});

export const AccessRuleSchema = z.object({
	role: z.string(),
	actions: z.array(z.string()),
	own_only: z.boolean().optional().default(false),
});

export const ConstraintMapSchema = z.record(z.object({ type: z.string(), message: z.string() }));

export const SchemaSectionSchema = z.object({
	db_schema: z.string().optional().default("public"),
	table: z.string().optional(),
	primary_key: z.string().optional(),
	workspace_scoped: z.boolean().optional(),
	fields: z.array(FieldDefSchema).optional().default([]),
	indexes: z.array(IndexDefSchema).optional().default([]),
	constraints: z
		.object({
			create: ConstraintMapSchema.optional().default({}),
			update: ConstraintMapSchema.optional().default({}),
		})
		.optional()
		.default({}),
});

export const EndpointSchema = z.object({
	method: z.enum(["GET", "POST", "PATCH", "DELETE"]),
	path: z.string(),
	handler: z.string(),
	status: z.number().optional(),
	has_pagination: z.boolean().optional(),
	body: z.array(FieldDefSchema).optional(),
});

export const ApiSectionSchema = z.object({
	type: z.enum(["rest", "auth"]).optional().default("rest"),
	auth_required: z.boolean().optional().default(false),
	search_field: z.string().optional(),
	endpoints: z.array(EndpointSchema).optional().default([]),
});

export const BrickDepSchema = z.object({ brick: z.string(), version: z.string() });

export const BrickSpecSchema = z.object({
	brick: z.object({
		name: z.string(),
		version: z.string(),
		description: z.string(),
		type: z.enum(["brick", "extension"]).optional().default("brick"),
	}),
	requires: z.array(BrickDepSchema).optional().default([]),
	extensions: z.array(BrickDepSchema).optional().default([]),
	config: z.record(BrickConfigFieldSchema).optional().default({}),
	schema: SchemaSectionSchema.optional(),
	api: ApiSectionSchema.optional(),
	access: z.array(AccessRuleSchema).optional().default([]),
});

export type BrickSpec = z.infer<typeof BrickSpecSchema>;
export type BrickConfigField = z.infer<typeof BrickConfigFieldSchema>;
export type FieldDef = z.infer<typeof FieldDefSchema>;
export type SchemaSection = z.infer<typeof SchemaSectionSchema>;
export type ApiSection = z.infer<typeof ApiSectionSchema>;
export type Endpoint = z.infer<typeof EndpointSchema>;
export type AccessRule = z.infer<typeof AccessRuleSchema>;
