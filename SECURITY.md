# Security Policy

## Reporting a vulnerability

If you find a security issue in this codebase — including credential handling, token exposure, dependency vulnerabilities, or anything that could affect teams using this tool — please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, use GitHub's private vulnerability reporting:

1. Go to the **Security** tab of this repository
2. Click **Report a vulnerability**
3. Fill in the details — what you found, how to reproduce it, and the potential impact

You'll receive a response as soon as possible. If the issue is confirmed, a fix will be prioritised and a patched version released before any public disclosure.

## Scope

This tool handles:
- SonarQube / SonarCloud API tokens (read-only)
- Jira / Atlassian OAuth tokens (read-only)
- Microsoft Teams incoming webhook URLs

All credentials are handled via environment variables and GitHub Secrets — never committed to the repository. If you find a path where credentials could be exposed (logs, reports, error messages, network traffic), that is in scope.

## Token hygiene

Teams using this tool should:
- Use **read-only** tokens scoped to the minimum required permissions
- Rotate tokens regularly
- Revoke and rotate immediately if a token is accidentally exposed
- Never commit `.env` or `config.json` to their repository

## Dependency security

Dependencies are monitored via Dependabot. The MCP server version used at runtime is pinned — see `src/orchestrator.ts`. If a new version of `sonarqube-mcp-server` contains a security fix, update the pinned version and open a PR.
