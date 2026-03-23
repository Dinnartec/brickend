import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { mapDbError, NotFoundError } from "../../core/errors.ts";
import type { UpdateUserInput } from "../../schemas/user.ts";
import { USER_UPDATE_ERRORS } from "./const-users.ts";

export async function updateUser(supabase: SupabaseClient, id: string, input: UpdateUserInput) {
	const { data, error } = await supabase
		.from("user_profiles")
		.update(input)
		.eq("id", id)
		.is("deleted_at", null)
		.select()
		.single();
	if (error) throw mapDbError(error, USER_UPDATE_ERRORS);
	if (!data) throw new NotFoundError("User not found");
	return data;
}
