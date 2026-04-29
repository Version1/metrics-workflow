import { describe, it, expect, vi } from 'vitest';
import { parseTechnicalDebt, normalise, NormaliserStatus } from '../src/normaliser.js';
import { SonarQubeRaw, JiraRaw } from '../src/types.js';
import { SCHEMA_VERSION } from '../src/constants.js';

// ---------------------------------------------------------------------------
// parseTechnicalDebt unit tests
// ---------------------------------------------------------------------------

describe('parseTechnicalDebt()', () => {
  it('parses single-unit "2h"', () => expect(parseTechnicalDebt('2h')).toBe(120));
  it('parses single-unit "30min"', () => expect(parseTechnicalDebt('30min')).toBe(30));
  it('parses single-unit "1d"', () => expect(parseTechnicalDebt('1d')).toBe(480));
  it('parses combined "1d 2h 30min"', () => expect(parseTechnicalDebt('1d 2h 30min')).toBe(630));
  it('parses combined "2h 30min"', () => expect(parseTechnicalDebt('2h 30min')).toBe(150));
  it('parses "0"', () => expect(parseTechnicalDebt('0')).toBe(0));
  it('parses "0min"', () => expect(parseTechnicalDebt('0min')).toBe(0));
  it('returns null for empty string', () => expect(parseTechnicalDebt('')).toBeNull());
  it('returns null for null', () => expect(parseTechnicalDebt(null)).toBeNull());
  it('returns null for undefined', () => expect(parseTechnicalDebt(undefined)).toBeNull());
  it('returns null for unrecognised format', () => {
    expect(parseTechnicalDebt('2 hours')).toBeNull();
  });
  it('parses "5d" correctly', () => expect(parseTechnicalDebt('5d')).toBe(2400));
  it('parses "1h 1min"', () => expect(parseTechnicalDebt('1h 1min')).toBe(61));
});

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const SONAR_RAW: SonarQubeRaw = {
  projectKey: 'org.example:alpha',
  bugs: 3,
  vulnerabilities: 1,
  securityHotspotsTotal: 5,
  securityHotspotsReviewed: 2,
  codeSmells: 12,
  duplicationsPct: 4.2,
  coveragePct: 75.5,
  technicalDebt: '2h 30min',
  reliabilityRating: 'B',
  maintainabilityRating: 'A',
  securityRating: 'C',
  qualityGate: 'ERROR',
};

const JIRA_RAW: JiraRaw = {
  projectKey: 'ALPHA',
  openByCritical: 2,
  openByHigh: 5,
  openByMedium: 8,
  openByLow: 3,
  closedLast30Days: 14,
  sprintName: 'Sprint 10',
  sprintCompletedDate: '2024-01-15T00:00:00Z',
  sprintVelocity: 38,
};

const STATUS_BOTH: NormaliserStatus = { sonarqube: 'retrieved', jira: 'retrieved' };
const RETRIEVED_AT = { sonarqube: new Date('2024-01-20T10:00:00Z'), jira: new Date('2024-01-20T10:01:00Z') };

// ---------------------------------------------------------------------------
// normalise() unit tests
// ---------------------------------------------------------------------------

describe('normalise()', () => {
  it('produces NormalisedMetrics with correct schemaVersion', () => {
    const result = normalise(SONAR_RAW, JIRA_RAW, 'team-alpha', 'Engineering', RETRIEVED_AT, STATUS_BOTH);
    expect(result.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('maps SonarQube fields correctly', () => {
    const result = normalise(SONAR_RAW, JIRA_RAW, 'team-alpha', 'Engineering', RETRIEVED_AT, STATUS_BOTH);
    const cq = result.codeQuality;
    expect(cq.status).toBe('retrieved');
    expect(cq.projectKey).toBe('org.example:alpha');
    expect(cq.bugs).toBe(3);
    expect(cq.vulnerabilities).toBe(1);
    expect(cq.securityHotspotsTotal).toBe(5);
    expect(cq.securityHotspotsReviewed).toBe(2);
    expect(cq.codeSmells).toBe(12);
    expect(cq.duplicationsPct).toBeCloseTo(4.2);
    expect(cq.coveragePct).toBeCloseTo(75.5);
    expect(cq.technicalDebtMin).toBe(150);
    expect(cq.reliabilityRating).toBe('B');
    expect(cq.maintainabilityRating).toBe('A');
    expect(cq.securityRating).toBe('C');
    expect(cq.qualityGate).toBe('failed');
  });

  it('maps qualityGate OK → passed', () => {
    const result = normalise({ ...SONAR_RAW, qualityGate: 'OK' }, null, 'team', 'Dept',
      { sonarqube: new Date(), jira: null }, { sonarqube: 'retrieved', jira: 'not_configured' });
    expect(result.codeQuality.qualityGate).toBe('passed');
  });

  it('maps qualityGate WARN → warning', () => {
    const result = normalise({ ...SONAR_RAW, qualityGate: 'WARN' }, null, 'team', 'Dept',
      { sonarqube: new Date(), jira: null }, { sonarqube: 'retrieved', jira: 'not_configured' });
    expect(result.codeQuality.qualityGate).toBe('warning');
  });

  it('maps qualityGate NONE → unknown', () => {
    const result = normalise({ ...SONAR_RAW, qualityGate: 'NONE' }, null, 'team', 'Dept',
      { sonarqube: new Date(), jira: null }, { sonarqube: 'retrieved', jira: 'not_configured' });
    expect(result.codeQuality.qualityGate).toBe('unknown');
  });

  it('maps Jira fields correctly', () => {
    const result = normalise(SONAR_RAW, JIRA_RAW, 'team-alpha', 'Engineering', RETRIEVED_AT, STATUS_BOTH);
    const v = result.velocity;
    expect(v.status).toBe('retrieved');
    expect(v.projectKey).toBe('ALPHA');
    expect(v.openCritical).toBe(2);
    expect(v.openHigh).toBe(5);
    expect(v.openMedium).toBe(8);
    expect(v.openLow).toBe(3);
    expect(v.closedLast30Days).toBe(14);
    expect(v.sprintName).toBe('Sprint 10');
    expect(v.sprintCompletedDate).toBe('2024-01-15T00:00:00Z');
    expect(v.sprintVelocityPts).toBe(38);
  });

  it('sets codeQuality to null fields when sonarRaw is null', () => {
    const result = normalise(null, JIRA_RAW, 'team', 'Dept',
      { sonarqube: null, jira: new Date() }, { sonarqube: 'not_configured', jira: 'retrieved' });
    expect(result.codeQuality.status).toBe('not_configured');
    expect(result.codeQuality.bugs).toBeNull();
    expect(result.codeQuality.qualityGate).toBeNull();
  });

  it('sets velocity to null fields when jiraRaw is null', () => {
    const result = normalise(SONAR_RAW, null, 'team', 'Dept',
      { sonarqube: new Date(), jira: null }, { sonarqube: 'retrieved', jira: 'not_configured' });
    expect(result.velocity.status).toBe('not_configured');
    expect(result.velocity.openCritical).toBeNull();
    expect(result.velocity.sprintVelocityPts).toBeNull();
  });

  it('does not throw when both inputs are null', () => {
    expect(() =>
      normalise(null, null, 'team', 'Dept',
        { sonarqube: null, jira: null }, { sonarqube: 'not_configured', jira: 'not_configured' })
    ).not.toThrow();
  });

  it('includes error in codeQuality when sonarError is provided', () => {
    const error = { type: 'auth' as const, tool: 'get_component_measures', message: 'Unauthorized' };
    const result = normalise(null, JIRA_RAW, 'team', 'Dept',
      { sonarqube: null, jira: new Date() }, { sonarqube: 'failed', jira: 'retrieved' }, error);
    expect(result.codeQuality.error).toEqual(error);
  });

  it('sets team and department correctly', () => {
    const result = normalise(SONAR_RAW, JIRA_RAW, 'my-team', 'My Department', RETRIEVED_AT, STATUS_BOTH);
    expect(result.team).toBe('my-team');
    expect(result.department).toBe('My Department');
  });

  it('output does not contain PII field names', () => {
    const result = normalise(SONAR_RAW, JIRA_RAW, 'team', 'Dept', RETRIEVED_AT, STATUS_BOTH);
    const outputStr = JSON.stringify(result);
    const piiFields = ['email', 'username', 'displayName', 'accountId', 'employeeId'];
    for (const field of piiFields) {
      expect(outputStr).not.toContain(`"${field}"`);
    }
  });
});
