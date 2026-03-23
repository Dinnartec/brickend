import { z } from "zod";

const RoleSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	is_default: z.boolean().optional(),
});

export const TemplateBrickRefSchema = z.object({
	brick: z.string(),
	version: z.string(),
	config: z.record(z.unknown()).optional().default({}),
});

export const TemplateSpecSchema = z.object({
	template: z.object({
		name: z.string(),
		version: z.string(),
		description: z.string(),
	}),
	settings: z.record(z.unknown()).optional().default({}),
	roles: z.array(RoleSchema),
	baseline: z.array(TemplateBrickRefSchema),
	bricks: z.array(TemplateBrickRefSchema).optional().default([]),
});

export type TemplateSpec = z.infer<typeof TemplateSpecSchema>;
export type TemplateBrickRef = z.infer<typeof TemplateBrickRefSchema>;
