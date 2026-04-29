import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ReportGenerator } from '../src/report-generator.js';
import { NormalisedMetrics } from '../src/types.js';
import { SCHEMA_VERSION } from '../src/constants.js';

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'report-gen-test-'));
}

function makeMetrics(overrides: Partial<NormalisedMetrics> = {}): NormalisedMetrics {
  return {
    schemaVersion: SCHEMA_VERSION,
    team: 'team-alpha',
    department: 'Engineering',
    generatedAt: '2024-01-20T10:00:00.000Z',
    codeQuality: {
      status: 'retrieved',
      retrievedAt: '2024-01-20T09:55:00.000Z',
      projectKey: 'org.example:alpha',
      bugs: 0,
      vulnerabilities: 0,
      securityHotspotsTotal: 3,
      securityHotspotsReviewed: 3,
      codeSmells: 5,
      duplicationsPct: 2.1,
      coveragePct: 85.0,
      technicalDebtMin: 60,
      reliabilityRating: 'A',
      maintainabilityRating: 'A',
      securityRating: 'A',
      qualityGate: 'passed',
    },
    velocity: {
      status: 'retrieved',
      retrievedAt: '2024-01-20T09:56:00.000Z',
      projectKey: 'ALPHA',
      openCritical: 0,
      openHigh: 2,
      openMedium: 5,
      openLow: 1,
      closedLast30Days: 12,
      sprintName: 'Sprint 10',
      sprintCompletedDate: '2024-01-15T00:00:00Z',
      sprintVelocityPts: 38,
    },
    ...overrides,
  };
}

describe('ReportGenerator', () => {
  describe('checkOutputWritable()', () => {
    it('succeeds for a writable directory', async () => {
      const dir = await makeTempDir();
      const gen = new ReportGenerator(dir);
      await expect(gen.checkOutputWritable()).resolves.not.toThrow();
    });

    it('creates the directory if it does not exist', async () => {
      const dir = await makeTempDir();
      const subDir = path.join(dir, 'new-subdir');
      const gen = new ReportGenerator(subDir);
      await gen.checkOutputWritable();
      const stat = await fs.stat(subDir);
      expect(stat.isDirectory()).toBe(true);
    });
  });

  describe('writeTeamReport()', () => {
    it('writes a Markdown file with the correct name', async () => {
      const dir = await makeTempDir();
      const gen = new ReportGenerator(dir);
      const filePath = await gen.writeTeamReport(makeMetrics());
      expect(filePath).toMatch(/metrics-scan-[\d-]+[/\\]team-alpha\.md$/);
      const stat = await fs.stat(filePath);
      expect(stat.isFile()).toBe(true);
    });

    it('includes team name and department in the report', async () => {
      const dir = await makeTempDir();
      const gen = new ReportGenerator(dir);
      const filePath = await gen.writeTeamReport(makeMetrics());
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toContain('team-alpha');
      expect(content).toContain('Engineering');
    });

    it('shows ✅ summary when no thresholds exceeded', async () => {
      const dir = await makeTempDir();
      const gen = new ReportGenerator(dir);
      const filePath = await gen.writeTeamReport(makeMetrics());
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toContain('✅');
    });

    it('flags quality gate FAILED', async () => {
      const dir = await makeTempDir();
      const gen = new ReportGenerator(dir);
      const metrics = makeMetrics();
      metrics.codeQuality.qualityGate = 'failed';
      const filePath = await gen.writeTeamReport(metrics);
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toContain('⚠️');
      expect(content).toContain('FAILED');
    });

    it('flags bugs > 0', async () => {
      const dir = await makeTempDir();
      const gen = new ReportGenerator(dir);
      const metrics = makeMetrics();
      metrics.codeQuality.bugs = 3;
      const filePath = await gen.writeTeamReport(metrics);
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toContain('⚠️');
    });

    it('flags coverage below 80%', async () => {
      const dir = await makeTempDir();
      const gen = new ReportGenerator(dir);
      const metrics = makeMetrics();
      metrics.codeQuality.coveragePct = 72.5;
      const filePath = await gen.writeTeamReport(metrics);
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toContain('72.5%');
      expect(content).toContain('⚠️');
    });

    it('flags critical open issues > 0', async () => {
      const dir = await makeTempDir();
      const gen = new ReportGenerator(dir);
      const metrics = makeMetrics();
      metrics.velocity.openCritical = 2;
      const filePath = await gen.writeTeamReport(metrics);
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toContain('⚠️');
    });

    it('flags unreviewed security hotspots', async () => {
      const dir = await makeTempDir();
      const gen = new ReportGenerator(dir);
      const metrics = makeMetrics();
      metrics.codeQuality.securityHotspotsTotal = 5;
      metrics.codeQuality.securityHotspotsReviewed = 2;
      const filePath = await gen.writeTeamReport(metrics);
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toContain('unreviewed');
    });

    it('renders "Not configured" for not_configured codeQuality', async () => {
      const dir = await makeTempDir();
      const gen = new ReportGenerator(dir);
      const metrics = makeMetrics();
      metrics.codeQuality = {
        status: 'not_configured', retrievedAt: null, projectKey: null,
        bugs: null, vulnerabilities: null, securityHotspotsTotal: null,
        securityHotspotsReviewed: null, codeSmells: null, duplicationsPct: null,
        coveragePct: null, technicalDebtMin: null, reliabilityRating: null,
        maintainabilityRating: null, securityRating: null, qualityGate: null,
      };
      const filePath = await gen.writeTeamReport(metrics);
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toContain('Not configured');
    });

    it('renders unavailable label for failed velocity', async () => {
      const dir = await makeTempDir();
      const gen = new ReportGenerator(dir);
      const metrics = makeMetrics();
      metrics.velocity = {
        status: 'failed', retrievedAt: null, projectKey: null,
        openCritical: null, openHigh: null, openMedium: null, openLow: null,
        closedLast30Days: null, sprintName: null, sprintCompletedDate: null, sprintVelocityPts: null,
        error: { type: 'connection', tool: 'search_issues', message: 'Connection refused' },
      };
      const filePath = await gen.writeTeamReport(metrics);
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toContain('Connection refused');
    });

    it('sets file permissions to 0644', async () => {
      const dir = await makeTempDir();
      const gen = new ReportGenerator(dir);
      const filePath = await gen.writeTeamReport(makeMetrics());
      const stat = await fs.stat(filePath);
      if (process.platform !== 'win32') {
        expect(stat.mode & 0o777).toBe(0o644);
      }
    });
  });

  describe('writeSummaryReport()', () => {
    it('writes a summary file with the correct name pattern', async () => {
      const dir = await makeTempDir();
      const gen = new ReportGenerator(dir);
      const filePath = await gen.writeSummaryReport([makeMetrics()]);
      expect(filePath).toMatch(/metrics-scan-[\d-]+[/\\]summary\.md$/);
    });

    it('includes all team names in the summary', async () => {
      const dir = await makeTempDir();
      const gen = new ReportGenerator(dir);
      const m1 = makeMetrics({ team: 'team-alpha' });
      const m2 = makeMetrics({ team: 'team-beta' });
      const filePath = await gen.writeSummaryReport([m1, m2]);
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toContain('team-alpha');
      expect(content).toContain('team-beta');
    });

    it('notes team count in the summary', async () => {
      const dir = await makeTempDir();
      const gen = new ReportGenerator(dir);
      const filePath = await gen.writeSummaryReport([makeMetrics(), makeMetrics({ team: 'team-beta' })]);
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toContain('2 team(s)');
    });
  });
});
