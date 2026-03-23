import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { mapDbError } from "../../core/errors.ts";
import type { ListEntitiesParams } from "../../schemas/entity.ts";

export async function listEntities(supabase: SupabaseClient, params: ListEntitiesParams) {
	let query = supabase
		.from("entities")
		.select("*", { count: "exact" })
		.is("deleted_at", null)
		.range(params.offset, params.offset + params.limit - 1);

	if (params.search) {
		query = query.textSearch("name", params.search, {
			type: "plain",
			config: "simple",
		});
	}

	const { data, error, count } = await query;
	if (error) throw mapDbError(error);
	return { items: data ?? [], total: count ?? 0 };
}
