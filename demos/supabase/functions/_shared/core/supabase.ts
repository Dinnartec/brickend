import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** Client scoped to the requesting user — RLS policies apply. */
export function createSupabaseClient(req: Request) {
	const token = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
	return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
		global: { headers: { Authorization: `Bearer ${token}` } },
		auth: { persistSession: false },
	});
}

/** Service-role client — bypasses RLS. Use only for privileged operations. */
export function createServiceClient() {
	return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
		auth: { persistSession: false },
	});
}
