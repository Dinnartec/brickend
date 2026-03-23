import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { mapDbError } from "../../core/errors.ts";
import type { CreateEntityInput } from "../../schemas/entity.ts";
import { ENTITY_CREATE_ERRORS } from "./const-entities.ts";

export async function createEntity(
	supabase: SupabaseClient,
	ownerId: string,
	input: CreateEntityInput,
) {
	const { data, error } = await supabase
		.from("entities")
		.insert({ owner_id: ownerId, ...input })
		.select()
		.single();
	if (error) throw mapDbError(error, ENTITY_CREATE_ERRORS);
	return data;
}
