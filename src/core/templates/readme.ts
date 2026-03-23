export function readmeTemplate(projectName: string, installedBricks: string[]): string {
	const hasUsers = installedBricks.includes("users");
	const hasEntities = installedBricks.includes("entities");
	const hasSoftDelete = hasUsers || hasEntities;

	const sections: string[] = [];

	sections.push(`# ${projectName}

A Supabase Edge Functions backend scaffolded with [Brickend](https://github.com/brickend/brickend).

## Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli) installed
- Docker running

## Setup

\`\`\`bash
# Serve Edge Functions locally (brickend init already ran supabase start + migrations)
supabase functions serve

# If you need to reset to a clean state later:
# supabase db reset
\`\`\`

## Local variables

After \`supabase start\`, get your keys:

\`\`\`bash
supabase status
\`\`\`

Copy \`API URL\`, \`anon key\`, and \`service_role key\` from the output. Export them:

\`\`\`bash
export SUPABASE_URL="http://localhost:54321"
export SUPABASE_ANON_KEY="<anon key from status>"
export SUPABASE_SERVICE_ROLE_KEY="<service_role key from status>"
\`\`\`

---

## Endpoints

All protected routes require \`Authorization: Bearer $TOKEN\`.`);

	// auth section (always present)
	sections.push(`### auth

> **Note:** \`signup\` and \`signin\` do not require an \`Authorization\` header.
> All other endpoints require \`Authorization: Bearer $TOKEN\` (session JWT from sign-in).

#### Sign up

\`\`\`bash
curl -s -X POST "$SUPABASE_URL/functions/v1/auth/signup" \\
  -H "Content-Type: application/json" \\
  -d '{"email":"user@example.com","password":"secret123","full_name":"Jane Doe"}' | jq
\`\`\`

#### Sign in

\`\`\`bash
curl -s -X POST "$SUPABASE_URL/functions/v1/auth/signin" \\
  -H "Content-Type: application/json" \\
  -d '{"email":"user@example.com","password":"secret123"}' | jq

# Save the token
export TOKEN="<session.access_token from response>"
\`\`\`

#### Get current user

\`\`\`bash
curl -s "$SUPABASE_URL/functions/v1/auth/me" \\
  -H "Authorization: Bearer $TOKEN" | jq
\`\`\`

#### Sign out

\`\`\`bash
curl -s -X POST "$SUPABASE_URL/functions/v1/auth/signout" \\
  -H "Authorization: Bearer $TOKEN" | jq
\`\`\`

---`);

	// users section (always present — baseline brick)
	if (hasUsers) {
		sections.push(`### users

#### List users

\`\`\`bash
curl -s "$SUPABASE_URL/functions/v1/users" \\
  -H "Authorization: Bearer $TOKEN" | jq

# With search and pagination
curl -s "$SUPABASE_URL/functions/v1/users?search=jane&limit=10&offset=0" \\
  -H "Authorization: Bearer $TOKEN" | jq
\`\`\`

#### Get user by ID

\`\`\`bash
export USER_ID="<uuid>"
curl -s "$SUPABASE_URL/functions/v1/users/$USER_ID" \\
  -H "Authorization: Bearer $TOKEN" | jq
\`\`\`

#### Update user

\`\`\`bash
curl -s -X PATCH "$SUPABASE_URL/functions/v1/users/$USER_ID" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"full_name":"Jane Smith"}' | jq
\`\`\`

#### Delete user (soft delete)

\`\`\`bash
curl -s -X DELETE "$SUPABASE_URL/functions/v1/users/$USER_ID" \\
  -H "Authorization: Bearer $TOKEN" -w "\\nHTTP %{http_code}\\n"
\`\`\`

---`);
	}

	// entities section (only if installed)
	if (hasEntities) {
		sections.push(`### entities

#### Create entity

\`\`\`bash
curl -s -X POST "$SUPABASE_URL/functions/v1/entities" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Acme Corp","identification_type":"NIT","identification_number":"900123456-1"}' | jq

# Save the entity ID
export ENTITY_ID="<id from response>"
\`\`\`

#### List entities

\`\`\`bash
curl -s "$SUPABASE_URL/functions/v1/entities" \\
  -H "Authorization: Bearer $TOKEN" | jq

# With text search
curl -s "$SUPABASE_URL/functions/v1/entities?search=acme&limit=20&offset=0" \\
  -H "Authorization: Bearer $TOKEN" | jq
\`\`\`

#### Get entity by ID

\`\`\`bash
curl -s "$SUPABASE_URL/functions/v1/entities/$ENTITY_ID" \\
  -H "Authorization: Bearer $TOKEN" | jq
\`\`\`

#### Update entity

\`\`\`bash
curl -s -X PATCH "$SUPABASE_URL/functions/v1/entities/$ENTITY_ID" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Acme Corporation"}' | jq
\`\`\`

#### Delete entity (soft delete)

\`\`\`bash
curl -s -X DELETE "$SUPABASE_URL/functions/v1/entities/$ENTITY_ID" \\
  -H "Authorization: Bearer $TOKEN" -w "\\nHTTP %{http_code}\\n"
\`\`\`

---`);
	}

	// Soft delete section
	if (hasSoftDelete) {
		sections.push(`## Soft delete behavior

Records are never hard-deleted. A \`DELETE\` sets \`deleted_at\` and subsequent \`GET\` returns 404:

\`\`\`bash
# Delete
curl -s -X DELETE "$SUPABASE_URL/functions/v1/entities/$ENTITY_ID" \\
  -H "Authorization: Bearer $TOKEN" -w "\\nHTTP %{http_code}\\n"
# -> HTTP 204

# Fetch deleted record
curl -s "$SUPABASE_URL/functions/v1/entities/$ENTITY_ID" \\
  -H "Authorization: Bearer $TOKEN" -w "\\nHTTP %{http_code}\\n"
# -> HTTP 404
\`\`\`

---`);
	}

	sections.push(`## Interactive API docs

An OpenAPI 3.2 spec and a Scalar viewer are auto-generated every time you run \`brickend add\`:

\`\`\`
openapi.yaml        ← machine-readable spec (import into Postman, Bruno, Insomnia…)
docs/index.html     ← Scalar interactive viewer (try requests right from the browser)
\`\`\`

### Open the Scalar viewer

1. Start the local stack (if not already running):

\`\`\`bash
supabase start
supabase functions serve
\`\`\`

2. Open \`docs/index.html\` in your browser:

\`\`\`bash
open docs/index.html          # macOS
xdg-open docs/index.html      # Linux
start docs/index.html         # Windows
\`\`\`

Scalar loads the spec from \`../openapi.yaml\` and lets you fill in request bodies and hit **"Send"** against \`http://localhost:54321/functions/v1\`.

> **Tip:** use the **"Set global bearer token"** field in Scalar (top-right) after signing in so every protected endpoint is pre-authorized.

### Import into a REST client

\`\`\`bash
# Postman / Bruno / Insomnia: import openapi.yaml directly from the UI
# Or validate the spec:
bunx @redocly/cli lint openapi.yaml
\`\`\``);

	// --- Deploy to Production ---
	sections.push(`## Deploy to Production

### 1. Create a Supabase project

Go to [supabase.com/dashboard](https://supabase.com/dashboard) and create a new project. Copy the **project ref** from the URL: \`https://supabase.com/dashboard/project/<ref>\`.

### 2. Link your project (one-time)

\`\`\`bash
supabase link --project-ref <your-project-ref>
\`\`\`

### 3. Deploy

\`\`\`bash
# Use the deploy script (recommended)
bash scripts/deploy.sh

# Or preview changes first
bash scripts/deploy.sh --dry-run
\`\`\`

The deploy script will:
- Push pending migrations to the production database
- Deploy all Edge Functions (${installedBricks.join(", ")})
- Set secrets from \`.env\` if present

### Manual deployment

\`\`\`bash
# Push migrations
supabase db push

# Deploy functions
${installedBricks.map((b) => `supabase functions deploy ${b}`).join("\n")}

# Set production secrets
supabase secrets set \\
  SUPABASE_URL=https://<ref>.supabase.co \\
  SUPABASE_ANON_KEY=<your-anon-key> \\
  SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
\`\`\``);

	return sections.join("\n\n");
}
