import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { mapDbError } from "../../core/errors.ts";
import type { CreateUserInput } from "../../schemas/user.ts";
import { USER_CREATE_ERRORS } from "./const-users.ts";

export async function createUser(
	supabase: SupabaseClient,
	input: CreateUserInput & { id: string },
) {
	const { data, error } = await supabase
		.from("user_profiles")
		.insert({
			id: input.id,
			full_name: input.full_name,
			email: input.email,
			identification_type: input.identification_type,
			identification_number: input.identification_number,
		})
		.select()
		.single();
	if (error) throw mapDbError(error, USER_CREATE_ERRORS);
	return data;
}
