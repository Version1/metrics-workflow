#!/usr/bin/env node
/**
 * Dev Metrics Agent — CLI entry point.
 *
 * Usage:
 *   node dist/index.js --config <path> [--team <name>]
 *
 * Environment variables:
 *   SONARQUBE_TOKEN   Read-only SonarQube token (required if sonarqube configured)
 *   JIRA_TOKEN        Read-only Jira/Atlassian OAuth token (required if jira configured)
 */

import * as path from 'path';
import { load } from './config-loader.js';
import { ReportGenerator } from './report-generator.js';
import { Orchestrator } from './orchestrator.js';
import { EXIT_CODES } from './constants.js';
import logger from './utils/logger.js';

function parseArgs(argv: string[]): { configPath: string; teamFilter?: string } {
  const args = argv.slice(2);
  let configPath = '.kiro/specs/dev-metrics-agent/config.json';
  let teamFilter: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config' && args[i + 1]) {
      configPath = args[++i];
    } else if (args[i] === '--team' && args[i + 1]) {
      teamFilter = args[++i];
    } else if (args[i] === '--help' || args[i] === '-h') {
      logger.info('Usage: dev-metrics-agent --config <path> [--team <name>]');
      logger.info('');
      logger.info('Options:');
      logger.info('  --config <path>   Path to config.json (default: .kiro/specs/dev-metrics-agent/config.json)');
      logger.info('  --team <name>     Run for a single team only');
      logger.info('  --help            Show this help message');
      process.exit(0);
    }
  }

  return { configPath, teamFilter };
}

async function main(): Promise<void> {
  const { configPath, teamFilter } = parseArgs(process.argv);
  const controller = new AbortController();

  // Handle SIGINT/SIGTERM gracefully
  process.on('SIGINT', () => { logger.info('\nInterrupted — aborting...'); controller.abort(); });
  process.on('SIGTERM', () => { logger.info('\nTerminated — aborting...'); controller.abort(); });

  let resolvedConfig;
  try {
    resolvedConfig = await load(path.resolve(configPath));
  } catch (err) {
    logger.error(`[Config] ${(err as Error).message}`);
    process.exit(EXIT_CODES.CONFIG_ERROR);
  }

  let { config } = resolvedConfig;
  const { credentials } = resolvedConfig;

  // Apply team filter if specified
  if (teamFilter) {
    const filtered = config.teams.filter((t) => t.name === teamFilter);
    if (filtered.length === 0) {
      logger.error(`[Config] No team named "${teamFilter}" found in configuration.`);
      process.exit(EXIT_CODES.CONFIG_ERROR);
    }
    config = { ...config, teams: filtered };
  }

  // Pre-flight write check
  const reportsDir = config.output?.reportsDir ?? 'quality-metrics/reports';
  const reportGen = new ReportGenerator(reportsDir);
  try {
    await reportGen.checkOutputWritable();
  } catch (err) {
    logger.error(`[ReportGenerator] ${(err as Error).message}`);
    process.exit(EXIT_CODES.CONFIG_ERROR);
  }

  // Run
  const orchestrator = new Orchestrator();
  const summary = await orchestrator.run({ config, credentials, signal: controller.signal });

  process.exit(summary.exitCode);
}

main().catch((err) => {
  logger.error('[Fatal]', err instanceof Error ? err.message : String(err));
  process.exit(EXIT_CODES.CONFIG_ERROR);
});
