import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SonarQubeCollector } from '../src/sonarqube-collector.js';
import { McpClientSession } from '../src/mcp-client.js';
import { TeamConfig } from '../src/types.js';
import { Credentials } from '../src/config-loader.js';

vi.mock('../src/mcp-client.js');

const MockedSession = McpClientSession as vi.MockedClass<typeof McpClientSession>;

const TEAM: TeamConfig = { name: 'team-alpha', sonarqubeProjectKey: 'org.example:alpha' };
const CREDS: Credentials = { sonarqubeToken: 'test-token' };
const TRANSPORT = { type: 'stdio' as const, command: 'sonar-mcp' };

function makeMeasuresResponse(overrides: Record<string, string | number> = {}) {
  const defaults: Record<string, string | number> = {
    bugs: '2', vulnerabilities: '1', security_hotspots: '5',
    security_hotspots_reviewed: '3', code_smells: '10',
    duplicated_lines_density: '4.5', coverage: '78.2',
    sqale_index: '150', reliability_rating: '2', sqale_rating: '1', security_rating: '3',
  };
  const merged = { ...defaults, ...overrides };
  return {
    component: {
      measures: Object.entries(merged).map(([metric, value]) => ({ metric, value: String(value) })),
    },
  };
}

function makeQualityGateResponse(status: string) {
  return { projectStatus: { status } };
}

function makeSession(callToolImpl: (name: string, args: Record<string, unknown>) => Promise<unknown>) {
  MockedSession.mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    callTool: vi.fn().mockImplementation(callToolImpl),
    listTools: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
  }) as unknown as McpClientSession);
}

describe('SonarQubeCollector', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns all SonarQubeRaw fields correctly mapped', async () => {
    makeSession(async (name) => {
      if (name === 'get_component_measures') return makeMeasuresResponse();
      if (name === 'get_project_quality_gate_status') return makeQualityGateResponse('OK');
      throw new Error(`Unexpected tool: ${name}`);
    });

    const result = await new SonarQubeCollector(TRANSPORT, new AbortController().signal).collect(TEAM, CREDS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.bugs).toBe(2);
    expect(result.data.vulnerabilities).toBe(1);
    expect(result.data.securityHotspotsTotal).toBe(5);
    expect(result.data.securityHotspotsReviewed).toBe(3);
    expect(result.data.codeSmells).toBe(10);
    expect(result.data.duplicationsPct).toBeCloseTo(4.5);
    expect(result.data.coveragePct).toBeCloseTo(78.2);
    expect(result.data.technicalDebt).toBe('2h 30min');
    expect(result.data.reliabilityRating).toBe('B');
    expect(result.data.maintainabilityRating).toBe('A');
    expect(result.data.securityRating).toBe('C');
    expect(result.data.qualityGate).toBe('OK');
  });

  it('converts sqale_index 0 to "0min"', async () => {
    makeSession(async (name) => {
      if (name === 'get_component_measures') return makeMeasuresResponse({ sqale_index: '0' });
      return makeQualityGateResponse('OK');
    });
    const result = await new SonarQubeCollector(TRANSPORT, new AbortController().signal).collect(TEAM, CREDS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.technicalDebt).toBe('0min');
  });

  it('converts sqale_index whole hours correctly', async () => {
    makeSession(async (name) => {
      if (name === 'get_component_measures') return makeMeasuresResponse({ sqale_index: '120' });
      return makeQualityGateResponse('OK');
    });
    const result = await new SonarQubeCollector(TRANSPORT, new AbortController().signal).collect(TEAM, CREDS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.technicalDebt).toBe('2h');
  });

  it('returns not_found for unknown project key', async () => {
    makeSession(async () => { throw new Error('Component not found: org.example:unknown'); });
    const result = await new SonarQubeCollector(TRANSPORT, new AbortController().signal)
      .collect({ name: 'x', sonarqubeProjectKey: 'org.example:unknown' }, CREDS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe('not_found');
  });

  it('retries once on timeout then returns permanent failure', async () => {
    let callCount = 0;
    makeSession(async () => { callCount++; throw new Error('Tool call timed out after 30000ms'); });
    const result = await new SonarQubeCollector(TRANSPORT, new AbortController().signal).collect(TEAM, CREDS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe('timeout');
    expect(callCount).toBe(2);
  });

  it('returns auth error for 401 (non-retryable)', async () => {
    let callCount = 0;
    makeSession(async () => { callCount++; throw new Error('401 Unauthorized'); });
    const result = await new SonarQubeCollector(TRANSPORT, new AbortController().signal).collect(TEAM, CREDS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe('auth');
    expect(callCount).toBe(1);
  });

  it('returns auth error for 403 (non-retryable)', async () => {
    let callCount = 0;
    makeSession(async () => { callCount++; throw new Error('403 Forbidden'); });
    const result = await new SonarQubeCollector(TRANSPORT, new AbortController().signal).collect(TEAM, CREDS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe('auth');
    expect(callCount).toBe(1);
  });

  it('returns rate_limited error after exhausting max attempts', async () => {
    makeSession(async () => { throw new Error('429 Too Many Requests'); });
    vi.useFakeTimers();
    const collectPromise = new SonarQubeCollector(TRANSPORT, new AbortController().signal).collect(TEAM, CREDS);
    await vi.runAllTimersAsync();
    const result = await collectPromise;
    vi.useRealTimers();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe('rate_limited');
  });

  it('strips token values from error messages', async () => {
    makeSession(async () => { throw new Error('401 Unauthorized: token=secret-token-value'); });
    const result = await new SonarQubeCollector(TRANSPORT, new AbortController().signal).collect(TEAM, CREDS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).not.toContain('secret-token-value');
    expect(result.error.message).toContain('[REDACTED]');
  });

  it('records retrievedAt timestamp', async () => {
    makeSession(async (name) => {
      if (name === 'get_component_measures') return makeMeasuresResponse();
      return makeQualityGateResponse('OK');
    });
    const before = new Date();
    const result = await new SonarQubeCollector(TRANSPORT, new AbortController().signal).collect(TEAM, CREDS);
    const after = new Date();
    expect(result.retrievedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(result.retrievedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});
