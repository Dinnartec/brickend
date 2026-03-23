import { z } from "npm:zod@4";

export const identificationTypeSchema = z.string().min(1);

export const entitySchema = z.object({
	id: z.string().uuid(),
	owner_id: z.string().uuid(),
	name: z.string(),
	identification_type: identificationTypeSchema,
	identification_number: z.string(),
	created_at: z.string(),
	updated_at: z.string(),
	deleted_at: z.string().nullable(),
});

export const createEntitySchema = z.object({
	name: z.string().min(1),
	identification_type: identificationTypeSchema,
	identification_number: z.string().min(1),
});

export const updateEntitySchema = z
	.object({
		name: z.string().min(1).optional(),
		identification_type: identificationTypeSchema.optional(),
		identification_number: z.string().min(1).optional(),
	})
	.refine((d) => Object.keys(d).length > 0, {
		message: "At least one field must be provided",
	});

export const listEntitiesParamsSchema = z.object({
	search: z.string().optional(),
	limit: z.coerce.number().int().min(1).max(100).default(20),
	offset: z.coerce.number().int().min(0).default(0),
});

export type Entity = z.infer<typeof entitySchema>;
export type CreateEntityInput = z.infer<typeof createEntitySchema>;
export type UpdateEntityInput = z.infer<typeof updateEntitySchema>;
export type ListEntitiesParams = z.infer<typeof listEntitiesParamsSchema>;
