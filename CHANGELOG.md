# Changelog

Notable changes by version. 

---

## [Unreleased]

### Security
- Pinned `sonarqube-mcp-server` to `1.10.21` — removes supply chain risk from `@latest` runtime pulls
- Added `SECURITY.md` with responsible disclosure process and token hygiene guidance
- Added Dependabot config for automated weekly dependency and Actions version updates
- Upgraded `@typescript-eslint` to v8 — resolves 6 high severity `minimatch` ReDoS vulnerabilities

### Added
- Teams failure notification now includes the last 30 lines of scan output and a direct link to the workflow run — no more hunting through logs
- `npm run validate-config` — checks your credentials and project keys are valid before you run a scan
- `config.example.json` moved to the repo root so it's easier to find
- Bug report issue template
- Branch protection recommendations documented in `CONTRIBUTING.md`
- Read-only token requirement documented in `README.md`
- This changelog

---

## [0.1.0] — 2026-04-24

First working release.

### Added
- Full pipeline: read config → collect from SonarQube/Jira → normalise → write reports
- SonarQube and SonarCloud support via MCP (both stdio and HTTPS transports)
- Jira / Atlassian Rovo support via SSE MCP
- Per-team and summary Markdown reports with threshold flagging
- Interactive setup script (`npm run setup`)
- CI workflow — build, lint, test on every push and PR
- Scheduled scan every Friday at 11:00 UTC
- Teams notification with full report content on success
- GitHub template setup with `config.example.json`, `.env.example`, and `CONTRIBUTING.md`
