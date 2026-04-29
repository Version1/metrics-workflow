# MCP Server Setup Guide

This document describes how to configure the SonarQube and Jira MCP servers for use with the Dev Metrics Agent.

---

## SonarQube MCP Server

The SonarQube MCP server is provided by SonarSource and runs as a local process (stdio transport).

### Read-only configuration

Rather than verifying token permissions at runtime, enforce read-only access at the MCP server level using the `SONARQUBE_TOOLSETS` environment variable:

```bash
SONARQUBE_TOOLSETS=readonly
```

This restricts the available tools to read-only operations (e.g. `get_component_measures`, `get_quality_gate_status`, `search_sonar_issues_in_projects`) and excludes write tools such as `change_sonar_issue_status`.

### Transport

The SonarQube MCP server uses **stdio transport**. Configure it in your MCP client settings:

```json
{
  "mcpServers": {
    "sonarqube": {
      "command": "npx",
      "args": ["-y", "@sonarsource/sonarqube-mcp-server@latest"],
      "env": {
        "SONAR_TOKEN": "<your-read-only-token>",
        "SONAR_HOST_URL": "https://sonarqube.yourorg.com",
        "SONARQUBE_TOOLSETS": "readonly"
      }
    }
  }
}
```

Set `SONARQUBE_TOKEN` in your environment (not in `config.json`):

```bash
export SONARQUBE_TOKEN=<your-read-only-token>
```

---

## Jira / Atlassian Rovo MCP Server

The Atlassian Rovo MCP server is a remote endpoint at `mcp.atlassian.com` using **HTTPS/SSE transport**.

### Read-only configuration

Scope the OAuth grant or API token to read-only permissions at the Atlassian level. The required OAuth scopes for read-only access are:

- `read:jira-work` — read issues, sprints, and project data
- `read:jira-user` — read project membership (used for project key validation only)

Do **not** grant:
- `write:jira-work`
- `manage:jira-project`
- `manage:jira-configuration`

### Transport

The Jira MCP server uses **HTTPS/SSE transport**. Configure it in your MCP client settings:

```json
{
  "mcpServers": {
    "jira": {
      "url": "https://mcp.atlassian.com/v1/sse",
      "headers": {
        "Authorization": "Bearer <your-oauth-token>"
      }
    }
  }
}
```

Set `JIRA_TOKEN` in your environment (not in `config.json`):

```bash
export JIRA_TOKEN=<your-oauth-token>
```

---

## Transport heterogeneity

| Source | Transport | Endpoint |
|--------|-----------|----------|
| SonarQube | stdio (local process) | `npx @sonarsource/sonarqube-mcp-server` |
| Jira (Atlassian Rovo) | HTTPS/SSE (remote) | `https://mcp.atlassian.com/v1/sse` |

The `McpClientSession` in `src/mcp-client.ts` handles both transport types transparently via the `McpTransportConfig` union type.

---

## Adding a new MCP source

See `CONTRIBUTING.md` for instructions on adding additional MCP data sources.
