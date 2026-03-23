import { verifyAuth } from "../_shared/core/auth.ts";
import { handleCors } from "../_shared/core/cors.ts";
import { ValidationError } from "../_shared/core/errors.ts";
import { created, fromError, noContent, success } from "../_shared/core/responses.ts";
import { createSupabaseClient } from "../_shared/core/supabase.ts";
import {
	createUserSchema,
	listUsersParamsSchema,
	updateUserSchema,
} from "../_shared/schemas/user.ts";
import * as usersService from "../_shared/services/users/index.ts";

Deno.serve(async (req: Request) => {
	const corsResponse = handleCors(req);
	if (corsResponse) return corsResponse;

	const url = new URL(req.url);
	// Strip leading /users prefix if present
	const path = url.pathname.replace(/^\/users/, "") || "/";
	const idMatch = path.match(/^\/([0-9a-f-]{36})$/);
	const id = idMatch?.[1];

	try {
		const supabase = createSupabaseClient(req);
		await verifyAuth(req);

		// GET /users — list
		if (req.method === "GET" && !id) {
			const rawParams = Object.fromEntries(url.searchParams);
			const parsed = listUsersParamsSchema.safeParse(rawParams);
			if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
			const result = await usersService.listUsers(supabase, parsed.data);
			return success(result);
		}

		// GET /users/:id
		if (req.method === "GET" && id) {
			const user = await usersService.getUser(supabase, id);
			return success(user);
		}

		// POST /users
		if (req.method === "POST" && !id) {
			const body = await req.json();
			const parsed = createUserSchema.safeParse(body);
			if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
			// Note: POST /users is for internal use; auth signup creates profiles.
			// Here we just insert into user_profiles (id must come from auth).
			const user = await usersService.createUser(supabase, {
				id: body.id,
				...parsed.data,
			});
			return created(user);
		}

		// PATCH /users/:id
		if (req.method === "PATCH" && id) {
			const body = await req.json();
			const parsed = updateUserSchema.safeParse(body);
			if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
			const user = await usersService.updateUser(supabase, id, parsed.data);
			return success(user);
		}

		// DELETE /users/:id
		if (req.method === "DELETE" && id) {
			await usersService.deleteUser(supabase, id);
			return noContent();
		}

		return new Response(JSON.stringify({ error: "Not found" }), {
			status: 404,
			headers: { "Content-Type": "application/json" },
		});
	} catch (err) {
		return fromError(err);
	}
});
