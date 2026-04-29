# metrics-workflow

A CLI tool that pulls code quality and delivery metrics from SonarQube and Jira, and turns them into clean Markdown reports your team can actually read.

## What it does

- Connects to **SonarQube / SonarCloud** and **Jira** to collect metrics automatically
- Covers code quality: bugs, vulnerabilities, coverage, duplication, technical debt, quality gate status
- Covers delivery: open issues by priority, tickets closed in the last 30 days, sprint velocity
- Writes per-team and summary reports to `quality-metrics/reports/`
- Highlights anything that needs attention — failed quality gates, low coverage, unreviewed hotspots

## Quick start

```bash
npm install
npm run setup            # walks you through creating config.json and .env
npm run build            # compile TypeScript
npm run validate-config  # checks your credentials and project keys are correct
npm run scan             # run it
```

Reports land in `quality-metrics/reports/metrics-scan-<timestamp>/`.

## Usage

```bash
# Scan all teams in your config
node dist/index.js --config path/to/config.json

# Scan a single team
node dist/index.js --config path/to/config.json --team your-team-name
```

## Configuration

Copy the example and fill it in:

```bash
cp config.example.json config.json
```

> Don't commit `config.json` — it contains project keys and server URLs. It's gitignored by default.

**SonarCloud** (most common):
```json
{
  "sonarqube": { "serverUrl": "https://api.sonarcloud.io/mcp" },
  "department": { "name": "Engineering" },
  "teams": [
    {
      "name": "your-team-name",
      "sonarqubeProjectKey": "your-org_your-project"
    }
  ],
  "output": {
    "reportsDir": "quality-metrics/reports"
  }
}
```

**Self-hosted SonarQube + Jira**:
```json
{
  "sonarqube": { "serverUrl": "https://sonarqube.yourorg.com/mcp" },
  "jira": { "serverUrl": "https://mcp.atlassian.com/v1/sse" },
  "department": { "name": "Engineering" },
  "teams": [
    {
      "name": "your-team-name",
      "sonarqubeProjectKey": "com.example:my-service",
      "jiraProjectKey": "MYPROJ"
    }
  ],
  "output": {
    "reportsDir": "quality-metrics/reports"
  }
}
```

Credentials go in `.env` — never in `config.json`:

```bash
SONARQUBE_TOKEN=your-read-only-token
SONARQUBE_ORG=your-org-key        # SonarCloud only
JIRA_TOKEN=your-oauth-token       # only if using Jira
```

> Tokens must be **read-only**. For SonarCloud, create a user token at Account → Security. For Jira, use an OAuth token with read-only project scope. The tool never writes to either service — a read-only token limits the blast radius if a token is ever compromised.

Copy `.env.example` to `.env` to see all available variables.

For full MCP transport configuration (self-hosted SonarQube, custom endpoints), see `src/docs/mcp-server-setup.md`.

### Where to find each value

**`SONARQUBE_TOKEN`** — required, must come from SonarCloud/SonarQube (not customisable)
1. Log in to [sonarcloud.io](https://sonarcloud.io)
2. Click your avatar → **My Account** → **Security**
3. Under **Generate Tokens**, give it a name and click **Generate**
4. Copy the token immediately — you won't see it again
- Format: `sqp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

**`SONARQUBE_ORG`** — required for SonarCloud, must match your org key exactly (not customisable)
1. Log in to [sonarcloud.io](https://sonarcloud.io)
2. Click your avatar → **My Organizations**
3. Your org key is shown under the org name, or visible in the URL: `sonarcloud.io/organizations/your-org-key`
- Format: `my-org-name` (lowercase, hyphens)

**`sonarqubeProjectKey`** — required, must match the key in SonarCloud exactly (not customisable)
1. Log in to [sonarcloud.io](https://sonarcloud.io)
2. Open your project
3. Click **Project Settings** (bottom left) → **Project Information**
4. The key is shown under **Project Key**
- SonarCloud format: `org-key_repository-name` e.g. `myorg_my-repo`
- Self-hosted SonarQube format: `group:artifact` e.g. `com.example:my-service`

> These three values are fixed — they are assigned by SonarCloud/SonarQube and must be copied exactly. If any of them are wrong the scan will fail with a 401, 403, or 404 error.

**`JIRA_TOKEN`** — required if using Jira, must come from Atlassian (not customisable)
1. Log in to [id.atlassian.com](https://id.atlassian.com/manage-profile/security)
2. Under **API tokens**, click **Create API token**
3. Give it a label and copy the token
- Format: `ATATxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

**`jiraProjectKey`** — required if using Jira, must match the key in Jira exactly (not customisable)
1. Open your Jira project
2. The key is shown in the URL: `yourorg.atlassian.net/jira/software/projects/KEY/boards`
3. Or visible next to the project name in the project list
- Format: 2–10 uppercase letters e.g. `MYPROJ`

## Scripts

```bash
npm run setup            # interactive config and .env setup
npm run validate-config  # verify credentials and project keys before scanning
npm run scan             # run the scan
npm run build            # compile TypeScript
npm test                 # run tests
npm run lint             # ESLint
npm run validate         # build + test together
```

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Everything worked |
| 1 | Some teams failed, others succeeded |
| 2 | All teams failed |
| 3 | Config error |

## Using this with your team

This repo is a GitHub template — teams get a clean copy with no commit history:

1. Click **"Use this template"** on GitHub
2. **Make the new repo private** — it will run with your credentials and project keys
3. Clone it and follow the Quick start above
4. Add GitHub secrets and the scheduled scan runs every Friday automatically

### GitHub Actions

Two workflows ship out of the box:

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `ci.yml` | Every push and PR to `main` | Build, lint, test |
| `scheduled-scan.yml` | Fridays at 11:00 UTC + manual trigger | Run the scan, upload reports as artifacts |

Scan reports are kept as artifacts for 90 days.

#### Secrets to configure

Add these in **Settings → Secrets and variables → Actions**:

| Secret | What it's for |
|--------|---------------|
| `SONARQUBE_TOKEN` | Read-only SonarCloud or SonarQube token |
| `SONARQUBE_ORG` | Your org key (SonarCloud only) |
| `JIRA_TOKEN` | Atlassian OAuth token (only needed if you're using Jira) |
| `METRICS_CONFIG` | The full contents of your `config.json` |
| `TEAMS_WEBHOOK_URL` | Your Teams incoming webhook URL (optional) |

Putting `config.json` in a secret means project keys never touch the repo.

#### Teams notifications

If you set `TEAMS_WEBHOOK_URL`, the scan posts to your channel automatically:

- ✅ **Scan passed** — the full report is posted directly in the message
- ❌ **Scan failed** — the last 30 lines of log output are included so you can see what went wrong, plus a link straight to the workflow run

**Setting up the webhook:**

1. Open the Teams channel you want to post to
2. Click **...** next to the channel name → **Manage channel** → **Settings** → **Connectors** → **Edit**
3. Find **Incoming Webhook**, click **Add** → **Add**
4. Give it a name (e.g. `Metrics Agent`) and click **Create**
5. Copy the URL — you won't see it again

Then add it as the `TEAMS_WEBHOOK_URL` secret in GitHub. That's it.

If you don't set the secret, the notification steps are skipped and everything else still works fine.

#### Running a scan manually

Go to **Actions → Scheduled Metrics Scan → Run workflow** any time you don't want to wait for Friday.

## Project status

| Phase | Status |
|-------|--------|
| Phase 1 — Core pipeline (config → collect → normalise → report) | ✅ Complete |
| Phase 2 — Governance (audit logging, credential verification) | 🔲 Planned |
| Phase 3 — Hardening (extended test coverage, integration tests) | 🔲 Planned |

## Security

Credentials are never committed — all tokens are handled via environment variables and GitHub Secrets. The MCP server version used at runtime is pinned to prevent supply chain risk from `@latest` pulls.

To report a vulnerability, use GitHub's private vulnerability reporting — see [SECURITY.md](SECURITY.md). Do not open a public issue.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to get set up, the branching model, and what we look for in PRs.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for what's changed between versions.
