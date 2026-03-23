import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { mapDbError } from "../../core/errors.ts";

export async function deleteUser(supabase: SupabaseClient, id: string) {
	const { error } = await supabase
		.from("user_profiles")
		.update({ deleted_at: new Date().toISOString() })
		.eq("id", id)
		.is("deleted_at", null);
	if (error) throw mapDbError(error);
}
