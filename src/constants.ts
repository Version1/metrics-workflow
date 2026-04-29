// Core constants for the Dev Metrics Agent

export const SCHEMA_VERSION = '1.0.0';

/** Sentinel hash used as previousHash for the first entry in a new audit log. */
export const AUDIT_GENESIS_HASH = 'sha256:genesis:v1';

/** Default output paths (relative to workspace root). */
export const DEFAULT_OUTPUT = {
  reportsDir: 'quality-metrics/reports',
  auditDir: 'quality-metrics/audit',
  schemaFile: '.kiro/specs/metrics-workflow/standard-schema.json',
  schedulerState: '.kiro/specs/metrics-workflow/scheduler-state.json',
  integrationGuide: '.kiro/specs/metrics-workflow/integration-guide.md',
} as const;

/** Process exit codes. */
export const EXIT_CODES = {
  /** All metrics retrieved successfully. */
  SUCCESS: 0,
  /** Some metrics retrieved, some failed. */
  PARTIAL_FAILURE: 1,
  /** No metrics retrieved — all collection failed. */
  TOTAL_FAILURE: 2,
  /** Configuration or governance error — no collection attempted. */
  CONFIG_ERROR: 3,
} as const;

/**
 * Threshold values used by ReportGenerator to flag out-of-range metrics.
 * A metric is flagged when its value exceeds (or falls below) the threshold.
 */
export const THRESHOLDS = {
  /** Flag when bugs > 0 */
  bugs: 0,
  /** Flag when vulnerabilities > 0 */
  vulnerabilities: 0,
  /** Flag when openCritical > 0 */
  openCritical: 0,
  /** Flag when coveragePct < 80 */
  coveragePctMin: 80,
  /** Flag when duplicationsPct > 3 */
  duplicationsPctMax: 3,
  /** Flag when reliabilityRating is D or E */
  ratingThreshold: ['D', 'E'] as ('A' | 'B' | 'C' | 'D' | 'E')[],
} as const;

/** MCP tool call timeout in milliseconds. */
export const MCP_TIMEOUT_MS = 30_000;

/** Maximum retry attempts for rate-limited (429) responses. */
export const RATE_LIMIT_MAX_ATTEMPTS = 3;

/** Initial back-off delay in milliseconds for rate-limited responses. */
export const RATE_LIMIT_INITIAL_DELAY_MS = 1_000;

/** Maximum back-off delay in milliseconds for rate-limited responses. */
export const RATE_LIMIT_MAX_DELAY_MS = 60_000;
