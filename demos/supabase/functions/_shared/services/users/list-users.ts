import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { mapDbError } from "../../core/errors.ts";
import type { ListUsersParams } from "../../schemas/user.ts";

export async function listUsers(supabase: SupabaseClient, params: ListUsersParams) {
	let query = supabase
		.from("user_profiles")
		.select("*", { count: "exact" })
		.is("deleted_at", null)
		.range(params.offset, params.offset + params.limit - 1);

	if (params.search) {
		query = query.textSearch("full_name", params.search, {
			type: "plain",
			config: "simple",
		});
	}

	const { data, error, count } = await query;
	if (error) throw mapDbError(error);
	return { items: data ?? [], total: count ?? 0 };
}
