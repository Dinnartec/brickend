import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { NotFoundError } from "../../core/errors.ts";

export async function getEntity(supabase: SupabaseClient, id: string) {
	const { data, error } = await supabase
		.from("entities")
		.select()
		.eq("id", id)
		.is("deleted_at", null)
		.single();
	if (error || !data) throw new NotFoundError("Entity not found");
	return data;
}
