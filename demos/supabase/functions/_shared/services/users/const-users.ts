import { ConflictError, ValidationError } from "../../core/errors.ts";

export const USER_CREATE_ERRORS = {
	user_profiles_pkey: new ConflictError("A user profile with this ID already exists"),
	user_profiles_identification_type_fkey: new ValidationError("Invalid identification type"),
};

export const USER_UPDATE_ERRORS = {
	user_profiles_identification_type_fkey: new ValidationError("Invalid identification type"),
};
