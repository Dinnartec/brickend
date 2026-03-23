import { verifyAuth } from "../_shared/core/auth.ts";
import { handleCors } from "../_shared/core/cors.ts";
import { ValidationError } from "../_shared/core/errors.ts";
import { created, fromError, noContent, success } from "../_shared/core/responses.ts";
import { createSupabaseClient } from "../_shared/core/supabase.ts";
import {
	createEntitySchema,
	listEntitiesParamsSchema,
	updateEntitySchema,
} from "../_shared/schemas/entity.ts";
import * as entitiesService from "../_shared/services/entities/index.ts";

Deno.serve(async (req: Request) => {
	const corsResponse = handleCors(req);
	if (corsResponse) return corsResponse;

	const url = new URL(req.url);
	const path = url.pathname.replace(/^\/entities/, "") || "/";
	const idMatch = path.match(/^\/([0-9a-f-]{36})$/);
	const id = idMatch?.[1];

	try {
		const supabase = createSupabaseClient(req);
		const user = await verifyAuth(req);

		// GET /entities — list
		if (req.method === "GET" && !id) {
			const rawParams = Object.fromEntries(url.searchParams);
			const parsed = listEntitiesParamsSchema.safeParse(rawParams);
			if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
			const result = await entitiesService.listEntities(supabase, parsed.data);
			return success(result);
		}

		// GET /entities/:id
		if (req.method === "GET" && id) {
			const entity = await entitiesService.getEntity(supabase, id);
			return success(entity);
		}

		// POST /entities
		if (req.method === "POST" && !id) {
			const body = await req.json();
			const parsed = createEntitySchema.safeParse(body);
			if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
			const entity = await entitiesService.createEntity(supabase, user.id, parsed.data);
			return created(entity);
		}

		// PATCH /entities/:id
		if (req.method === "PATCH" && id) {
			const body = await req.json();
			const parsed = updateEntitySchema.safeParse(body);
			if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
			const entity = await entitiesService.updateEntity(supabase, id, parsed.data);
			return success(entity);
		}

		// DELETE /entities/:id
		if (req.method === "DELETE" && id) {
			await entitiesService.deleteEntity(supabase, id);
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
