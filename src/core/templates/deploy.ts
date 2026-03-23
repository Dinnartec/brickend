export function deployScriptTemplate(projectName: string): string {
	return `#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────
# Deploy ${projectName} to Supabase Production
#
# Usage:
#   bash scripts/deploy.sh                  # Full deploy
#   bash scripts/deploy.sh --dry-run        # Preview without executing
#   bash scripts/deploy.sh --skip-migrations
#   bash scripts/deploy.sh --skip-secrets
# ─────────────────────────────────────────────────────────────

GREEN="\\033[0;32m"
RED="\\033[0;31m"
YELLOW="\\033[0;33m"
DIM="\\033[2m"
RESET="\\033[0m"

DRY_RUN=false
SKIP_MIGRATIONS=false
SKIP_SECRETS=false

for arg in "$@"; do
  case $arg in
    --dry-run) DRY_RUN=true ;;
    --skip-migrations) SKIP_MIGRATIONS=true ;;
    --skip-secrets) SKIP_SECRETS=true ;;
    *) echo -e "\${RED}Unknown flag: $arg\${RESET}"; exit 1 ;;
  esac
done

run_cmd() {
  if [ "$DRY_RUN" = true ]; then
    echo -e "\${DIM}[dry-run] $*\${RESET}"
  else
    "$@"
  fi
}

# ─── Prerequisites ────────────────────────────────────────────

echo ""
echo "Deploy ${projectName}"
echo "====================="
echo ""

if ! command -v supabase &>/dev/null && ! command -v npx &>/dev/null; then
  echo -e "\${RED}Supabase CLI not found. Install with: npm install -g supabase\${RESET}"
  exit 1
fi

# Resolve supabase command
if command -v supabase &>/dev/null; then
  SUPABASE="supabase"
else
  SUPABASE="npx supabase"
fi

if ! command -v jq &>/dev/null; then
  echo -e "\${RED}jq not found. Install with: apt install jq / brew install jq\${RESET}"
  exit 1
fi

# Check project is linked
if ! $SUPABASE status >/dev/null 2>&1; then
  echo -e "\${RED}Project not linked. Run first:\${RESET}"
  echo -e "  supabase link --project-ref <your-project-ref>"
  echo ""
  echo -e "\${DIM}Find your project ref in the Supabase dashboard URL:\${RESET}"
  echo -e "\${DIM}  https://supabase.com/dashboard/project/<ref>\${RESET}"
  exit 1
fi

if [ ! -f "brickend.state.json" ]; then
  echo -e "\${RED}brickend.state.json not found. Are you in a Brickend project?\${RESET}"
  exit 1
fi

echo -e "\${DIM}Supabase: $SUPABASE\${RESET}"
if [ "$DRY_RUN" = true ]; then
  echo -e "\${YELLOW}DRY RUN — no changes will be made\${RESET}"
fi
echo ""

# ─── Step 1: Push migrations ─────────────────────────────────

if [ "$SKIP_MIGRATIONS" = false ]; then
  echo "Step 1: Push migrations"
  echo "───────────────────────"

  if [ "$DRY_RUN" = false ]; then
    echo -e "\${YELLOW}This will apply pending migrations to the production database.\${RESET}"
    read -r -p "Continue? [y/N] " confirm
    if [[ ! "$confirm" =~ ^[yY]$ ]]; then
      echo "Skipping migrations."
      echo ""
    else
      $SUPABASE db push
      echo -e "\${GREEN}Migrations pushed.\${RESET}"
      echo ""
    fi
  else
    run_cmd supabase db push
    echo ""
  fi
else
  echo -e "\${DIM}Skipping migrations (--skip-migrations)\${RESET}"
  echo ""
fi

# ─── Step 2: Deploy Edge Functions ────────────────────────────

echo "Step 2: Deploy Edge Functions"
echo "─────────────────────────────"

# Discover functions from brickend.state.json
FUNCTIONS=$(jq -r '.bricks | to_entries[] | select(.value.files[] | test("supabase/functions/.+/index\\\\.ts")) | .key' brickend.state.json 2>/dev/null | sort -u)

if [ -z "$FUNCTIONS" ]; then
  echo -e "\${YELLOW}No Edge Functions found in state.\${RESET}"
else
  # Detect functions with verify_jwt = false
  NO_JWT_FUNCTIONS=""
  if [ -f "supabase/config.toml" ]; then
    NO_JWT_FUNCTIONS=$(grep -B1 'verify_jwt.*=.*false' supabase/config.toml 2>/dev/null | grep -oP '(?<=\\[functions\\.)[a-z_-]+(?=\\])' || true)
  fi

  for fn in $FUNCTIONS; do
    if echo "$NO_JWT_FUNCTIONS" | grep -qw "$fn" 2>/dev/null; then
      echo -e "  Deploying \${GREEN}$fn\${RESET} (no JWT verification)"
      run_cmd $SUPABASE functions deploy "$fn" --no-verify-jwt
    else
      echo -e "  Deploying \${GREEN}$fn\${RESET}"
      run_cmd $SUPABASE functions deploy "$fn"
    fi
  done
  echo ""
  echo -e "\${GREEN}All functions deployed.\${RESET}"
  echo ""
fi

# ─── Step 3: Set secrets ─────────────────────────────────────

if [ "$SKIP_SECRETS" = false ]; then
  echo "Step 3: Set secrets"
  echo "───────────────────"

  if [ -f ".env" ]; then
    echo -e "\${DIM}Reading secrets from .env\${RESET}"
    SECRETS=""
    while IFS='=' read -r key value; do
      # Skip comments and empty lines
      [[ -z "$key" || "$key" =~ ^# ]] && continue
      # Remove surrounding quotes
      value="\${value%\\"}"
      value="\${value#\\"}"
      value="\${value%\\'}"
      value="\${value#\\'}"
      SECRETS="$SECRETS $key=$value"
    done < .env

    if [ -n "$SECRETS" ]; then
      run_cmd $SUPABASE secrets set $SECRETS
      echo -e "\${GREEN}Secrets set from .env\${RESET}"
    else
      echo -e "\${DIM}No secrets found in .env\${RESET}"
    fi
  else
    echo -e "\${YELLOW}No .env file found. Set secrets manually:\${RESET}"
    echo -e "\${DIM}  supabase secrets set SUPABASE_URL=https://<ref>.supabase.co \\\\\${RESET}"
    echo -e "\${DIM}    SUPABASE_ANON_KEY=<your-anon-key> \\\\\${RESET}"
    echo -e "\${DIM}    SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>\${RESET}"
  fi
  echo ""
else
  echo -e "\${DIM}Skipping secrets (--skip-secrets)\${RESET}"
  echo ""
fi

# ─── Done ─────────────────────────────────────────────────────

echo "====================="
if [ "$DRY_RUN" = true ]; then
  echo -e "\${YELLOW}Dry run complete. No changes were made.\${RESET}"
else
  echo -e "\${GREEN}Deploy complete!\${RESET}"
fi
`;
}
