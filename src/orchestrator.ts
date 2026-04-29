import { AgentConfig, RunSummary, NormalisedMetrics } from './types.js';
import { Credentials } from './config-loader.js';
import { McpTransportConfig } from './mcp-client.js';
import { SonarQubeCollector } from './sonarqube-collector.js';
import { JiraCollector } from './jira-collector.js';
import { normalise, NormaliserStatus } from './normaliser.js';
import { ReportGenerator } from './report-generator.js';
import { EXIT_CODES } from './constants.js';
import logger from './utils/logger.js';

export interface OrchestratorOptions {
  config: AgentConfig;
  credentials: Credentials;
  signal: AbortSignal;
}

function buildSonarTransport(config: AgentConfig, credentials: Credentials): McpTransportConfig {
  const serverUrl = config.sonarqube?.serverUrl ?? '';
  // stdio:// or empty = local MCP server process
  if (serverUrl.startsWith('stdio://') || serverUrl === '') {
    const command = process.env['SONARQUBE_MCP_COMMAND'] ?? 'npx';
    const args = command === 'npx'
      ? ['-y', 'sonarqube-mcp-server@1.10.21']
      : undefined;
    const hostUrl = process.env['SONAR_HOST_URL'] ?? 'https://sonarcloud.io';
    const env: Record<string, string> = { SONAR_HOST_URL: hostUrl };
    if (credentials.sonarqubeToken) {
      env['SONARQUBE_TOKEN'] = credentials.sonarqubeToken;
      env['SONAR_TOKEN'] = credentials.sonarqubeToken;
    }
    return { type: 'stdio', command, args, env };
  }
  // HTTPS endpoint (SonarCloud native MCP or self-hosted SSE)
  const headers: Record<string, string> = {};
  if (credentials.sonarqubeToken) {
    headers['Authorization'] = `Bearer ${credentials.sonarqubeToken}`;
  }
  // SonarCloud native MCP requires the org key
  const org = process.env['SONARQUBE_ORG'];
  if (org) headers['SONARQUBE_ORG'] = org;
  headers['SONARQUBE_READ_ONLY'] = 'true';
  // SonarCloud native endpoint uses streamable HTTP (MCP 2025-03-26)
  const transportType = serverUrl.includes('api.sonarcloud.io') ? 'http' : 'sse';
  return { type: transportType, url: serverUrl, headers };
}

function buildJiraTransport(config: AgentConfig, credentials: Credentials): McpTransportConfig {
  const serverUrl = config.jira?.serverUrl ?? 'https://mcp.atlassian.com/v1/sse';
  return {
    type: 'sse',
    url: serverUrl,
    headers: credentials.jiraToken ? { Authorization: `Bearer ${credentials.jiraToken}` } : undefined,
  };
}

export class Orchestrator {
  async run(options: OrchestratorOptions): Promise<RunSummary> {
    const { config, credentials, signal } = options;
    const startedAt = new Date().toISOString();
    const startMs = Date.now();

    const reportsDir = config.output?.reportsDir ?? 'quality-metrics/reports';
    const reportGen = new ReportGenerator(reportsDir, startedAt);

    const metricsRetrieved: RunSummary['metricsRetrieved'] = [];
    const allNormalised: NormalisedMetrics[] = [];
    let teamsAttempted = 0;
    let teamsSucceeded = 0;
    let teamsFailed = 0;

    for (const team of config.teams) {
      teamsAttempted++;

      // Checkpoint 1: before collection
      if (signal.aborted) {
        logger.info(`[Orchestrator] Aborted before collecting team "${team.name}". Discarding.`);
        break;
      }

      let sonarResult = null;
      let jiraResult = null;

      // Parallel collection
      const [sonarCollectionResult, jiraCollectionResult] = await Promise.all([
        config.sonarqube && team.sonarqubeProjectKey
          ? new SonarQubeCollector(buildSonarTransport(config, credentials), signal).collect(team, credentials)
          : Promise.resolve(null),
        config.jira && team.jiraProjectKey
          ? new JiraCollector(buildJiraTransport(config, credentials), signal).collect(team, credentials)
          : Promise.resolve(null),
      ]);

      // Checkpoint 2: after collection, before normalisation
      if (signal.aborted) {
        logger.info(`[Orchestrator] Aborted after collecting team "${team.name}". Discarding.`);
        break;
      }

      const sonarOk = sonarCollectionResult?.ok ?? null;
      const jiraOk = jiraCollectionResult?.ok ?? null;

      if (sonarCollectionResult?.ok) sonarResult = sonarCollectionResult.data;
      if (jiraCollectionResult?.ok) jiraResult = jiraCollectionResult.data;

      const status: NormaliserStatus = {
        sonarqube: config.sonarqube
          ? (sonarOk === true ? 'retrieved' : 'failed')
          : 'not_configured',
        jira: config.jira
          ? (jiraOk === true ? 'retrieved' : 'failed')
          : 'not_configured',
      };

      const retrievedAt = {
        sonarqube: sonarCollectionResult?.retrievedAt ?? null,
        jira: jiraCollectionResult?.retrievedAt ?? null,
      };

      const sonarError = sonarCollectionResult?.ok === false ? sonarCollectionResult.error : undefined;
      const jiraError = jiraCollectionResult?.ok === false ? jiraCollectionResult.error : undefined;

      const normalised = normalise(
        sonarResult,
        jiraResult,
        team.name,
        config.department.name,
        retrievedAt,
        status,
        sonarError,
        jiraError
      );

      // Checkpoint 3: after normalisation, before writing
      if (signal.aborted) {
        logger.info(`[Orchestrator] Aborted after normalising team "${team.name}". Discarding.`);
        break;
      }

      await reportGen.writeTeamReport(normalised);
      allNormalised.push(normalised);

      const teamSucceeded = (sonarOk !== false) && (jiraOk !== false);
      if (teamSucceeded) teamsSucceeded++;
      else teamsFailed++;

      metricsRetrieved.push({
        team: team.name,
        sonarqube: sonarOk === true,
        jira: jiraOk === true,
      });
    }

    // Write summary report if we have any results
    if (allNormalised.length > 0) {
      await reportGen.writeSummaryReport(allNormalised);
    }

    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - startMs;

    // Determine exit code
    let exitCode: 0 | 1 | 2 | 3;
    if (teamsAttempted === 0) {
      exitCode = EXIT_CODES.CONFIG_ERROR;
    } else if (teamsFailed === 0) {
      exitCode = EXIT_CODES.SUCCESS;
    } else if (teamsSucceeded > 0) {
      exitCode = EXIT_CODES.PARTIAL_FAILURE;
    } else {
      exitCode = EXIT_CODES.TOTAL_FAILURE;
    }

    const summary: RunSummary = {
      startedAt,
      completedAt,
      durationMs,
      teamsAttempted,
      teamsSucceeded,
      teamsFailed,
      metricsRetrieved,
      exitCode,
    };

    // Print run summary to stdout
    logger.info('\n--- Run Summary ---');
    logger.info(`Teams attempted: ${teamsAttempted}`);
    logger.info(`Teams succeeded: ${teamsSucceeded}`);
    logger.info(`Teams failed:    ${teamsFailed}`);
    logger.info(`Duration:        ${durationMs}ms`);
    logger.info(`Exit code:       ${exitCode}`);
    for (const m of metricsRetrieved) {
      const sq = m.sonarqube ? '✅' : (config.sonarqube ? '❌' : '—');
      const jira = m.jira ? '✅' : (config.jira ? '❌' : '—');
      logger.info(`  ${m.team}: SonarQube=${sq} Jira=${jira}`);
    }
    logger.info('-------------------\n');

    return summary;
  }
}
