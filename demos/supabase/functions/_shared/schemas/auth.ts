import { z } from "npm:zod@4";

export const signUpSchema = z.object({
	email: z.string().email(),
	password: z.string().min(6),
	full_name: z.string().min(1),
});

export const signInSchema = z.object({
	email: z.string().email(),
	password: z.string().min(1),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
