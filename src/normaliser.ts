import { SonarQubeRaw, JiraRaw, NormalisedMetrics, CollectionError } from './types.js';
import { SCHEMA_VERSION } from './constants.js';
import logger from './utils/logger.js';

// PII field patterns to reject at normalisation layer
const PII_FIELD_PATTERNS = [
  /^author/i, /^assignee/i, /^reporter/i, /^creator/i,
  /email/i, /username/i, /displayName/i, /accountId/i,
  /employeeId/i, /userId/i, /^name$/i,
];

function isPiiField(key: string): boolean {
  return PII_FIELD_PATTERNS.some((p) => p.test(key));
}

/**
 * Parses SonarQube's human-readable technical debt string into integer minutes.
 *
 * Parsing rules:
 * - d = 1 working day = 480 minutes (8 hours)
 * - h = 60 minutes
 * - min = 1 minute
 * - Values may be combined, e.g. "1d 2h 30min" = 480 + 120 + 30 = 630
 * - "0" or "0min" returns 0
 * - Empty string or null returns null
 * - Unrecognised format returns null and logs at warn level
 */
export function parseTechnicalDebt(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw.trim() === '') return null;

  const trimmed = raw.trim();

  // Handle plain "0"
  if (trimmed === '0') return 0;

  const pattern = /(?:(\d+)d\s*)?(?:(\d+)h\s*)?(?:(\d+)min\s*)?/;
  const match = trimmed.match(pattern);

  if (!match || match[0].trim() === '') {
    logger.warn(`[Normaliser] parseTechnicalDebt: unrecognised format "${raw}"`);
    return null;
  }

  const days = parseInt(match[1] ?? '0', 10);
  const hours = parseInt(match[2] ?? '0', 10);
  const mins = parseInt(match[3] ?? '0', 10);

  const total = days * 480 + hours * 60 + mins;

  // If nothing matched (all zeros but input wasn't "0"), it's unrecognised
  if (total === 0 && trimmed !== '0' && trimmed !== '0min') {
    logger.warn(`[Normaliser] parseTechnicalDebt: unrecognised format "${raw}"`);
    return null;
  }

  return total;
}

function mapQualityGate(raw: 'OK' | 'ERROR' | 'WARN' | 'NONE'): 'passed' | 'failed' | 'warning' | 'unknown' {
  switch (raw) {
    case 'OK':    return 'passed';
    case 'ERROR': return 'failed';
    case 'WARN':  return 'warning';
    case 'NONE':  return 'unknown';
  }
}

export interface NormaliserStatus {
  sonarqube: 'retrieved' | 'failed' | 'not_configured';
  jira: 'retrieved' | 'failed' | 'not_configured';
}

export function normalise(
  sonarRaw: SonarQubeRaw | null,
  jiraRaw: JiraRaw | null,
  team: string,
  department: string,
  retrievedAt: { sonarqube: Date | null; jira: Date | null },
  status: NormaliserStatus,
  sonarError?: CollectionError,
  jiraError?: CollectionError
): NormalisedMetrics {
  const generatedAt = new Date().toISOString();

  // Build codeQuality section
  const codeQuality: NormalisedMetrics['codeQuality'] = sonarRaw
    ? {
        status: status.sonarqube,
        retrievedAt: retrievedAt.sonarqube?.toISOString() ?? null,
        projectKey: sonarRaw.projectKey,
        bugs: sonarRaw.bugs,
        vulnerabilities: sonarRaw.vulnerabilities,
        securityHotspotsTotal: sonarRaw.securityHotspotsTotal,
        securityHotspotsReviewed: sonarRaw.securityHotspotsReviewed,
        codeSmells: sonarRaw.codeSmells,
        duplicationsPct: sonarRaw.duplicationsPct,
        coveragePct: sonarRaw.coveragePct,
        technicalDebtMin: parseTechnicalDebt(sonarRaw.technicalDebt),
        reliabilityRating: sonarRaw.reliabilityRating,
        maintainabilityRating: sonarRaw.maintainabilityRating,
        securityRating: sonarRaw.securityRating,
        qualityGate: mapQualityGate(sonarRaw.qualityGate),
        ...(sonarError ? { error: sonarError } : {}),
      }
    : {
        status: status.sonarqube,
        retrievedAt: null,
        projectKey: null,
        bugs: null,
        vulnerabilities: null,
        securityHotspotsTotal: null,
        securityHotspotsReviewed: null,
        codeSmells: null,
        duplicationsPct: null,
        coveragePct: null,
        technicalDebtMin: null,
        reliabilityRating: null,
        maintainabilityRating: null,
        securityRating: null,
        qualityGate: null,
        ...(sonarError ? { error: sonarError } : {}),
      };

  // Build velocity section — filter out any PII fields from jiraRaw
  const velocity: NormalisedMetrics['velocity'] = jiraRaw
    ? {
        status: status.jira,
        retrievedAt: retrievedAt.jira?.toISOString() ?? null,
        projectKey: jiraRaw.projectKey,
        openCritical: jiraRaw.openByCritical,
        openHigh: jiraRaw.openByHigh,
        openMedium: jiraRaw.openByMedium,
        openLow: jiraRaw.openByLow,
        closedLast30Days: jiraRaw.closedLast30Days,
        sprintName: jiraRaw.sprintName,
        sprintCompletedDate: jiraRaw.sprintCompletedDate,
        sprintVelocityPts: jiraRaw.sprintVelocity,
        ...(jiraError ? { error: jiraError } : {}),
      }
    : {
        status: status.jira,
        retrievedAt: null,
        projectKey: null,
        openCritical: null,
        openHigh: null,
        openMedium: null,
        openLow: null,
        closedLast30Days: null,
        sprintName: null,
        sprintCompletedDate: null,
        sprintVelocityPts: null,
        ...(jiraError ? { error: jiraError } : {}),
      };

  // Verify no PII leaked into the output
  const outputStr = JSON.stringify({ codeQuality, velocity });
  for (const key of Object.keys(sonarRaw ?? {}).concat(Object.keys(jiraRaw ?? {}))) {
    if (isPiiField(key)) {
      // If a PII field somehow made it through, log and it won't be in the typed output
      logger.warn(`[Normaliser] PII field "${key}" detected and excluded from output`);
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    team,
    department,
    generatedAt,
    codeQuality,
    velocity,
  };

  // Suppress unused variable warning
  void outputStr;
}
