import { McpClientSession, McpTransportConfig } from './mcp-client.js';
import { Credentials } from './config-loader.js';
import { TeamConfig, SonarQubeRaw, CollectionResult, CollectionError } from './types.js';
import {
  MCP_TIMEOUT_MS,
  RATE_LIMIT_INITIAL_DELAY_MS,
  RATE_LIMIT_MAX_DELAY_MS,
  RATE_LIMIT_MAX_ATTEMPTS,
} from './constants.js';

const SONAR_METRIC_KEYS = [
  'bugs',
  'vulnerabilities',
  'security_hotspots',
  'security_hotspots_reviewed',
  'code_smells',
  'duplicated_lines_density',
  'coverage',
  'sqale_index',
  'reliability_rating',
  'sqale_rating',
  'security_rating',
] as const;

function mapRating(value: unknown): 'A' | 'B' | 'C' | 'D' | 'E' {
  const n = typeof value === 'string' ? parseFloat(value) : Number(value);
  const map: Record<number, 'A' | 'B' | 'C' | 'D' | 'E'> = { 1: 'A', 2: 'B', 3: 'C', 4: 'D', 5: 'E' };
  return map[Math.round(n)] ?? 'E';
}

function minutesToDebtString(minutes: number): string {
  if (minutes === 0) return '0min';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

function sanitiseMessage(msg: string): string {
  return msg
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/token[=:\s]+\S+/gi, 'token=[REDACTED]')
    .replace(/Authorization[:\s]+\S+/gi, 'Authorization: [REDACTED]');
}

function classifyError(err: unknown): CollectionError['type'] {
  const msg = String(err instanceof Error ? err.message : err).toLowerCase();
  if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('forbidden')) return 'auth';
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests')) return 'rate_limited';
  if (msg.includes('404') || msg.includes('not found') || msg.includes('does not exist') || msg.includes('unknown project')) return 'not_found';
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('econnaborted')) return 'timeout';
  if (msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('network') || msg.includes('connect')) return 'connection';
  return 'unknown';
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Tool call timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SonarQubeCollector {
  private transportConfig: McpTransportConfig;
  private signal: AbortSignal;

  constructor(transportConfig: McpTransportConfig, signal: AbortSignal) {
    this.transportConfig = transportConfig;
    this.signal = signal;
  }

  async collect(team: TeamConfig, _credentials: Credentials): Promise<CollectionResult<SonarQubeRaw>> {
    const retrievedAt = new Date();
    const projectKey = team.sonarqubeProjectKey ?? '';
    const session = new McpClientSession(this.transportConfig);

    try {
      await session.connect();

      const measures = await this.callWithRetry(session, 'get_component_measures', {
        projectKey,
        metricKeys: [...SONAR_METRIC_KEYS],
      }, 'get_component_measures');

      if (!measures.ok) return { ok: false, error: measures.error, retrievedAt };

      const qualityGateResult = await this.callWithRetry(session, 'get_project_quality_gate_status', { projectKey }, 'get_project_quality_gate_status');

      if (!qualityGateResult.ok) return { ok: false, error: qualityGateResult.error, retrievedAt };

      const raw = this.parseMeasures(projectKey, measures.data, qualityGateResult.data);
      return { ok: true, data: raw, retrievedAt };
    } catch (err) {
      const type = classifyError(err);
      const message = sanitiseMessage(err instanceof Error ? err.message : String(err));
      return { ok: false, error: { type, tool: 'connect', message }, retrievedAt };
    } finally {
      await session.close().catch(() => undefined);
    }
  }

  private async callWithRetry(
    session: McpClientSession,
    toolName: string,
    args: Record<string, unknown>,
    toolLabel: string
  ): Promise<{ ok: true; data: unknown } | { ok: false; error: CollectionError }> {
    let rateLimitAttempts = 0;
    let retried = false;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (this.signal.aborted) {
        return { ok: false, error: { type: 'unknown', tool: toolLabel, message: 'Operation aborted' } };
      }

      try {
        const data = await withTimeout(session.callTool(toolName, args), MCP_TIMEOUT_MS);
        return { ok: true, data };
      } catch (err) {
        const type = classifyError(err);
        const message = sanitiseMessage(err instanceof Error ? err.message : String(err));

        if (type === 'auth') return { ok: false, error: { type, tool: toolLabel, message } };
        if (type === 'not_found') return { ok: false, error: { type, tool: toolLabel, message } };

        if (type === 'rate_limited') {
          rateLimitAttempts++;
          if (rateLimitAttempts >= RATE_LIMIT_MAX_ATTEMPTS) {
            return { ok: false, error: { type, tool: toolLabel, message } };
          }
          const delay = Math.min(RATE_LIMIT_INITIAL_DELAY_MS * Math.pow(2, rateLimitAttempts - 1), RATE_LIMIT_MAX_DELAY_MS);
          await sleep(delay);
          continue;
        }

        if ((type === 'timeout' || type === 'connection') && !retried) {
          retried = true;
          continue;
        }

        return { ok: false, error: { type, tool: toolLabel, message } };
      }
    }
  }

  private parseMeasures(projectKey: string, measuresData: unknown, qualityGateData: unknown): SonarQubeRaw {
    const measures = this.extractMeasures(measuresData);
    const getNum = (key: string): number => {
      const val = measures[key];
      return val !== undefined ? parseFloat(String(val)) || 0 : 0;
    };

    return {
      projectKey,
      bugs: getNum('bugs'),
      vulnerabilities: getNum('vulnerabilities'),
      securityHotspotsTotal: getNum('security_hotspots'),
      securityHotspotsReviewed: getNum('security_hotspots_reviewed'),
      codeSmells: getNum('code_smells'),
      duplicationsPct: getNum('duplicated_lines_density'),
      coveragePct: getNum('coverage'),
      technicalDebt: minutesToDebtString(getNum('sqale_index')),
      reliabilityRating: mapRating(measures['reliability_rating'] ?? 1),
      maintainabilityRating: mapRating(measures['sqale_rating'] ?? 1),
      securityRating: mapRating(measures['security_rating'] ?? 1),
      qualityGate: this.extractQualityGate(qualityGateData),
    };
  }

  private extractMeasures(data: unknown): Record<string, unknown> {
    if (typeof data !== 'object' || data === null) return {};
    const d = data as Record<string, unknown>;
    // SonarCloud native MCP: { component: {...}, measures: [...] } (top-level measures)
    if (Array.isArray(d['measures'])) return this.measureArrayToMap(d['measures']);
    // SonarQube self-hosted: { component: { measures: [...] } }
    if (d['component'] && typeof d['component'] === 'object') {
      const comp = d['component'] as Record<string, unknown>;
      if (Array.isArray(comp['measures'])) return this.measureArrayToMap(comp['measures']);
    }
    return {};
  }

  private measureArrayToMap(measures: unknown[]): Record<string, unknown> {
    const map: Record<string, unknown> = {};
    for (const m of measures) {
      if (typeof m === 'object' && m !== null) {
        const entry = m as Record<string, unknown>;
        if (typeof entry['metric'] === 'string') {
          map[entry['metric']] = entry['value'];
        }
      }
    }
    return map;
  }

  private extractQualityGate(data: unknown): 'OK' | 'ERROR' | 'WARN' | 'NONE' {
    if (typeof data !== 'object' || data === null) return 'NONE';
    const d = data as Record<string, unknown>;
    // SonarQube self-hosted: { projectStatus: { status } }
    if (d['projectStatus'] && typeof d['projectStatus'] === 'object') {
      const ps = d['projectStatus'] as Record<string, unknown>;
      const status = String(ps['status'] ?? '').toUpperCase();
      if (status === 'OK' || status === 'ERROR' || status === 'WARN') return status as 'OK' | 'ERROR' | 'WARN';
    }
    // SonarCloud native MCP: { status, conditions }
    const status = String(d['status'] ?? '').toUpperCase();
    if (status === 'OK' || status === 'ERROR' || status === 'WARN') return status as 'OK' | 'ERROR' | 'WARN';
    return 'NONE';
  }
}
