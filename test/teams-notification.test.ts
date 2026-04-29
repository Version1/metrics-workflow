import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Tests for the Teams notification logic used in the GitHub Actions workflow.
 * The workflow uses a Python script to build and POST the payload — these tests
 * validate the report discovery and payload shape using the same logic in TypeScript.
 */

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'teams-notify-test-'));
}

const SAMPLE_REPORT = `# Dev Metrics Report — team-alpha

**Department:** Engineering
**Generated:** 2026-04-24 13:00:00 UTC

## Summary

> ✅ All metrics within thresholds

## Code Quality

| Metric | Value |
|--------|-------|
| Quality Gate | ✅ **PASSED** |
| Bugs | 0 |
| Coverage | 85.0% |
`;

const FAILED_REPORT = `# Dev Metrics Report — team-alpha

**Department:** Engineering
**Generated:** 2026-04-24 13:00:00 UTC

## Summary

> ⚠️ Attention required:
> - Quality gate FAILED
> - Coverage 0.0% (below 80%)

## Code Quality

| Metric | Value |
|--------|-------|
| Quality Gate | ⚠️ **FAILED** |
| Coverage | ⚠️ **0.0%** |
`;

// Mirrors the glob + sort logic from the workflow's Python script
async function findLatestReportFile(reportsDir: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await fs.readdir(reportsDir);
  } catch {
    return null;
  }

  const scanDirs = entries
    .filter(e => e.startsWith('metrics-scan-'))
    .sort();

  for (const dir of scanDirs.reverse()) {
    const dirPath = path.join(reportsDir, dir);
    const files = await fs.readdir(dirPath);
    const reportFile = files.find(f => f.startsWith('metrics-') && f.endsWith('.md'));
    if (reportFile) return path.join(dirPath, reportFile);
  }
  return null;
}

// Mirrors the payload shape built in the workflow Python script
function buildSuccessPayload(reportText: string): object {
  return {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',
        body: [{
          type: 'TextBlock',
          text: reportText,
          wrap: true,
        }],
      },
    }],
  };
}

function buildFailurePayload(logText: string, runUrl: string): object {
  const bodyText = [
    '❌ **Weekly Metrics Scan Failed**',
    '',
    `**Workflow run:** ${runUrl}`,
    '',
    '**Last log output:**',
    '',
    '```',
    logText,
    '```',
  ].join('\n');

  return {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',
        body: [{
          type: 'TextBlock',
          text: bodyText,
          wrap: true,
        }],
      },
    }],
  };
}

// ---------------------------------------------------------------------------

describe('Teams notification — report discovery', () => {
  it('finds the latest metrics report file', async () => {
    const dir = await makeTempDir();
    const scanDir = path.join(dir, 'metrics-scan-2026-04-24-13-00-00');
    await fs.mkdir(scanDir);
    await fs.writeFile(path.join(scanDir, 'metrics-team-alpha.md'), SAMPLE_REPORT);

    const found = await findLatestReportFile(dir);
    expect(found).not.toBeNull();
    expect(found).toContain('metrics-team-alpha.md');
  });

  it('picks the most recent scan directory when multiple exist', async () => {
    const dir = await makeTempDir();

    const older = path.join(dir, 'metrics-scan-2026-04-17-13-00-00');
    const newer = path.join(dir, 'metrics-scan-2026-04-24-13-00-00');
    await fs.mkdir(older);
    await fs.mkdir(newer);
    await fs.writeFile(path.join(older, 'metrics-team-alpha.md'), 'old report');
    await fs.writeFile(path.join(newer, 'metrics-team-alpha.md'), SAMPLE_REPORT);

    const found = await findLatestReportFile(dir);
    expect(found).toContain('2026-04-24');
  });

  it('returns null when no scan directories exist', async () => {
    const dir = await makeTempDir();
    const found = await findLatestReportFile(dir);
    expect(found).toBeNull();
  });

  it('returns null when reports directory does not exist', async () => {
    const found = await findLatestReportFile('/nonexistent/path/reports');
    expect(found).toBeNull();
  });

  it('skips scan directories that contain no metrics .md files', async () => {
    const dir = await makeTempDir();
    const scanDir = path.join(dir, 'metrics-scan-2026-04-24-13-00-00');
    await fs.mkdir(scanDir);
    await fs.writeFile(path.join(scanDir, 'summary.md'), 'summary only');

    const found = await findLatestReportFile(dir);
    expect(found).toBeNull();
  });
});

describe('Teams notification — success payload', () => {
  it('builds a valid adaptive card payload', () => {
    const payload = buildSuccessPayload(SAMPLE_REPORT) as Record<string, unknown>;
    expect(payload.type).toBe('message');

    const attachments = payload.attachments as Array<Record<string, unknown>>;
    expect(attachments).toHaveLength(1);
    expect(attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive');
  });

  it('includes the full report text in the card body', () => {
    const payload = buildSuccessPayload(SAMPLE_REPORT) as Record<string, unknown>;
    const attachments = payload.attachments as Array<Record<string, unknown>>;
    const content = attachments[0].content as Record<string, unknown>;
    const body = content.body as Array<Record<string, unknown>>;

    expect(body[0].text).toBe(SAMPLE_REPORT);
    expect(body[0].wrap).toBe(true);
  });

  it('payload is valid JSON', () => {
    const payload = buildSuccessPayload(SAMPLE_REPORT);
    expect(() => JSON.stringify(payload)).not.toThrow();
  });

  it('handles report text containing special characters', () => {
    const report = '# Report\n\n⚠️ **FAILED** — coverage: 0.0%\n\n```\ncode block\n```';
    const payload = buildSuccessPayload(report);
    const json = JSON.stringify(payload);
    expect(json).toContain('⚠️');
    expect(json).toContain('FAILED');
  });
});

describe('Teams notification — failure payload', () => {
  const RUN_URL = 'https://github.com/org/repo/actions/runs/12345';

  it('builds a valid adaptive card payload', () => {
    const payload = buildFailurePayload('Error: connection refused', RUN_URL) as Record<string, unknown>;
    expect(payload.type).toBe('message');

    const attachments = payload.attachments as Array<Record<string, unknown>>;
    expect(attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive');
  });

  it('includes the workflow run URL in the message', () => {
    const payload = buildFailurePayload('some error', RUN_URL) as Record<string, unknown>;
    const attachments = payload.attachments as Array<Record<string, unknown>>;
    const content = attachments[0].content as Record<string, unknown>;
    const body = content.body as Array<Record<string, unknown>>;

    expect(String(body[0].text)).toContain(RUN_URL);
  });

  it('includes the log output in the message', () => {
    const logOutput = 'Error: SONARQUBE_TOKEN is not set\nExiting with code 1';
    const payload = buildFailurePayload(logOutput, RUN_URL) as Record<string, unknown>;
    const attachments = payload.attachments as Array<Record<string, unknown>>;
    const content = attachments[0].content as Record<string, unknown>;
    const body = content.body as Array<Record<string, unknown>>;

    expect(String(body[0].text)).toContain(logOutput);
  });

  it('includes the failure indicator in the message', () => {
    const payload = buildFailurePayload('error', RUN_URL) as Record<string, unknown>;
    const attachments = payload.attachments as Array<Record<string, unknown>>;
    const content = attachments[0].content as Record<string, unknown>;
    const body = content.body as Array<Record<string, unknown>>;

    expect(String(body[0].text)).toContain('❌');
  });

  it('payload is valid JSON', () => {
    const payload = buildFailurePayload('some error output', RUN_URL);
    expect(() => JSON.stringify(payload)).not.toThrow();
  });

  it('handles empty log output gracefully', () => {
    const payload = buildFailurePayload('', RUN_URL);
    expect(() => JSON.stringify(payload)).not.toThrow();
  });
});
