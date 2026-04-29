import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { promises as fs } from 'fs';
import { Orchestrator } from '../src/orchestrator.js';
import { SonarQubeCollector } from '../src/sonarqube-collector.js';
import { JiraCollector } from '../src/jira-collector.js';
import { AgentConfig } from '../src/types.js';
import { Credentials } from '../src/config-loader.js';

vi.mock('../src/sonarqube-collector.js');
vi.mock('../src/jira-collector.js');

const MockedSonar = SonarQubeCollector as vi.MockedClass<typeof SonarQubeCollector>;
const MockedJira = JiraCollector as vi.MockedClass<typeof JiraCollector>;

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-test-'));
}

const SONAR_SUCCESS = {
  ok: true as const,
  retrievedAt: new Date(),
  data: {
    projectKey: 'org:alpha',
    bugs: 0, vulnerabilities: 0, securityHotspotsTotal: 0, securityHotspotsReviewed: 0,
    codeSmells: 0, duplicationsPct: 0, coveragePct: 90, technicalDebt: '0min',
    reliabilityRating: 'A' as const, maintainabilityRating: 'A' as const,
    securityRating: 'A' as const, qualityGate: 'OK' as const,
  },
};

const SONAR_FAILURE = {
  ok: false as const,
  retrievedAt: new Date(),
  error: { type: 'auth' as const, tool: 'get_component_measures', message: 'Unauthorized' },
};

const JIRA_SUCCESS = {
  ok: true as const,
  retrievedAt: new Date(),
  data: {
    projectKey: 'ALPHA',
    openByCritical: 0, openByHigh: 0, openByMedium: 0, openByLow: 0,
    closedLast30Days: 5, sprintName: 'Sprint 1',
    sprintCompletedDate: '2024-01-15T00:00:00Z', sprintVelocity: 20,
  },
};

const JIRA_FAILURE = {
  ok: false as const,
  retrievedAt: new Date(),
  error: { type: 'connection' as const, tool: 'search_issues', message: 'Connection refused' },
};

function makeConfig(reportsDir: string, overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    sonarqube: { serverUrl: 'https://sonarqube.example.com/mcp' },
    department: { name: 'Engineering' },
    teams: [{ name: 'team-alpha', sonarqubeProjectKey: 'org:alpha' }],
    output: { reportsDir, auditDir: '', schemaFile: '', schedulerState: '', integrationGuide: '' },
    ...overrides,
  };
}

const CREDS: Credentials = { sonarqubeToken: 'token' };

beforeEach(() => { vi.clearAllMocks(); });

describe('Orchestrator — exit codes', () => {
  it('returns exit code 0 when all teams succeed', async () => {
    const dir = await makeTempDir();
    MockedSonar.prototype.collect = vi.fn().mockResolvedValue(SONAR_SUCCESS);

    const summary = await new Orchestrator().run({
      config: makeConfig(dir),
      credentials: CREDS,
      signal: new AbortController().signal,
    });

    expect(summary.exitCode).toBe(0);
    expect(summary.teamsSucceeded).toBe(1);
    expect(summary.teamsFailed).toBe(0);
  });

  it('returns exit code 2 when all teams fail', async () => {
    const dir = await makeTempDir();
    MockedSonar.prototype.collect = vi.fn().mockResolvedValue(SONAR_FAILURE);

    const summary = await new Orchestrator().run({
      config: makeConfig(dir),
      credentials: CREDS,
      signal: new AbortController().signal,
    });

    expect(summary.exitCode).toBe(2);
    expect(summary.teamsSucceeded).toBe(0);
    expect(summary.teamsFailed).toBe(1);
  });

  it('returns exit code 1 when some teams succeed and some fail', async () => {
    const dir = await makeTempDir();
    let callCount = 0;
    MockedSonar.prototype.collect = vi.fn().mockImplementation(async () => {
      callCount++;
      return callCount === 1 ? SONAR_SUCCESS : SONAR_FAILURE;
    });

    const config = makeConfig(dir, {
      sonarqube: { serverUrl: 'https://sonarqube.example.com/mcp' },
      teams: [
        { name: 'team-alpha', sonarqubeProjectKey: 'org:alpha' },
        { name: 'team-beta', sonarqubeProjectKey: 'org:beta' },
      ],
    });

    const summary = await new Orchestrator().run({
      config,
      credentials: CREDS,
      signal: new AbortController().signal,
    });

    expect(summary.exitCode).toBe(1);
    expect(summary.teamsSucceeded).toBe(1);
    expect(summary.teamsFailed).toBe(1);
  });

  it('returns exit code 3 when no teams are configured', async () => {
    const dir = await makeTempDir();
    const config = makeConfig(dir, { teams: [] });

    const summary = await new Orchestrator().run({
      config,
      credentials: CREDS,
      signal: new AbortController().signal,
    });

    expect(summary.exitCode).toBe(3);
  });
});

describe('Orchestrator — partial failures', () => {
  it('records sonarqube=false in metricsRetrieved when sonar fails', async () => {
    const dir = await makeTempDir();
    MockedSonar.prototype.collect = vi.fn().mockResolvedValue(SONAR_FAILURE);

    const summary = await new Orchestrator().run({
      config: makeConfig(dir),
      credentials: CREDS,
      signal: new AbortController().signal,
    });

    expect(summary.metricsRetrieved[0].sonarqube).toBe(false);
  });

  it('still writes a report when sonar fails (partial data)', async () => {
    const dir = await makeTempDir();
    MockedSonar.prototype.collect = vi.fn().mockResolvedValue(SONAR_FAILURE);

    await new Orchestrator().run({
      config: makeConfig(dir),
      credentials: CREDS,
      signal: new AbortController().signal,
    });

    const files = await fs.readdir(dir);
    const scanDir = files.find(f => f.startsWith('metrics-scan-'));
    expect(scanDir).toBeDefined();
    const reportFiles = await fs.readdir(path.join(dir, scanDir!));
    expect(reportFiles).toContain('team-alpha.md');
  });

  it('records jira=false when jira fails but sonar succeeds', async () => {
    const dir = await makeTempDir();
    MockedSonar.prototype.collect = vi.fn().mockResolvedValue(SONAR_SUCCESS);
    MockedJira.prototype.collect = vi.fn().mockResolvedValue(JIRA_FAILURE);

    const config = makeConfig(dir, {
      sonarqube: { serverUrl: 'https://sonarqube.example.com/mcp' },
      jira: { serverUrl: 'https://mcp.atlassian.com/v1/sse' },
      teams: [{ name: 'team-alpha', sonarqubeProjectKey: 'org:alpha', jiraProjectKey: 'ALPHA' }],
    });

    const summary = await new Orchestrator().run({
      config,
      credentials: { ...CREDS, jiraToken: 'jira-token' },
      signal: new AbortController().signal,
    });

    expect(summary.metricsRetrieved[0].sonarqube).toBe(true);
    expect(summary.metricsRetrieved[0].jira).toBe(false);
    // Both sonar and jira must succeed for a team to be counted as succeeded
    expect(summary.teamsSucceeded).toBe(0);
    expect(summary.teamsFailed).toBe(1);
  });

  it('does not collect sonar when sonarqubeProjectKey is missing', async () => {
    const dir = await makeTempDir();
    MockedSonar.prototype.collect = vi.fn().mockResolvedValue(SONAR_SUCCESS);

    const config = makeConfig(dir, {
      sonarqube: { serverUrl: 'https://sonarqube.example.com/mcp' },
      teams: [{ name: 'team-alpha' }], // no sonarqubeProjectKey
    });

    await new Orchestrator().run({
      config,
      credentials: CREDS,
      signal: new AbortController().signal,
    });

    expect(MockedSonar.prototype.collect).not.toHaveBeenCalled();
  });
});

describe('Orchestrator — abort signal', () => {
  it('stops processing teams when signal is aborted before collection', async () => {
    const dir = await makeTempDir();
    const controller = new AbortController();
    controller.abort();

    MockedSonar.prototype.collect = vi.fn().mockResolvedValue(SONAR_SUCCESS);

    const config = makeConfig(dir, {
      teams: [
        { name: 'team-alpha', sonarqubeProjectKey: 'org:alpha' },
        { name: 'team-beta', sonarqubeProjectKey: 'org:beta' },
      ],
    });

    const summary = await new Orchestrator().run({
      config,
      credentials: CREDS,
      signal: controller.signal,
    });

    expect(MockedSonar.prototype.collect).not.toHaveBeenCalled();
    // teamsAttempted increments before the abort check, so it will be 1
    expect(summary.teamsAttempted).toBe(1);
    expect(summary.teamsSucceeded).toBe(0);
  });
});

describe('Orchestrator — report output', () => {
  it('writes a summary.md alongside team reports', async () => {
    const dir = await makeTempDir();
    MockedSonar.prototype.collect = vi.fn().mockResolvedValue(SONAR_SUCCESS);

    await new Orchestrator().run({
      config: makeConfig(dir),
      credentials: CREDS,
      signal: new AbortController().signal,
    });

    const files = await fs.readdir(dir);
    const scanDir = files.find(f => f.startsWith('metrics-scan-'));
    expect(scanDir).toBeDefined();
    const reportFiles = await fs.readdir(path.join(dir, scanDir!));
    expect(reportFiles).toContain('summary.md');
  });

  it('does not write summary when no teams produce results', async () => {
    const dir = await makeTempDir();
    const controller = new AbortController();
    controller.abort();

    const summary = await new Orchestrator().run({
      config: makeConfig(dir),
      credentials: CREDS,
      signal: controller.signal,
    });

    const files = await fs.readdir(dir);
    const scanDir = files.find(f => f.startsWith('metrics-scan-'));
    expect(scanDir).toBeUndefined();
    // teamsAttempted increments before the abort check
    expect(summary.teamsAttempted).toBe(1);
    expect(summary.teamsSucceeded).toBe(0);
  });

  it('includes durationMs in the summary', async () => {
    const dir = await makeTempDir();
    MockedSonar.prototype.collect = vi.fn().mockResolvedValue(SONAR_SUCCESS);

    const summary = await new Orchestrator().run({
      config: makeConfig(dir),
      credentials: CREDS,
      signal: new AbortController().signal,
    });

    expect(summary.durationMs).toBeGreaterThanOrEqual(0);
  });
});
