# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability in Brickend, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

### How to report

Email **security@dinnartec.com** with:

- Description of the vulnerability
- Steps to reproduce
- Impact assessment (what can an attacker do?)
- Suggested fix (if you have one)

### What to expect

- **Acknowledgment** within 48 hours
- **Assessment** within 7 days
- **Fix or mitigation** as soon as possible, depending on severity
- **Credit** in the release notes (unless you prefer anonymity)

### Scope

The following are in scope:

- Brickend CLI (`brickend` command)
- MCP server (`brickend-mcp`)
- Generated code (Edge Functions, RLS policies, RBAC)
- Brick spec validation and linting
- State file handling (`brickend.state.json`)

The following are out of scope:

- Supabase platform vulnerabilities (report to [Supabase](https://supabase.com/.well-known/security.txt))
- Third-party dependencies (report to the respective maintainers)
- Issues in user-modified generated code

## Security Considerations

### Generated Code

Brickend generates RLS policies, RBAC rules, and authentication middleware. While we test these patterns, **you are responsible for reviewing the generated security configuration** before deploying to production.

### State File

`brickend.state.json` does not contain secrets. It tracks installed bricks, versions, and file paths. It is safe to commit to version control.

### Environment Variables

Generated projects use Supabase environment variables (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`). These are injected by the Supabase Edge Functions runtime and should never be committed to version control.
