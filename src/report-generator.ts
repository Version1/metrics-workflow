import { promises as fs } from 'fs';
import * as path from 'path';
import { NormalisedMetrics } from './types.js';
import { THRESHOLDS } from './constants.js';

const FLAG = '⚠️ **';
const FLAG_END = '**';

function flag(value: string): string {
  return `${FLAG}${value}${FLAG_END}`;
}

function ratingFlag(rating: string | null): string {
  if (!rating) return 'N/A';
  if (THRESHOLDS.ratingThreshold.includes(rating as 'D' | 'E')) return flag(rating);
  return rating;
}

function numFlag(value: number | null, threshold: number, above: boolean): string {
  if (value === null) return 'N/A';
  const exceeded = above ? value > threshold : value < threshold;
  return exceeded ? flag(String(value)) : String(value);
}

function pctFlag(value: number | null, threshold: number, above: boolean): string {
  if (value === null) return 'N/A';
  const exceeded = above ? value > threshold : value < threshold;
  const formatted = `${value.toFixed(1)}%`;
  return exceeded ? flag(formatted) : formatted;
}

function qualityGateFlag(qg: string | null): string {
  if (!qg) return 'N/A';
  if (qg === 'failed') return flag(qg.toUpperCase());
  return qg.toUpperCase();
}

function hotspotsFlag(total: number | null, reviewed: number | null): string {
  if (total === null || reviewed === null) return 'N/A';
  const unreviewed = total - reviewed;
  const formatted = `${reviewed}/${total} reviewed`;
  return unreviewed > 0 ? flag(formatted + ` (${unreviewed} unreviewed)`) : formatted;
}

function formatDate(iso: string | null): string {
  if (!iso) return 'N/A';
  return iso.replace('T', ' ').replace(/\.\d+Z$/, ' UTC').replace('Z', ' UTC');
}

function renderCodeQualitySection(cq: NormalisedMetrics['codeQuality']): string {
  if (cq.status === 'not_configured') {
    return '## Code Quality\n\n> Not configured — SonarQube is not enabled for this deployment.\n';
  }
  if (cq.status === 'failed') {
    const errMsg = cq.error ? `Error: ${cq.error.message}` : 'Data unavailable';
    return `## Code Quality\n\n> ⚠️ ${errMsg}\n`;
  }

  return `## Code Quality

| Metric | Value |
|--------|-------|
| Quality Gate | ${qualityGateFlag(cq.qualityGate)} |
| Bugs | ${numFlag(cq.bugs, THRESHOLDS.bugs, true)} |
| Vulnerabilities | ${numFlag(cq.vulnerabilities, THRESHOLDS.vulnerabilities, true)} |
| Security Hotspots | ${hotspotsFlag(cq.securityHotspotsTotal, cq.securityHotspotsReviewed)} |
| Code Smells | ${cq.codeSmells ?? 'N/A'} |
| Duplications | ${pctFlag(cq.duplicationsPct, THRESHOLDS.duplicationsPctMax, true)} |
| Coverage | ${pctFlag(cq.coveragePct, THRESHOLDS.coveragePctMin, false)} |
| Technical Debt | ${cq.technicalDebtMin !== null ? `${cq.technicalDebtMin} min` : 'N/A'} |
| Reliability Rating | ${ratingFlag(cq.reliabilityRating)} |
| Maintainability Rating | ${ratingFlag(cq.maintainabilityRating)} |
| Security Rating | ${ratingFlag(cq.securityRating)} |

_Retrieved at: ${formatDate(cq.retrievedAt)}_
`;
}

function renderVelocitySection(v: NormalisedMetrics['velocity']): string {
  if (v.status === 'not_configured') {
    return '## Issue Tracking & Velocity\n\n> Not configured — Jira is not enabled for this deployment.\n';
  }
  if (v.status === 'failed') {
    const errMsg = v.error ? `Error: ${v.error.message}` : 'Data unavailable';
    return `## Issue Tracking & Velocity\n\n> ⚠️ ${errMsg}\n`;
  }

  const sprintInfo = v.sprintName
    ? `${v.sprintName} (completed: ${formatDate(v.sprintCompletedDate)})`
    : '_No closed sprint found_';

  return `## Issue Tracking & Velocity

| Metric | Value |
|--------|-------|
| Open Issues — Critical | ${numFlag(v.openCritical, THRESHOLDS.openCritical, true)} |
| Open Issues — High | ${v.openHigh ?? 'N/A'} |
| Open Issues — Medium | ${v.openMedium ?? 'N/A'} |
| Open Issues — Low | ${v.openLow ?? 'N/A'} |
| Closed (last 30 days) | ${v.closedLast30Days ?? 'N/A'} |
| Sprint | ${sprintInfo} |
| Sprint Velocity | ${v.sprintVelocityPts !== null ? `${v.sprintVelocityPts} pts` : '_No data_'} |

_Retrieved at: ${formatDate(v.retrievedAt)}_
`;
}

function renderSummaryFlags(metrics: NormalisedMetrics): string[] {
  const flags: string[] = [];
  const cq = metrics.codeQuality;
  const v = metrics.velocity;

  if (cq.status === 'retrieved') {
    if (cq.qualityGate === 'failed') flags.push('Quality gate FAILED');
    if ((cq.bugs ?? 0) > 0) flags.push(`${cq.bugs} bug(s)`);
    if ((cq.vulnerabilities ?? 0) > 0) flags.push(`${cq.vulnerabilities} vulnerability/ies`);
    if (cq.securityHotspotsTotal !== null && cq.securityHotspotsReviewed !== null) {
      const unreviewed = cq.securityHotspotsTotal - cq.securityHotspotsReviewed;
      if (unreviewed > 0) flags.push(`${unreviewed} unreviewed security hotspot(s)`);
    }
    if (cq.coveragePct !== null && cq.coveragePct < THRESHOLDS.coveragePctMin) {
      flags.push(`Coverage ${cq.coveragePct.toFixed(1)}% (below ${THRESHOLDS.coveragePctMin}%)`);
    }
    if (cq.duplicationsPct !== null && cq.duplicationsPct > THRESHOLDS.duplicationsPctMax) {
      flags.push(`Duplications ${cq.duplicationsPct.toFixed(1)}% (above ${THRESHOLDS.duplicationsPctMax}%)`);
    }
    if (cq.reliabilityRating && THRESHOLDS.ratingThreshold.includes(cq.reliabilityRating as 'D' | 'E')) {
      flags.push(`Reliability rating ${cq.reliabilityRating}`);
    }
    if (cq.securityRating && THRESHOLDS.ratingThreshold.includes(cq.securityRating as 'D' | 'E')) {
      flags.push(`Security rating ${cq.securityRating}`);
    }
  }

  if (v.status === 'retrieved') {
    if ((v.openCritical ?? 0) > 0) flags.push(`${v.openCritical} critical open issue(s)`);
  }

  return flags;
}

export class ReportGenerator {
  private reportsDir: string;
  private scanDir: string;

  constructor(reportsDir: string, scanTimestamp?: string) {
    this.reportsDir = reportsDir;
    const ts = (scanTimestamp ?? new Date().toISOString())
      .slice(0, 19).replace('T', '-').replace(/:/g, '-'); // YYYY-MM-DD-HH-MM-SS
    this.scanDir = path.join(reportsDir, `metrics-scan-${ts}`);
  }

  /**
   * Pre-flight check: creates and immediately deletes a sentinel file in reportsDir.
   * Throws with a descriptive error if the directory is not writable.
   */
  async checkOutputWritable(): Promise<void> {
    await fs.mkdir(this.reportsDir, { recursive: true });
    const sentinel = path.join(this.reportsDir, `.write-check-${Date.now()}`);
    try {
      await fs.writeFile(sentinel, '', { mode: 0o644 });
      await fs.unlink(sentinel);
    } catch (err) {
      throw new Error(
        `Output directory "${this.reportsDir}" is not writable: ${(err as Error).message}. ` +
        'Check directory permissions before running the agent.'
      );
    }
  }

  /**
   * Renders a NormalisedMetrics object into a Markdown team report.
   * Returns the file path written.
   */
  async writeTeamReport(metrics: NormalisedMetrics): Promise<string> {
    const teamSlug = metrics.team.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const filePath = path.join(this.scanDir, `${teamSlug}.md`);

    const flags = renderSummaryFlags(metrics);
    const summarySection = flags.length > 0
      ? `## Summary\n\n> ⚠️ Attention required:\n${flags.map((f) => `> - ${f}`).join('\n')}\n`
      : `## Summary\n\n> ✅ No threshold violations detected.\n`;

    const content = [
      `# Dev Metrics Report — ${metrics.team}`,
      '',
      `**Department:** ${metrics.department}  `,
      `**Generated:** ${formatDate(metrics.generatedAt)}  `,
      `**Schema version:** ${metrics.schemaVersion}`,
      '',
      '---',
      '',
      summarySection,
      '',
      renderCodeQualitySection(metrics.codeQuality),
      '',
      renderVelocitySection(metrics.velocity),
    ].join('\n');

    await fs.mkdir(this.scanDir, { recursive: true });
    await fs.writeFile(filePath, content, { encoding: 'utf-8', mode: 0o644 });

    return filePath;
  }

  /**
   * Renders a consolidated summary report for all teams.
   * Returns the file path written.
   */
  async writeSummaryReport(allMetrics: NormalisedMetrics[]): Promise<string> {
    const filePath = path.join(this.scanDir, 'summary.md');

    const now = new Date().toISOString();
    const date = now.slice(0, 10);
    const rows = allMetrics.map((m) => {
      const cq = m.codeQuality;
      const v = m.velocity;
      const flags = renderSummaryFlags(m);
      const flagStr = flags.length > 0 ? `⚠️ ${flags.join('; ')}` : '✅ OK';

      const qg = cq.status === 'retrieved' ? qualityGateFlag(cq.qualityGate) : cq.status;
      const coverage = cq.status === 'retrieved' ? pctFlag(cq.coveragePct, THRESHOLDS.coveragePctMin, false) : cq.status;
      const critical = v.status === 'retrieved' ? numFlag(v.openCritical, THRESHOLDS.openCritical, true) : v.status;
      const velocity = v.status === 'retrieved' ? (v.sprintVelocityPts !== null ? `${v.sprintVelocityPts} pts` : 'N/A') : v.status;

      return `| ${m.team} | ${qg} | ${coverage} | ${critical} | ${velocity} | ${flagStr} |`;
    });

    const content = [
      `# Dev Metrics Summary — ${date}`,
      '',
      `_Generated: ${new Date().toISOString()}_`,
      '',
      '| Team | Quality Gate | Coverage | Critical Issues | Sprint Velocity | Status |',
      '|------|-------------|----------|-----------------|-----------------|--------|',
      ...rows,
      '',
      `_${allMetrics.length} team(s) included in this report._`,
    ].join('\n');

    await fs.mkdir(this.scanDir, { recursive: true });
    await fs.writeFile(filePath, content, { encoding: 'utf-8', mode: 0o644 });

    return filePath;
  }
}
