import { ConflictError, ValidationError } from "../../core/errors.ts";

export const ENTITY_CREATE_ERRORS = {
	entities_owner_identification_unique_idx: new ConflictError(
		"An entity with this identification type and number already exists",
	),
	entities_identification_type_fkey: new ValidationError("Invalid identification type"),
};

export const ENTITY_UPDATE_ERRORS = {
	entities_owner_identification_unique_idx: new ConflictError(
		"An entity with this identification type and number already exists",
	),
	entities_identification_type_fkey: new ValidationError("Invalid identification type"),
};
