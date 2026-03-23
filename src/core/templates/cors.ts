export function corsTemplate(multiTenant = false): string {
	const headers = multiTenant
		? `"Authorization, Content-Type, apikey, x-client-info, X-Workspace-Id"`
		: `"Authorization, Content-Type, apikey, x-client-info"`;

	return `export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    ${headers},
};

export function handleCors(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  return null;
}
`;
}
