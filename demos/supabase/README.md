# Brickend Demo — Supabase Edge Functions

Reference implementation of a Brickend backend: three Edge Functions (`auth`, `users`, `entities`) using the `_shared` architecture pattern.

## Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli) installed
- Docker running

## Setup

```bash
# Start the local Supabase stack
npm run start

# Apply migrations (creates tables, RLS policies, triggers)
npm run db:reset

# Serve Edge Functions locally
npm run functions:serve
```

Or use the one-shot dev command:

```bash
npm run start:clean
```

## Local variables

After `npm run start`, get your keys:

```bash
npm run status
```

Copy `API URL`, `anon key`, and `service_role key` from the output. Export them:

```bash
export SUPABASE_URL="http://localhost:54421"
export ANON_KEY="<anon key from status>"
export SERVICE_KEY="<service_role key from status>"
```

---

## Endpoints

All protected routes require `Authorization: Bearer $TOKEN`.

### auth

> **Note:** `signup` and `signin` do not require an `Authorization` header.
> All other endpoints require `Authorization: Bearer $TOKEN` (session JWT from sign-in).

#### Sign up

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/auth/signup" \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"secret123","full_name":"Jane Doe"}' | jq
```

#### Sign in

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/auth/signin" \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"secret123"}' | jq

# Save the token
export TOKEN="<session.access_token from response>"
```

#### Get current user

```bash
curl -s "$SUPABASE_URL/functions/v1/auth/me" \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### Sign out

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/auth/signout" \
  -H "Authorization: Bearer $TOKEN" | jq
```

---

### users

#### List users

```bash
curl -s "$SUPABASE_URL/functions/v1/users" \
  -H "Authorization: Bearer $TOKEN" | jq

# With search and pagination
curl -s "$SUPABASE_URL/functions/v1/users?search=jane&limit=10&offset=0" \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### Get user by ID

```bash
export USER_ID="<uuid>"
curl -s "$SUPABASE_URL/functions/v1/users/$USER_ID" \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### Update user

```bash
curl -s -X PATCH "$SUPABASE_URL/functions/v1/users/$USER_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"full_name":"Jane Smith"}' | jq
```

#### Delete user (soft delete)

```bash
curl -s -X DELETE "$SUPABASE_URL/functions/v1/users/$USER_ID" \
  -H "Authorization: Bearer $TOKEN" -w "\nHTTP %{http_code}\n"
```

---

### entities

#### Create entity

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/entities" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Acme Corp","identification_type":"NIT","identification_number":"900123456-1"}' | jq

# Save the entity ID
export ENTITY_ID="<id from response>"
```

#### List entities

```bash
curl -s "$SUPABASE_URL/functions/v1/entities" \
  -H "Authorization: Bearer $TOKEN" | jq

# With text search
curl -s "$SUPABASE_URL/functions/v1/entities?search=acme&limit=20&offset=0" \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### Get entity by ID

```bash
curl -s "$SUPABASE_URL/functions/v1/entities/$ENTITY_ID" \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### Update entity

```bash
curl -s -X PATCH "$SUPABASE_URL/functions/v1/entities/$ENTITY_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Acme Corporation"}' | jq
```

#### Delete entity (soft delete)

```bash
curl -s -X DELETE "$SUPABASE_URL/functions/v1/entities/$ENTITY_ID" \
  -H "Authorization: Bearer $TOKEN" -w "\nHTTP %{http_code}\n"
```

---

## Soft delete behavior

Records are never hard-deleted. A `DELETE` sets `deleted_at` and subsequent `GET` returns 404:

```bash
# Delete
curl -s -X DELETE "$SUPABASE_URL/functions/v1/entities/$ENTITY_ID" \
  -H "Authorization: Bearer $TOKEN" -w "\nHTTP %{http_code}\n"
# -> HTTP 204

# Fetch deleted record
curl -s "$SUPABASE_URL/functions/v1/entities/$ENTITY_ID" \
  -H "Authorization: Bearer $TOKEN" -w "\nHTTP %{http_code}\n"
# -> HTTP 404
```

---

## API reference

See [`openapi.yaml`](./openapi.yaml) for the full OpenAPI 3.2 specification.

To preview with Swagger UI:

```bash
bunx @redocly/cli preview-docs openapi.yaml
```
