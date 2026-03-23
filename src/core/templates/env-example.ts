export function envExampleTemplate(): string {
	return `# Supabase environment variables
# These are auto-injected by Supabase Edge Functions at runtime.
# For local development, run \`supabase start\` — they are set automatically.

# SUPABASE_URL=http://localhost:54321
# SUPABASE_ANON_KEY=your-anon-key
# SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
`;
}
