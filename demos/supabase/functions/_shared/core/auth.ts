import type { User } from "npm:@supabase/supabase-js@2";
import { UnauthorizedError } from "./errors.ts";
import { createSupabaseClient } from "./supabase.ts";

export async function verifyAuth(req: Request): Promise<User> {
	const supabase = createSupabaseClient(req);
	const {
		data: { user },
		error,
	} = await supabase.auth.getUser();
	if (error || !user) throw new UnauthorizedError();
	return user;
}
