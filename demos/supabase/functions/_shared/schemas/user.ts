import { z } from "npm:zod@4";

export const userSchema = z.object({
	id: z.string().uuid(),
	full_name: z.string(),
	email: z.string().email(),
	identification_type: z.string().nullable(),
	identification_number: z.string().nullable(),
	created_at: z.string(),
	updated_at: z.string(),
	deleted_at: z.string().nullable(),
});

export const createUserSchema = z.object({
	full_name: z.string().min(1),
	email: z.string().email(),
	identification_type: z.string().min(1).optional(),
	identification_number: z.string().min(1).optional(),
});

export const updateUserSchema = z
	.object({
		full_name: z.string().min(1).optional(),
		email: z.string().email().optional(),
		identification_type: z.string().min(1).optional(),
		identification_number: z.string().min(1).optional(),
	})
	.refine((d) => Object.keys(d).length > 0, {
		message: "At least one field must be provided",
	});

export const listUsersParamsSchema = z.object({
	search: z.string().optional(),
	limit: z.coerce.number().int().min(1).max(100).default(20),
	offset: z.coerce.number().int().min(0).default(0),
});

export type User = z.infer<typeof userSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ListUsersParams = z.infer<typeof listUsersParamsSchema>;
