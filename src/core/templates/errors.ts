export function errorsTemplate(): string {
	return `export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(404, message);
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation failed") {
    super(400, message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(403, message);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict") {
    super(409, message);
  }
}

export type DbConstraintMap = Record<string, AppError>;

const PG_UNIQUE_VIOLATION = "23505";
const PG_FK_VIOLATION     = "23503";
const PG_NOT_NULL         = "23502";

function extractConstraint(message: string): string | null {
  const match = message.match(/constraint "([^"]+)"/);
  return match ? match[1] : null;
}

export function mapDbError(err: unknown, constraintMap?: DbConstraintMap): unknown {
  if (err instanceof AppError) return err;

  const e       = err as Record<string, unknown>;
  const code    = typeof e?.code    === "string" ? e.code    : null;
  const message = typeof e?.message === "string" ? e.message : "";

  if (constraintMap) {
    const constraint = extractConstraint(message);
    if (constraint && constraintMap[constraint]) {
      return constraintMap[constraint];
    }
  }

  if (code === PG_UNIQUE_VIOLATION) {
    return new ConflictError("A record with these values already exists");
  }
  if (code === PG_FK_VIOLATION) {
    return new ValidationError("Invalid reference: the provided value does not exist");
  }
  if (code === PG_NOT_NULL) {
    return new ValidationError("A required field is missing");
  }

  return err;
}
`;
}
