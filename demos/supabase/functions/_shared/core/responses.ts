import { corsHeaders } from "./cors.ts";
import { AppError, mapDbError } from "./errors.ts";

function json(body: unknown, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { ...corsHeaders, "Content-Type": "application/json" },
	});
}

export function success(data: unknown): Response {
	return json({ data }, 200);
}

export function created(data: unknown): Response {
	return json({ data }, 201);
}

export function noContent(): Response {
	return new Response(null, { status: 204, headers: corsHeaders });
}

export function notFound(message = "Not found"): Response {
	return json({ error: message }, 404);
}

export function unauthorized(message = "Unauthorized"): Response {
	return json({ error: message }, 401);
}

export function badRequest(message = "Bad request"): Response {
	return json({ error: message }, 400);
}

export function conflict(message = "Conflict"): Response {
	return json({ error: message }, 409);
}

export function serverError(message = "Internal server error"): Response {
	return json({ error: message }, 500);
}

export function fromError(err: unknown): Response {
	const mapped = mapDbError(err); // safety net — no constraint map, generic fallbacks only
	if (mapped instanceof AppError) {
		return json({ error: mapped.message }, mapped.statusCode);
	}
	console.error(err);
	return serverError();
}
