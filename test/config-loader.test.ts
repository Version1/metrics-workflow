import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { load, validate } from '../src/config-loader.js';
import { DEFAULT_OUTPUT } from '../src/constants.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function writeTempConfig(content: unknown): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'config-loader-test-'));
  const filePath = path.join(dir, 'config.json');
  await fs.writeFile(filePath, JSON.stringify(content), 'utf-8');
  return filePath;
}

const FULL_VALID_CONFIG = {
  sonarqube: { serverUrl: 'https://sonarqube.example.com/mcp' },
  jira:      { serverUrl: 'https://jira.example.com/mcp' },
  department: { name: 'Engineering' },
  teams: [
    { name: 'team-alpha', sonarqubeProjectKey: 'org:alpha', jiraProjectKey: 'ALPHA' },
  ],
  schedule: { interval: 'weekly', time: '08:00' },
};

const JIRA_ONLY_CONFIG = {
  jira: { serverUrl: 'https://jira.example.com/mcp' },
  department: { name: 'Engineering' },
  teams: [
    { name: 'team-beta', jiraProjectKey: 'BETA' },
  ],
};

// ---------------------------------------------------------------------------
// validate() — unit tests
// ---------------------------------------------------------------------------

describe('validate()', () => {
  it('accepts a valid full config', () => {
    const result = validate(FULL_VALID_CONFIG);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts a valid Jira-only config', () => {
    const result = validate(JIRA_ONLY_CONFIG);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts a valid SonarQube-only config', () => {
    const result = validate({
      sonarqube: { serverUrl: 'https://sonarqube.example.com/mcp' },
      department: { name: 'Engineering' },
      teams: [{ name: 'team-alpha', sonarqubeProjectKey: 'org:alpha' }],
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts stdio:// as a valid sonarqube.serverUrl', () => {
    const result = validate({
      sonarqube: { serverUrl: 'stdio://' },
      department: { name: 'Engineering' },
      teams: [{ name: 'team-alpha', sonarqubeProjectKey: 'org:alpha' }],
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('produces an error when both sonarqube and jira are missing', () => {
    const result = validate({
      department: { name: 'Engineering' },
      teams: [{ name: 'team-alpha' }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('At least one of'))).toBe(true);
  });

  it('produces an error when sonarqube is present but team is missing sonarqubeProjectKey', () => {
    const result = validate({
      sonarqube: { serverUrl: 'https://sonarqube.example.com/mcp' },
      department: { name: 'Engineering' },
      teams: [{ name: 'team-alpha' }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('sonarqubeProjectKey'))).toBe(true);
  });

  it('produces an error when jira is present but team is missing jiraProjectKey', () => {
    const result = validate({
      jira: { serverUrl: 'https://jira.example.com/mcp' },
      department: { name: 'Engineering' },
      teams: [{ name: 'team-beta' }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('jiraProjectKey'))).toBe(true);
  });

  it('produces an error when department.name is missing', () => {
    const result = validate({
      jira: { serverUrl: 'https://jira.example.com/mcp' },
      department: {},
      teams: [{ name: 'team-beta', jiraProjectKey: 'BETA' }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('department.name'))).toBe(true);
  });

  it('produces an error for an invalid schedule.interval', () => {
    const result = validate({
      ...FULL_VALID_CONFIG,
      schedule: { interval: 'monthly', time: '08:00' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('schedule.interval'))).toBe(true);
  });

  it('accepts all valid schedule.interval values', () => {
    for (const interval of ['daily', 'weekly', 'per-sprint']) {
      const result = validate({ ...FULL_VALID_CONFIG, schedule: { interval, time: '08:00' } });
      expect(result.valid).toBe(true);
    }
  });

  it('produces an error when sonarqube.serverUrl uses http://', () => {
    const result = validate({
      sonarqube: { serverUrl: 'http://sonarqube.example.com/mcp' },
      department: { name: 'Engineering' },
      teams: [{ name: 'team-alpha', sonarqubeProjectKey: 'org:alpha' }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('sonarqube.serverUrl') && e.includes('https://'))).toBe(true);
  });

  it('produces an error when jira.serverUrl uses http://', () => {
    const result = validate({
      jira: { serverUrl: 'http://jira.example.com/mcp' },
      department: { name: 'Engineering' },
      teams: [{ name: 'team-beta', jiraProjectKey: 'BETA' }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('jira.serverUrl') && e.includes('https://'))).toBe(true);
  });

  it('collects ALL errors before returning (not fail-fast)', () => {
    const result = validate({
      department: {},
      teams: [{ name: 'team-alpha' }],
      schedule: { interval: 'monthly', time: '08:00' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
    expect(result.errors.some(e => e.includes('At least one of'))).toBe(true);
    expect(result.errors.some(e => e.includes('department.name'))).toBe(true);
    expect(result.errors.some(e => e.includes('schedule.interval'))).toBe(true);
  });

  it('throws immediately when sonarqube.token is present in config', () => {
    expect(() =>
      validate({
        sonarqube: { serverUrl: 'https://sonarqube.example.com/mcp', token: 'secret' },
        department: { name: 'Engineering' },
        teams: [{ name: 'team-alpha', sonarqubeProjectKey: 'org:alpha' }],
      })
    ).toThrow(/sonarqube\.token/);
  });

  it('throws immediately when jira.token is present in config', () => {
    expect(() =>
      validate({
        jira: { serverUrl: 'https://jira.example.com/mcp', token: 'secret' },
        department: { name: 'Engineering' },
        teams: [{ name: 'team-beta', jiraProjectKey: 'BETA' }],
      })
    ).toThrow(/jira\.token/);
  });

  it('token error message is descriptive and mentions env var', () => {
    expect(() =>
      validate({
        sonarqube: { serverUrl: 'https://sonarqube.example.com/mcp', token: 'abc123' },
        department: { name: 'Engineering' },
        teams: [{ name: 'team-alpha', sonarqubeProjectKey: 'org:alpha' }],
      })
    ).toThrow(/SONARQUBE_TOKEN/);
  });
});

// ---------------------------------------------------------------------------
// load() — unit tests
// ---------------------------------------------------------------------------

describe('load()', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env['SONARQUBE_TOKEN'];
    delete process.env['JIRA_TOKEN'];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('parses a valid full config correctly', async () => {
    const filePath = await writeTempConfig(FULL_VALID_CONFIG);
    const { config } = await load(filePath);

    expect(config.sonarqube?.serverUrl).toBe('https://sonarqube.example.com/mcp');
    expect(config.jira?.serverUrl).toBe('https://jira.example.com/mcp');
    expect(config.department.name).toBe('Engineering');
    expect(config.teams).toHaveLength(1);
    expect(config.teams[0].name).toBe('team-alpha');
  });

  it('parses a valid Jira-only config correctly', async () => {
    const filePath = await writeTempConfig(JIRA_ONLY_CONFIG);
    const { config } = await load(filePath);

    expect(config.jira?.serverUrl).toBe('https://jira.example.com/mcp');
    expect(config.sonarqube).toBeUndefined();
    expect(config.teams[0].jiraProjectKey).toBe('BETA');
  });

  it('resolves output fields against DEFAULT_OUTPUT when omitted', async () => {
    const filePath = await writeTempConfig(FULL_VALID_CONFIG);
    const { config } = await load(filePath);

    expect(config.output?.reportsDir).toBe(DEFAULT_OUTPUT.reportsDir);
    expect(config.output?.auditDir).toBe(DEFAULT_OUTPUT.auditDir);
    expect(config.output?.schemaFile).toBe(DEFAULT_OUTPUT.schemaFile);
    expect(config.output?.schedulerState).toBe(DEFAULT_OUTPUT.schedulerState);
    expect(config.output?.integrationGuide).toBe(DEFAULT_OUTPUT.integrationGuide);
  });

  it('uses custom output paths when provided', async () => {
    const customOutput = {
      reportsDir: 'custom/reports',
      auditDir: 'custom/audit',
      schemaFile: 'custom/schema.json',
      schedulerState: 'custom/state.json',
      integrationGuide: 'custom/guide.md',
    };
    const filePath = await writeTempConfig({ ...FULL_VALID_CONFIG, output: customOutput });
    const { config } = await load(filePath);

    expect(config.output?.reportsDir).toBe('custom/reports');
    expect(config.output?.auditDir).toBe('custom/audit');
  });

  it('sets file permissions to 0600 on the config file after reading', async () => {
    const filePath = await writeTempConfig(FULL_VALID_CONFIG);
    await load(filePath);

    const stat = await fs.stat(filePath);
    const mode = stat.mode & 0o777;
    if (process.platform !== 'win32') {
      expect(mode).toBe(0o600);
    }
  });

  it('uses SONARQUBE_TOKEN env var when set', async () => {
    process.env['SONARQUBE_TOKEN'] = 'env-sonar-token';
    const filePath = await writeTempConfig(FULL_VALID_CONFIG);
    const { credentials } = await load(filePath);

    expect(credentials.sonarqubeToken).toBe('env-sonar-token');
  });

  it('uses JIRA_TOKEN env var when set', async () => {
    process.env['JIRA_TOKEN'] = 'env-jira-token';
    const filePath = await writeTempConfig(FULL_VALID_CONFIG);
    const { credentials } = await load(filePath);

    expect(credentials.jiraToken).toBe('env-jira-token');
  });

  it('returns empty credentials when no env vars are set', async () => {
    const filePath = await writeTempConfig(FULL_VALID_CONFIG);
    const { credentials } = await load(filePath);

    expect(credentials.sonarqubeToken).toBeUndefined();
    expect(credentials.jiraToken).toBeUndefined();
  });

  it('throws with descriptive error when token field is in config file', async () => {
    const filePath = await writeTempConfig({
      sonarqube: { serverUrl: 'https://sonarqube.example.com/mcp', token: 'secret' },
      department: { name: 'Engineering' },
      teams: [{ name: 'team-alpha', sonarqubeProjectKey: 'org:alpha' }],
    });

    await expect(load(filePath)).rejects.toThrow(/sonarqube\.token/);
  });

  it('token error message mentions env var and git filter-repo', async () => {
    const filePath = await writeTempConfig({
      sonarqube: { serverUrl: 'https://sonarqube.example.com/mcp', token: 'abc123' },
      department: { name: 'Engineering' },
      teams: [{ name: 'team-alpha', sonarqubeProjectKey: 'org:alpha' }],
    });

    await expect(load(filePath)).rejects.toThrow(/SONARQUBE_TOKEN/);
    await expect(load(filePath)).rejects.toThrow(/git filter-repo/);
  });

  it('throws with all validation errors when config is invalid', async () => {
    const filePath = await writeTempConfig({
      department: {},
      teams: [{ name: 'team-alpha' }],
      schedule: { interval: 'monthly', time: '08:00' },
    });

    await expect(load(filePath)).rejects.toThrow(/validation failed/i);
  });

  it('throws when config file does not exist', async () => {
    await expect(load('/nonexistent/path/config.json')).rejects.toThrow();
  });

  it('throws when config file contains invalid JSON', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'config-loader-test-'));
    const filePath = path.join(dir, 'config.json');
    await fs.writeFile(filePath, '{ invalid json }', 'utf-8');

    await expect(load(filePath)).rejects.toThrow(/Failed to parse/);
  });
});
