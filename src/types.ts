// Shared TypeScript interfaces for the Dev Metrics Agent

export interface AgentConfig {
  sonarqube?: { serverUrl: string };
  jira?: { serverUrl: string };
  teams: TeamConfig[];
  schedule?: { interval: 'daily' | 'weekly' | 'per-sprint'; time: string };
  alerting?: { workstreamLeadContact: string };
  department: DepartmentConfig;
  output?: {
    reportsDir: string;
    auditDir: string;
    schemaFile: string;
    schedulerState: string;
    integrationGuide: string;
  };
}

export interface TeamConfig {
  name: string;
  sonarqubeProjectKey?: string;
  jiraProjectKey?: string;
}

export interface DepartmentConfig {
  name: string;
  onboarding?: OnboardingRecord;
}

export interface OnboardingRecord {
  approvedBy: string;
  approverRole: string;
  approvedAt: string; // ISO 8601
  dataScope: ('codeQuality' | 'velocity')[];
}

export interface SonarQubeRaw {
  projectKey: string;
  bugs: number;
  vulnerabilities: number;
  securityHotspotsTotal: number;
  securityHotspotsReviewed: number;
  codeSmells: number;
  duplicationsPct: number; // 0–100
  coveragePct: number; // 0–100
  technicalDebt: string; // e.g. "2h 30min"
  reliabilityRating: 'A' | 'B' | 'C' | 'D' | 'E';
  maintainabilityRating: 'A' | 'B' | 'C' | 'D' | 'E';
  securityRating: 'A' | 'B' | 'C' | 'D' | 'E';
  qualityGate: 'OK' | 'ERROR' | 'WARN' | 'NONE';
}

export interface JiraRaw {
  projectKey: string;
  openByCritical: number;
  openByHigh: number;
  openByMedium: number;
  openByLow: number;
  closedLast30Days: number;
  sprintName: string | null;
  sprintCompletedDate: string | null; // ISO 8601
  sprintVelocity: number | null; // story points
}

export interface CollectionError {
  type: 'connection' | 'timeout' | 'not_found' | 'auth' | 'rate_limited' | 'unknown';
  tool: string;
  message: string; // sanitised — no credentials
}

export type CollectionResult<T> =
  | { ok: true; data: T; retrievedAt: Date }
  | { ok: false; error: CollectionError; retrievedAt: Date };

export interface NormalisedMetrics {
  schemaVersion: string;
  team: string;
  department: string;
  generatedAt: string; // ISO 8601

  codeQuality: {
    status: 'retrieved' | 'failed' | 'not_configured';
    retrievedAt: string | null;
    projectKey: string | null;
    bugs: number | null;
    vulnerabilities: number | null;
    securityHotspotsTotal: number | null;
    securityHotspotsReviewed: number | null;
    codeSmells: number | null;
    duplicationsPct: number | null;
    coveragePct: number | null;
    technicalDebtMin: number | null; // normalised to minutes
    reliabilityRating: 'A' | 'B' | 'C' | 'D' | 'E' | null;
    maintainabilityRating: 'A' | 'B' | 'C' | 'D' | 'E' | null;
    securityRating: 'A' | 'B' | 'C' | 'D' | 'E' | null;
    qualityGate: 'passed' | 'failed' | 'warning' | 'unknown' | null;
    error?: CollectionError;
  };

  velocity: {
    status: 'retrieved' | 'failed' | 'not_configured';
    retrievedAt: string | null;
    projectKey: string | null;
    openCritical: number | null;
    openHigh: number | null;
    openMedium: number | null;
    openLow: number | null;
    closedLast30Days: number | null;
    sprintName: string | null;
    sprintCompletedDate: string | null;
    sprintVelocityPts: number | null;
    error?: CollectionError;
  };
}

export interface RunSummary {
  startedAt: string; // ISO 8601
  completedAt: string; // ISO 8601
  durationMs: number;
  teamsAttempted: number;
  teamsSucceeded: number;
  teamsFailed: number;
  metricsRetrieved: { team: string; sonarqube: boolean; jira: boolean }[];
  exitCode: 0 | 1 | 2 | 3;
}

// Phase 2 types (added here for completeness; used in governance and audit tasks)

export interface AuditEntry {
  timestamp: string; // ISO 8601
  department: string;
  source: 'sonarqube' | 'jira' | 'agent';
  event: string;
  credentialId: string; // identifier only, never the token value
  fields?: string[];
  userId?: string;
  outcome: 'success' | 'failure' | 'warning';
  detail?: string;
  previousHash: string;
  entryHash: string;
}

export interface SchedulerState {
  lastRunAt: string; // ISO 8601
  lastRunOutcome: 'success' | 'failure';
}

export type VerificationResult =
  | { ok: true }
  | { ok: false; reason: string };

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface FailureAlert {
  department: string;
  source: 'sonarqube' | 'jira';
  failedAt: Date;
  description: string; // sanitised
  alertType: 'collection_failure' | 'credential_expiry_warning';
}
