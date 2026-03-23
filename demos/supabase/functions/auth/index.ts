import { verifyAuth } from "../_shared/core/auth.ts";
import { handleCors } from "../_shared/core/cors.ts";
import { ValidationError } from "../_shared/core/errors.ts";
import { created, fromError, success } from "../_shared/core/responses.ts";
import { createServiceClient, createSupabaseClient } from "../_shared/core/supabase.ts";
import { signInSchema, signUpSchema } from "../_shared/schemas/auth.ts";
import { createUser } from "../_shared/services/users/index.ts";

Deno.serve(async (req: Request) => {
	const corsResponse = handleCors(req);
	if (corsResponse) return corsResponse;

	const url = new URL(req.url);
	const path = url.pathname.replace(/^\/auth/, "");

	try {
		// POST /auth/signup
		if (req.method === "POST" && path === "/signup") {
			const body = await req.json();
			const parsed = signUpSchema.safeParse(body);
			if (!parsed.success) {
				throw new ValidationError(parsed.error.issues[0].message);
			}
			const { email, password, full_name } = parsed.data;

			const service = createServiceClient();
			const { data, error } = await service.auth.admin.createUser({
				email,
				password,
				email_confirm: true,
			});
			if (error) throw new ValidationError(error.message);

			await createUser(service, { id: data.user.id, full_name, email });

			// Sign in to get the session token
			const supabase = createSupabaseClient(req);
			const { data: session, error: signInError } = await supabase.auth.signInWithPassword({
				email,
				password,
			});
			if (signInError) throw new ValidationError(signInError.message);

			return created({ user: data.user, session: session.session });
		}

		// POST /auth/signin
		if (req.method === "POST" && path === "/signin") {
			const body = await req.json();
			const parsed = signInSchema.safeParse(body);
			if (!parsed.success) {
				throw new ValidationError(parsed.error.issues[0].message);
			}

			const supabase = createSupabaseClient(req);
			const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
			if (error) throw new ValidationError(error.message);

			return success({ user: data.user, session: data.session });
		}

		// POST /auth/signout
		if (req.method === "POST" && path === "/signout") {
			await verifyAuth(req);
			const supabase = createSupabaseClient(req);
			const { error } = await supabase.auth.signOut();
			if (error) throw error;
			return success({ message: "Signed out" });
		}

		// GET /auth/me
		if (req.method === "GET" && path === "/me") {
			const user = await verifyAuth(req);
			return success({ user });
		}

		return new Response(JSON.stringify({ error: "Not found" }), {
			status: 404,
			headers: { "Content-Type": "application/json" },
		});
	} catch (err) {
		return fromError(err);
	}
});
