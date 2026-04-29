import { McpClientSession, McpTransportConfig } from './mcp-client.js';
import { Credentials } from './config-loader.js';
import { TeamConfig, JiraRaw, CollectionResult, CollectionError } from './types.js';
import {
  MCP_TIMEOUT_MS,
  RATE_LIMIT_INITIAL_DELAY_MS,
  RATE_LIMIT_MAX_DELAY_MS,
  RATE_LIMIT_MAX_ATTEMPTS,
} from './constants.js';

/**
 * Jira/Atlassian Rovo MCP server transport note:
 * The Atlassian Rovo MCP server runs at mcp.atlassian.com using HTTPS/SSE transport.
 * Configure via McpTransportConfig with type:'sse' and the OAuth token in headers:
 *   { type: 'sse', url: 'https://mcp.atlassian.com/v1/sse', headers: { Authorization: `Bearer ${token}` } }
 * See src/docs/mcp-server-setup.md for full setup instructions.
 */

function sanitiseMessage(msg: string): string {
  return msg
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/token[=:\s]+\S+/gi, 'token=[REDACTED]')
    .replace(/Authorization[:\s]+\S+/gi, 'Authorization: [REDACTED]');
}

function classifyError(err: unknown): CollectionError['type'] {
  const msg = String(err instanceof Error ? err.message : err).toLowerCase();
  if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('forbidden')) return 'auth';
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests')) return 'rate_limited';
  if (msg.includes('404') || msg.includes('not found') || msg.includes('does not exist')) return 'not_found';
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('econnaborted')) return 'timeout';
  if (msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('network') || msg.includes('connect')) return 'connection';
  return 'unknown';
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Tool call timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class JiraCollector {
  private transportConfig: McpTransportConfig;
  private signal: AbortSignal;

  constructor(transportConfig: McpTransportConfig, signal: AbortSignal) {
    this.transportConfig = transportConfig;
    this.signal = signal;
  }

  async collect(team: TeamConfig, _credentials: Credentials): Promise<CollectionResult<JiraRaw>> {
    const retrievedAt = new Date();
    const projectKey = team.jiraProjectKey ?? '';
    const session = new McpClientSession(this.transportConfig);

    try {
      await session.connect();

      // Get open issues by priority
      const openIssues = await this.callWithRetry(session, 'search_issues', {
        jql: `project = "${projectKey}" AND statusCategory != Done`,
        fields: ['priority', 'status'],
        maxResults: 1000,
      }, 'search_issues');

      if (!openIssues.ok) return { ok: false, error: openIssues.error, retrievedAt };

      // Get issues closed in last 30 days
      const closedIssues = await this.callWithRetry(session, 'search_issues', {
        jql: `project = "${projectKey}" AND statusCategory = Done AND updated >= -30d`,
        fields: ['status', 'resolutiondate'],
        maxResults: 1000,
      }, 'search_issues_closed');

      if (!closedIssues.ok) return { ok: false, error: closedIssues.error, retrievedAt };

      // Get sprint data
      const sprintData = await this.callWithRetry(session, 'get_sprint_report', {
        projectKey,
        state: 'closed',
      }, 'get_sprint_report');

      const raw = this.parseJiraData(projectKey, openIssues.data, closedIssues.data, sprintData.ok ? sprintData.data : null);
      return { ok: true, data: raw, retrievedAt };
    } catch (err) {
      const type = classifyError(err);
      const message = sanitiseMessage(err instanceof Error ? err.message : String(err));
      return { ok: false, error: { type, tool: 'connect', message }, retrievedAt };
    } finally {
      await session.close().catch(() => undefined);
    }
  }

  private async callWithRetry(
    session: McpClientSession,
    toolName: string,
    args: Record<string, unknown>,
    toolLabel: string
  ): Promise<{ ok: true; data: unknown } | { ok: false; error: CollectionError }> {
    let rateLimitAttempts = 0;
    let retried = false;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (this.signal.aborted) {
        return { ok: false, error: { type: 'unknown', tool: toolLabel, message: 'Operation aborted' } };
      }

      try {
        const data = await withTimeout(session.callTool(toolName, args), MCP_TIMEOUT_MS);
        return { ok: true, data };
      } catch (err) {
        const type = classifyError(err);
        const message = sanitiseMessage(err instanceof Error ? err.message : String(err));

        if (type === 'auth') return { ok: false, error: { type, tool: toolLabel, message } };
        if (type === 'not_found') return { ok: false, error: { type, tool: toolLabel, message } };

        if (type === 'rate_limited') {
          rateLimitAttempts++;
          if (rateLimitAttempts >= RATE_LIMIT_MAX_ATTEMPTS) {
            return { ok: false, error: { type, tool: toolLabel, message } };
          }
          const delay = Math.min(RATE_LIMIT_INITIAL_DELAY_MS * Math.pow(2, rateLimitAttempts - 1), RATE_LIMIT_MAX_DELAY_MS);
          await sleep(delay);
          continue;
        }

        if ((type === 'timeout' || type === 'connection') && !retried) {
          retried = true;
          continue;
        }

        return { ok: false, error: { type, tool: toolLabel, message } };
      }
    }
  }

  private parseJiraData(
    projectKey: string,
    openIssuesData: unknown,
    closedIssuesData: unknown,
    sprintData: unknown
  ): JiraRaw {
    const openCounts = this.countByPriority(openIssuesData);
    const closedLast30Days = this.countIssues(closedIssuesData);
    const sprint = this.extractSprint(sprintData);

    return {
      projectKey,
      openByCritical: openCounts.critical,
      openByHigh: openCounts.high,
      openByMedium: openCounts.medium,
      openByLow: openCounts.low,
      closedLast30Days,
      sprintName: sprint.name,
      sprintCompletedDate: sprint.completedDate,
      sprintVelocity: sprint.velocity,
    };
  }

  private countByPriority(data: unknown): { critical: number; high: number; medium: number; low: number } {
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    const issues = this.extractIssues(data);

    for (const issue of issues) {
      if (typeof issue !== 'object' || issue === null) continue;
      const fields = (issue as Record<string, unknown>)['fields'];
      if (typeof fields !== 'object' || fields === null) continue;
      const priority = (fields as Record<string, unknown>)['priority'];
      if (typeof priority !== 'object' || priority === null) continue;
      const name = String((priority as Record<string, unknown>)['name'] ?? '').toLowerCase();

      if (name === 'critical' || name === 'highest') counts.critical++;
      else if (name === 'high') counts.high++;
      else if (name === 'medium') counts.medium++;
      else if (name === 'low' || name === 'lowest') counts.low++;
    }

    return counts;
  }

  private countIssues(data: unknown): number {
    return this.extractIssues(data).length;
  }

  private extractIssues(data: unknown): unknown[] {
    if (typeof data !== 'object' || data === null) return [];
    const d = data as Record<string, unknown>;
    if (Array.isArray(d['issues'])) return d['issues'];
    if (Array.isArray(d['values'])) return d['values'];
    return [];
  }

  private extractSprint(data: unknown): { name: string | null; completedDate: string | null; velocity: number | null } {
    if (data === null || typeof data !== 'object') {
      return { name: null, completedDate: null, velocity: null };
    }

    const d = data as Record<string, unknown>;

    // Try { sprint: { name, completeDate, completedPoints } }
    const sprint = d['sprint'] ?? d['sprints'];
    if (typeof sprint === 'object' && sprint !== null) {
      const s = (Array.isArray(sprint) ? sprint[0] : sprint) as Record<string, unknown>;
      if (s) {
        return {
          name: typeof s['name'] === 'string' ? s['name'] : null,
          completedDate: typeof s['completeDate'] === 'string' ? s['completeDate']
            : typeof s['completedDate'] === 'string' ? s['completedDate'] : null,
          velocity: typeof s['completedPoints'] === 'number' ? s['completedPoints']
            : typeof s['velocity'] === 'number' ? s['velocity'] : null,
        };
      }
    }

    return { name: null, completedDate: null, velocity: null };
  }
}
