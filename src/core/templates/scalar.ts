/**
 * Returns the Scalar interactive API viewer HTML with the OpenAPI spec embedded
 * as JSON inline. This avoids browser fetch restrictions when opened via file://.
 */
export function scalarHtmlTemplate(specJson: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>API Docs</title>
</head>
<body>
  <script id="api-reference" type="application/json">${specJson}</script>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>
`;
}
