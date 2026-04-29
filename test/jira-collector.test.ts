import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JiraCollector } from '../src/jira-collector.js';
import { McpClientSession } from '../src/mcp-client.js';
import { TeamConfig } from '../src/types.js';
import { Credentials } from '../src/config-loader.js';

vi.mock('../src/mcp-client.js');

const MockedSession = McpClientSession as vi.MockedClass<typeof McpClientSession>;

const TEAM: TeamConfig = { name: 'team-beta', jiraProjectKey: 'BETA' };
const CREDS: Credentials = { jiraToken: 'test-jira-token' };
const TRANSPORT = { type: 'sse' as const, url: 'https://mcp.atlassian.com/v1/sse' };

function makeOpenIssuesResponse(issues: Array<{ priority: string }> = []) {
  return {
    issues: issues.map((i) => ({
      fields: { priority: { name: i.priority }, status: { name: 'In Progress' } },
    })),
  };
}

function makeClosedIssuesResponse(count: number) {
  return {
    issues: Array.from({ length: count }, () => ({
      fields: { status: { name: 'Done' }, resolutiondate: '2024-01-15T10:00:00Z' },
    })),
  };
}

function makeSprintResponse(name: string, completedDate: string, velocity: number) {
  return { sprint: { name, completeDate: completedDate, completedPoints: velocity } };
}

function makeSession(callToolImpl: (name: string, args: Record<string, unknown>) => Promise<unknown>) {
  MockedSession.mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    callTool: vi.fn().mockImplementation(callToolImpl),
    listTools: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
  }) as unknown as McpClientSession);
}

describe('JiraCollector', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns all JiraRaw fields correctly', async () => {
    // Both open and closed issues use the same 'search_issues' tool — distinguish by JQL arg
    makeSession(async (name, args) => {
      if (name === 'search_issues') {
        const jql = String(args['jql'] ?? '');
        if (jql.includes('statusCategory != Done')) {
          return makeOpenIssuesResponse([
            { priority: 'Critical' }, { priority: 'High' }, { priority: 'High' },
            { priority: 'Medium' }, { priority: 'Low' },
          ]);
        }
        // closed issues query
        return makeClosedIssuesResponse(8);
      }
      if (name === 'get_sprint_report') return makeSprintResponse('Sprint 12', '2024-01-10T00:00:00Z', 42);
      throw new Error(`Unexpected: ${name}`);
    });

    const result = await new JiraCollector(TRANSPORT, new AbortController().signal).collect(TEAM, CREDS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.projectKey).toBe('BETA');
    expect(result.data.openByCritical).toBe(1);
    expect(result.data.openByHigh).toBe(2);
    expect(result.data.openByMedium).toBe(1);
    expect(result.data.openByLow).toBe(1);
    expect(result.data.closedLast30Days).toBe(8);
    expect(result.data.sprintName).toBe('Sprint 12');
    expect(result.data.sprintCompletedDate).toBe('2024-01-10T00:00:00Z');
    expect(result.data.sprintVelocity).toBe(42);
  });

  it('sets sprint fields to null when no closed sprint exists', async () => {
    makeSession(async (name, args) => {
      if (name === 'search_issues') {
        const jql = String(args['jql'] ?? '');
        if (jql.includes('statusCategory != Done')) return makeOpenIssuesResponse([]);
        return makeClosedIssuesResponse(0);
      }
      if (name === 'get_sprint_report') throw new Error('404 not found');
      throw new Error(`Unexpected: ${name}`);
    });

    const result = await new JiraCollector(TRANSPORT, new AbortController().signal).collect(TEAM, CREDS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sprintName).toBeNull();
    expect(result.data.sprintCompletedDate).toBeNull();
    expect(result.data.sprintVelocity).toBeNull();
  });

  it('retries once on timeout then returns permanent failure', async () => {
    let callCount = 0;
    makeSession(async () => { callCount++; throw new Error('Tool call timed out after 30000ms'); });
    const result = await new JiraCollector(TRANSPORT, new AbortController().signal).collect(TEAM, CREDS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe('timeout');
    expect(callCount).toBe(2);
  });

  it('returns auth error for 401 (non-retryable)', async () => {
    let callCount = 0;
    makeSession(async () => { callCount++; throw new Error('401 Unauthorized'); });
    const result = await new JiraCollector(TRANSPORT, new AbortController().signal).collect(TEAM, CREDS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe('auth');
    expect(callCount).toBe(1);
  });

  it('records retrievedAt timestamp', async () => {
    makeSession(async (name, args) => {
      if (name === 'search_issues') {
        const jql = String(args['jql'] ?? '');
        if (jql.includes('statusCategory != Done')) return makeOpenIssuesResponse([]);
        return makeClosedIssuesResponse(0);
      }
      if (name === 'get_sprint_report') return makeSprintResponse('S1', '2024-01-01T00:00:00Z', 10);
      throw new Error(`Unexpected: ${name}`);
    });
    const before = new Date();
    const result = await new JiraCollector(TRANSPORT, new AbortController().signal).collect(TEAM, CREDS);
    const after = new Date();
    expect(result.retrievedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(result.retrievedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});
