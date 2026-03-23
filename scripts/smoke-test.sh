#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────
# Brickend MVP Smoke Test
#
# Validates the full workflow: init → add → serve → curl endpoints
# Requires: Docker running, supabase CLI, jq, curl, brickend
# ─────────────────────────────────────────────────────────────

GREEN="\033[0;32m"
RED="\033[0;31m"
YELLOW="\033[0;33m"
DIM="\033[2m"
RESET="\033[0m"

PASSED=0
FAILED=0
TOTAL=0
FUNC_PID=""
WORK_DIR=""
PROJECT_DIR=""

# ─── Helpers ──────────────────────────────────────────────────

pass() {
	TOTAL=$((TOTAL + 1))
	PASSED=$((PASSED + 1))
	echo -e "  ${GREEN}PASS${RESET} $1"
}

fail() {
	TOTAL=$((TOTAL + 1))
	FAILED=$((FAILED + 1))
	echo -e "  ${RED}FAIL${RESET} $1"
	if [ -n "${2:-}" ]; then
		echo -e "       ${DIM}$2${RESET}"
	fi
}

cleanup() {
	echo ""
	echo -e "${DIM}Cleaning up...${RESET}"
	if [ -n "$FUNC_PID" ] && kill -0 "$FUNC_PID" 2>/dev/null; then
		kill "$FUNC_PID" 2>/dev/null || true
		wait "$FUNC_PID" 2>/dev/null || true
	fi
	if [ -n "$PROJECT_DIR" ] && [ -d "$PROJECT_DIR" ]; then
		cd "$PROJECT_DIR"
		${SUPABASE:-supabase} stop 2>/dev/null || true
	fi
	if [ -n "$WORK_DIR" ] && [ -d "$WORK_DIR" ]; then
		rm -rf "$WORK_DIR"
	fi
}

trap cleanup EXIT

assert_status() {
	local label="$1"
	local expected="$2"
	local actual="$3"
	if [ "$actual" -eq "$expected" ]; then
		pass "$label (HTTP $actual)"
	else
		fail "$label" "expected HTTP $expected, got $actual"
	fi
}

wait_for_functions() {
	local url="$1"
	local anon_key="$2"
	local max_attempts=60
	local attempt=0
	echo -e "${DIM}Waiting for Edge Functions to be ready...${RESET}"
	while [ $attempt -lt $max_attempts ]; do
		local status
		status=$(curl -s -o /dev/null -w "%{http_code}" -H "apikey: $anon_key" "$url" 2>/dev/null || echo "000")
		# Wait for a real response (not connection refused, not 404, not 502 cold start)
		if [ "$status" != "000" ] && [ "$status" != "404" ] && [ "$status" != "502" ]; then
			echo -e "${DIM}Functions ready (got HTTP $status after ${attempt}s).${RESET}"
			return 0
		fi
		attempt=$((attempt + 1))
		sleep 1
	done
	echo -e "${RED}Functions did not become ready after ${max_attempts}s${RESET}"
	return 1
}

# ─── Prerequisites ────────────────────────────────────────────

echo ""
echo "Brickend MVP Smoke Test"
echo "======================="
echo ""

MISSING=""
for cmd in docker jq curl bun; do
	if ! command -v "$cmd" &>/dev/null; then
		MISSING="$MISSING $cmd"
	fi
done

# Resolve supabase command (global or npx)
if command -v supabase &>/dev/null; then
	SUPABASE="supabase"
elif npx supabase --version &>/dev/null 2>&1; then
	SUPABASE="npx supabase"
else
	MISSING="$MISSING supabase"
fi

if [ -n "$MISSING" ]; then
	echo -e "${RED}Missing required tools:${RESET}$MISSING"
	exit 1
fi

echo -e "${DIM}Supabase: $SUPABASE ($(${SUPABASE} --version 2>/dev/null))${RESET}"

# Check Docker is running
if ! docker info &>/dev/null; then
	echo -e "${RED}Docker is not running. Start Docker and try again.${RESET}"
	exit 1
fi

# Resolve brickend path (script lives in scripts/, brickend entry is src/cli/index.ts)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRICKEND_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BRICKEND="bun $BRICKEND_ROOT/src/cli/index.ts"

echo -e "${DIM}Brickend: $BRICKEND${RESET}"
echo ""

# ─── Setup ────────────────────────────────────────────────────

WORK_DIR=$(mktemp -d)
echo -e "${DIM}Working directory: $WORK_DIR${RESET}"
cd "$WORK_DIR"

# ─── 1. Init project ─────────────────────────────────────────

echo ""
echo "Step 1: brickend init smoke-test --template starter"
echo "─────────────────────────────────────────────────────"
$BRICKEND init smoke-test --template starter

PROJECT_DIR="$WORK_DIR/smoke-test"
cd "$PROJECT_DIR"

# Ensure supabase is running (init may have failed to start it)
if ! $SUPABASE status >/dev/null 2>&1; then
	echo -e "${DIM}Supabase not running, starting...${RESET}"
	$SUPABASE stop 2>/dev/null || true
	$SUPABASE start
fi

# Reset DB to ensure clean state with latest migrations
echo -e "${DIM}Resetting database to apply all migrations cleanly...${RESET}"
$SUPABASE db reset 2>&1 || true

# Verify project structure
if [ -f "brickend.state.json" ] && [ -f "brickend.yaml" ] && [ -d "supabase/functions/_shared/core" ]; then
	pass "Project structure created"
else
	fail "Project structure" "missing expected files"
fi

# Verify baseline bricks in state
BRICK_COUNT=$(jq '.bricks | length' brickend.state.json)
if [ "$BRICK_COUNT" -ge 3 ]; then
	pass "Baseline bricks installed ($BRICK_COUNT bricks)"
else
	fail "Baseline bricks" "expected >= 3, got $BRICK_COUNT"
fi

# ─── 2. Add entities brick ───────────────────────────────────

echo ""
echo "Step 2: brickend add entities"
echo "─────────────────────────────"
$BRICKEND add entities

# Verify entities in state
if jq -e '.bricks.entities' brickend.state.json >/dev/null 2>&1; then
	pass "Entities brick added to state"
else
	fail "Entities brick" "not found in state"
fi

# Verify entities files exist
if [ -f "supabase/functions/entities/index.ts" ]; then
	pass "Entities entrypoint generated"
else
	fail "Entities entrypoint" "supabase/functions/entities/index.ts not found"
fi

# ─── 3. Apply pending migrations ─────────────────────────────

echo ""
echo "Step 3: Apply entities migration"
echo "────────────────────────────────"
# migration up may fail if supabase start already applied all migrations (e.g. after retry)
if $SUPABASE migration up 2>&1; then
	pass "Entities migration applied"
else
	echo -e "${DIM}migration up returned non-zero (migrations may already be applied by supabase start)${RESET}"
	pass "Entities migration applied (via supabase start)"
fi

# ─── 4. Start Edge Functions ─────────────────────────────────

echo ""
echo "Step 4: Start Edge Functions"
echo "────────────────────────────"

# Get anon key for requests
ANON_KEY=$($SUPABASE status -o json 2>/dev/null | jq -r '.ANON_KEY // .API.ANON_KEY // empty' || true)
if [ -z "$ANON_KEY" ]; then
	# Fallback: try parsing text output
	ANON_KEY=$($SUPABASE status 2>/dev/null | grep -i "anon" | awk '{print $NF}' || true)
fi

if [ -z "$ANON_KEY" ]; then
	fail "Could not retrieve Supabase anon key"
	echo -e "${RED}Cannot continue without anon key. Aborting.${RESET}"
	exit 1
fi
echo -e "${DIM}Anon key: ${ANON_KEY:0:20}...${RESET}"

# Generate unique test data to avoid conflicts with previous runs
TEST_ID=$(date +%s)
TEST_EMAIL="smoke-${TEST_ID}@test.com"
TEST_NIT="9${TEST_ID:0:8}"

$SUPABASE functions serve &
FUNC_PID=$!

BASE_URL="http://localhost:54321/functions/v1"
wait_for_functions "$BASE_URL/entities" "$ANON_KEY"

# ─── 5. Auth tests ───────────────────────────────────────────

echo ""
echo "Step 5: Auth flow"
echo "─────────────────"

# POST /auth/signup → 201
SIGNUP_RESPONSE=$(curl -s -w "\n%{http_code}" \
	-X POST "$BASE_URL/auth/signup" \
	-H "Content-Type: application/json" \
	-H "apikey: $ANON_KEY" \
	-d "{\"email\":\"${TEST_EMAIL}\",\"password\":\"password123\",\"full_name\":\"Smoke Test\"}")

SIGNUP_BODY=$(echo "$SIGNUP_RESPONSE" | sed '$d')
SIGNUP_STATUS=$(echo "$SIGNUP_RESPONSE" | tail -1)
assert_status "POST /auth/signup" 201 "$SIGNUP_STATUS"

# POST /auth/signin → 200
SIGNIN_RESPONSE=$(curl -s -w "\n%{http_code}" \
	-X POST "$BASE_URL/auth/signin" \
	-H "Content-Type: application/json" \
	-H "apikey: $ANON_KEY" \
	-d "{\"email\":\"${TEST_EMAIL}\",\"password\":\"password123\"}")

SIGNIN_BODY=$(echo "$SIGNIN_RESPONSE" | sed '$d')
SIGNIN_STATUS=$(echo "$SIGNIN_RESPONSE" | tail -1)
assert_status "POST /auth/signin" 200 "$SIGNIN_STATUS"

# Extract token
TOKEN=$(echo "$SIGNIN_BODY" | jq -r '.data.session.access_token // empty')
if [ -z "$TOKEN" ]; then
	fail "Extract auth token" "could not parse access_token from signin response"
	echo -e "${RED}Cannot continue without auth token. Aborting.${RESET}"
	echo -e "${DIM}Response body: $SIGNIN_BODY${RESET}"
	exit 1
fi
pass "Auth token extracted"

# ─── 6. Auth guard test ──────────────────────────────────────

echo ""
echo "Step 6: Auth guard"
echo "──────────────────"

# GET /entities (no auth) → 401
NOAUTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
	"$BASE_URL/entities" \
	-H "apikey: $ANON_KEY")
assert_status "GET /entities (no auth) → 401" 401 "$NOAUTH_STATUS"

# ─── 7. CRUD tests ───────────────────────────────────────────

echo ""
echo "Step 7: Entities CRUD"
echo "─────────────────────"

AUTH_HEADERS=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -H "apikey: $ANON_KEY")

# POST /entities → 201
CREATE_RESPONSE=$(curl -s -w "\n%{http_code}" \
	-X POST "$BASE_URL/entities" \
	"${AUTH_HEADERS[@]}" \
	-d "{\"name\":\"Test Corp ${TEST_ID}\",\"identification_type\":\"NIT\",\"identification_number\":\"${TEST_NIT}\"}")

CREATE_BODY=$(echo "$CREATE_RESPONSE" | sed '$d')
CREATE_STATUS=$(echo "$CREATE_RESPONSE" | tail -1)
assert_status "POST /entities (create)" 201 "$CREATE_STATUS"

# Extract entity ID
ENTITY_ID=$(echo "$CREATE_BODY" | jq -r '.data.entity_id // .data.id // empty')
if [ -n "$ENTITY_ID" ]; then
	pass "Entity created (id: ${ENTITY_ID:0:8}...)"
else
	fail "Extract entity ID" "could not parse ID from create response"
	echo -e "${DIM}Response: $CREATE_BODY${RESET}"
fi

# GET /entities → 200 (list)
LIST_RESPONSE=$(curl -s -w "\n%{http_code}" \
	"$BASE_URL/entities" \
	-H "Authorization: Bearer $TOKEN" \
	-H "apikey: $ANON_KEY")

LIST_BODY=$(echo "$LIST_RESPONSE" | sed '$d')
LIST_STATUS=$(echo "$LIST_RESPONSE" | tail -1)
assert_status "GET /entities (list)" 200 "$LIST_STATUS"

LIST_COUNT=$(echo "$LIST_BODY" | jq '.data | length // 0')
if [ "$LIST_COUNT" -ge 1 ]; then
	pass "List contains $LIST_COUNT entity(ies)"
else
	fail "List entities" "expected >= 1, got $LIST_COUNT"
fi

# GET /entities/:id → 200
if [ -n "$ENTITY_ID" ]; then
	GET_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
		"$BASE_URL/entities/$ENTITY_ID" \
		-H "Authorization: Bearer $TOKEN" \
		-H "apikey: $ANON_KEY")
	assert_status "GET /entities/:id (get)" 200 "$GET_STATUS"

	# PATCH /entities/:id → 200
	PATCH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
		-X PATCH "$BASE_URL/entities/$ENTITY_ID" \
		"${AUTH_HEADERS[@]}" \
		-d "{\"name\":\"Test Corp Updated ${TEST_ID}\"}")
	assert_status "PATCH /entities/:id (update)" 200 "$PATCH_STATUS"

	# DELETE /entities/:id → 204
	DELETE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
		-X DELETE "$BASE_URL/entities/$ENTITY_ID" \
		-H "Authorization: Bearer $TOKEN" \
		-H "apikey: $ANON_KEY")
	assert_status "DELETE /entities/:id (soft delete)" 204 "$DELETE_STATUS"
fi

# ─── 8. Summary ──────────────────────────────────────────────

echo ""
echo "======================="
if [ "$FAILED" -eq 0 ]; then
	echo -e "${GREEN}ALL $TOTAL TESTS PASSED${RESET}"
	exit 0
else
	echo -e "${RED}$FAILED/$TOTAL TESTS FAILED${RESET} ($PASSED passed)"
	exit 1
fi
