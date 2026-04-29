#!/usr/bin/env node
/**
 * Validates config.json and credentials before running a full scan.
 * Checks: config file exists and parses, required env vars are set,
 * and performs a live connection test against each configured source.
 *
 * Run with: npm run validate-config
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;

function ok(msg) {
  console.log(`  ✅  ${msg}`);
  passed++;
}

function fail(msg) {
  console.error(`  ❌  ${msg}`);
  failed++;
}

function warn(msg) {
  console.warn(`  ⚠️   ${msg}`);
}

// --- 1. Config file ---
console.log('\n── Config file ─────────────────────────────────────────');

const configPath = path.join(ROOT, 'config.json');
if (!fs.existsSync(configPath)) {
  fail('config.json not found — run: npm run setup');
  process.exit(1);
}

let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  ok('config.json found and valid JSON');
} catch (e) {
  fail(`config.json is not valid JSON: ${e.message}`);
  process.exit(1);
}

// Required fields
if (!config.department?.name) fail('config.department.name is missing');
else ok(`Department: ${config.department.name}`);

if (!Array.isArray(config.teams) || config.teams.length === 0) {
  fail('config.teams is empty — add at least one team');
} else {
  ok(`Teams configured: ${config.teams.map(t => t.name).join(', ')}`);
}

for (const team of config.teams ?? []) {
  if (config.sonarqube && !team.sonarqubeProjectKey) {
    fail(`Team "${team.name}" is missing sonarqubeProjectKey`);
  }
  if (config.jira && !team.jiraProjectKey) {
    warn(`Team "${team.name}" has no jiraProjectKey — Jira metrics will be skipped for this team`);
  }
}

// --- 2. Environment variables ---
console.log('\n── Environment variables ───────────────────────────────');

// Load .env if present
const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const [key, ...rest] = line.split('=');
    if (key && rest.length && !process.env[key.trim()]) {
      process.env[key.trim()] = rest.join('=').trim();
    }
  }
  ok('.env loaded');
} else {
  warn('.env not found — relying on environment variables already set in shell');
}

if (config.sonarqube) {
  if (process.env.SONARQUBE_TOKEN) ok('SONARQUBE_TOKEN is set');
  else fail('SONARQUBE_TOKEN is not set — add it to .env or export it');

  const serverUrl = config.sonarqube.serverUrl ?? '';
  if (serverUrl.includes('sonarcloud.io') && !process.env.SONARQUBE_ORG) {
    fail('SONARQUBE_ORG is required for SonarCloud but is not set');
  } else if (process.env.SONARQUBE_ORG) {
    ok(`SONARQUBE_ORG is set: ${process.env.SONARQUBE_ORG}`);
  }
}

if (config.jira) {
  if (process.env.JIRA_TOKEN) ok('JIRA_TOKEN is set');
  else fail('JIRA_TOKEN is not set — add it to .env or export it');
}

// --- 3. Live connection test ---
console.log('\n── Live connection test ────────────────────────────────');

if (config.sonarqube) {
  const serverUrl = config.sonarqube.serverUrl ?? '';
  const token = process.env.SONARQUBE_TOKEN ?? '';
  const org = process.env.SONARQUBE_ORG ?? '';

  if (!token) {
    warn('Skipping SonarQube connection test — no token');
  } else {
    try {
      // Hit the SonarCloud/SonarQube REST API to verify the token is valid
      const baseUrl = serverUrl.includes('api.sonarcloud.io')
        ? 'https://sonarcloud.io'
        : serverUrl.replace('/mcp', '');

      const url = `${baseUrl}/api/authentication/validate`;
      const headers = { Authorization: `Bearer ${token}` };

      const res = await fetch(url, { headers });
      if (res.ok) {
        const body = await res.json();
        if (body.valid) ok(`SonarQube token is valid (${baseUrl})`);
        else fail(`SonarQube token is invalid — generate a new read-only token`);
      } else {
        fail(`SonarQube connection failed: HTTP ${res.status}`);
      }

      // Check each project key exists
      for (const team of config.teams) {
        if (!team.sonarqubeProjectKey) continue;
        const projectUrl = `${baseUrl}/api/components/show?component=${encodeURIComponent(team.sonarqubeProjectKey)}`;
        const projectRes = await fetch(projectUrl, { headers });
        if (projectRes.ok) ok(`Project found: ${team.sonarqubeProjectKey}`);
        else if (projectRes.status === 404) fail(`Project not found: ${team.sonarqubeProjectKey} — check the key in config.json`);
        else fail(`Could not verify project ${team.sonarqubeProjectKey}: HTTP ${projectRes.status}`);
      }
    } catch (e) {
      fail(`SonarQube connection error: ${e.message}`);
    }
  }
}

if (config.jira) {
  warn('Jira connection test not yet implemented — token format varies by deployment');
}

// --- Summary ---
console.log('\n────────────────────────────────────────────────────────');
if (failed === 0) {
  console.log(`\n✅  All checks passed (${passed} passed). You're ready to run: npm run scan\n`);
  process.exit(0);
} else {
  console.log(`\n❌  ${failed} check(s) failed, ${passed} passed. Fix the issues above before running npm run scan\n`);
  process.exit(1);
}
