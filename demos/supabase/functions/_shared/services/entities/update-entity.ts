import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { mapDbError, NotFoundError } from "../../core/errors.ts";
import type { UpdateEntityInput } from "../../schemas/entity.ts";
import { ENTITY_UPDATE_ERRORS } from "./const-entities.ts";

export async function updateEntity(supabase: SupabaseClient, id: string, input: UpdateEntityInput) {
	const { data, error } = await supabase
		.from("entities")
		.update(input)
		.eq("id", id)
		.is("deleted_at", null)
		.select()
		.single();
	if (error) throw mapDbError(error, ENTITY_UPDATE_ERRORS);
	if (!data) throw new NotFoundError("Entity not found");
	return data;
}
