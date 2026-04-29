import { promises as fs } from 'fs';
import { AgentConfig, ValidationResult } from './types.js';
import { DEFAULT_OUTPUT } from './constants.js';

export interface Credentials {
  sonarqubeToken?: string;
  jiraToken?: string;
}

export interface ResolvedConfig {
  config: AgentConfig;
  credentials: Credentials;
}

const VALID_INTERVALS = ['daily', 'weekly', 'per-sprint'] as const;

export function validate(raw: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { valid: false, errors: ['Config must be a JSON object'] };
  }

  const obj = raw as Record<string, unknown>;

  // Halt immediately if token fields are detected in the config file
  if (obj['sonarqube'] && typeof obj['sonarqube'] === 'object') {
    const sq = obj['sonarqube'] as Record<string, unknown>;
    if (sq['token'] !== undefined && sq['token'] !== '') {
      throw new Error(
        'Security violation: "sonarqube.token" was found in the config file. ' +
        'Credentials must be supplied via the SONARQUBE_TOKEN environment variable only. ' +
        'Remove the token field from config.json immediately. ' +
        'If this file is tracked by Git, rotate the credential and remove it from history ' +
        'using git filter-repo (https://github.com/newren/git-filter-repo).'
      );
    }
  }

  if (obj['jira'] && typeof obj['jira'] === 'object') {
    const jira = obj['jira'] as Record<string, unknown>;
    if (jira['token'] !== undefined && jira['token'] !== '') {
      throw new Error(
        'Security violation: "jira.token" was found in the config file. ' +
        'Credentials must be supplied via the JIRA_TOKEN environment variable only. ' +
        'Remove the token field from config.json immediately. ' +
        'If this file is tracked by Git, rotate the credential and remove it from history ' +
        'using git filter-repo (https://github.com/newren/git-filter-repo).'
      );
    }
  }

  // At least one of sonarqube or jira must be present
  const hasSonarqube = obj['sonarqube'] !== undefined;
  const hasJira = obj['jira'] !== undefined;

  if (!hasSonarqube && !hasJira) {
    errors.push('At least one of "sonarqube" or "jira" must be present in the configuration.');
  }

  // Validate sonarqube block
  if (hasSonarqube) {
    if (typeof obj['sonarqube'] !== 'object' || obj['sonarqube'] === null) {
      errors.push('"sonarqube" must be an object.');
    } else {
      const sq = obj['sonarqube'] as Record<string, unknown>;
      if (typeof sq['serverUrl'] !== 'string' || !sq['serverUrl']) {
        errors.push('"sonarqube.serverUrl" is required.');
      } else if (!sq['serverUrl'].startsWith('https://') && !sq['serverUrl'].startsWith('stdio://')) {
        errors.push(`"sonarqube.serverUrl" must start with "https://" or "stdio://" (got "${sq['serverUrl']}").`);
      }
    }
  }

  // Validate jira block
  if (hasJira) {
    if (typeof obj['jira'] !== 'object' || obj['jira'] === null) {
      errors.push('"jira" must be an object.');
    } else {
      const jira = obj['jira'] as Record<string, unknown>;
      if (typeof jira['serverUrl'] !== 'string' || !jira['serverUrl']) {
        errors.push('"jira.serverUrl" is required.');
      } else if (!jira['serverUrl'].startsWith('https://')) {
        errors.push(`"jira.serverUrl" must start with "https://" (got "${jira['serverUrl']}").`);
      }
    }
  }

  // Validate department
  if (obj['department'] === undefined) {
    errors.push('"department" is required.');
  } else if (typeof obj['department'] !== 'object' || obj['department'] === null) {
    errors.push('"department" must be an object.');
  } else {
    const dept = obj['department'] as Record<string, unknown>;
    if (typeof dept['name'] !== 'string' || !dept['name']) {
      errors.push('"department.name" is required.');
    }
  }

  // Validate teams
  if (!Array.isArray(obj['teams'])) {
    errors.push('"teams" must be an array.');
  } else {
    const teams = obj['teams'] as unknown[];
    if (teams.length === 0) {
      errors.push('"teams" must contain at least one team.');
    }
    teams.forEach((team, i) => {
      if (typeof team !== 'object' || team === null) {
        errors.push(`"teams[${i}]" must be an object.`);
        return;
      }
      const t = team as Record<string, unknown>;
      if (typeof t['name'] !== 'string' || !t['name']) {
        errors.push(`"teams[${i}].name" is required.`);
      }
      if (hasSonarqube && errors.every(e => !e.includes('"sonarqube"'))) {
        if (typeof t['sonarqubeProjectKey'] !== 'string' || !t['sonarqubeProjectKey']) {
          errors.push(
            `"teams[${i}].sonarqubeProjectKey" is required when "sonarqube" is configured` +
            (t['name'] ? ` (team: "${t['name']}")` : '') + '.'
          );
        }
      }
      if (hasJira && errors.every(e => !e.includes('"jira"'))) {
        if (typeof t['jiraProjectKey'] !== 'string' || !t['jiraProjectKey']) {
          errors.push(
            `"teams[${i}].jiraProjectKey" is required when "jira" is configured` +
            (t['name'] ? ` (team: "${t['name']}")` : '') + '.'
          );
        }
      }
    });
  }

  // Validate schedule (optional)
  if (obj['schedule'] !== undefined) {
    if (typeof obj['schedule'] !== 'object' || obj['schedule'] === null) {
      errors.push('"schedule" must be an object.');
    } else {
      const sched = obj['schedule'] as Record<string, unknown>;
      if (sched['interval'] !== undefined) {
        if (!VALID_INTERVALS.includes(sched['interval'] as typeof VALID_INTERVALS[number])) {
          errors.push(
            `"schedule.interval" must be one of ${VALID_INTERVALS.map(v => `"${v}"`).join(', ')} ` +
            `(got "${sched['interval']}").`
          );
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

function resolveOutput(raw: unknown): AgentConfig['output'] {
  if (typeof raw !== 'object' || raw === null) {
    return { ...DEFAULT_OUTPUT };
  }
  const o = raw as Record<string, unknown>;
  return {
    reportsDir:       typeof o['reportsDir'] === 'string'       ? o['reportsDir']       : DEFAULT_OUTPUT.reportsDir,
    auditDir:         typeof o['auditDir'] === 'string'         ? o['auditDir']         : DEFAULT_OUTPUT.auditDir,
    schemaFile:       typeof o['schemaFile'] === 'string'       ? o['schemaFile']       : DEFAULT_OUTPUT.schemaFile,
    schedulerState:   typeof o['schedulerState'] === 'string'   ? o['schedulerState']   : DEFAULT_OUTPUT.schedulerState,
    integrationGuide: typeof o['integrationGuide'] === 'string' ? o['integrationGuide'] : DEFAULT_OUTPUT.integrationGuide,
  };
}

export async function load(configPath: string): Promise<ResolvedConfig> {
  const raw = await fs.readFile(configPath, 'utf-8');

  // Set file permissions to 0600 after reading
  await fs.chmod(configPath, 0o600);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse config file at "${configPath}": ${(err as Error).message}`);
  }

  // validate() throws immediately if a token field is detected
  const result = validate(parsed);
  if (!result.valid) {
    throw new Error(
      `Configuration validation failed with ${result.errors.length} error(s):\n` +
      result.errors.map(e => `  - ${e}`).join('\n')
    );
  }

  const obj = parsed as Record<string, unknown>;

  // Build AgentConfig with resolved output defaults
  const config: AgentConfig = {
    ...(obj['sonarqube'] ? { sonarqube: obj['sonarqube'] as AgentConfig['sonarqube'] } : {}),
    ...(obj['jira']      ? { jira:      obj['jira']      as AgentConfig['jira']      } : {}),
    teams:      obj['teams']      as AgentConfig['teams'],
    department: obj['department'] as AgentConfig['department'],
    ...(obj['schedule']  ? { schedule:  obj['schedule']  as AgentConfig['schedule']  } : {}),
    ...(obj['alerting']  ? { alerting:  obj['alerting']  as AgentConfig['alerting']  } : {}),
    output: resolveOutput(obj['output']),
  };

  // Resolve credentials exclusively from environment variables
  const credentials: Credentials = {};
  if (process.env['SONARQUBE_TOKEN']) {
    credentials.sonarqubeToken = process.env['SONARQUBE_TOKEN'];
  }
  if (process.env['JIRA_TOKEN']) {
    credentials.jiraToken = process.env['JIRA_TOKEN'];
  }

  return { config, credentials };
}
