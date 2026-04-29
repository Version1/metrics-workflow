#!/usr/bin/env node
/**
 * Interactive setup script for metrics-workflow.
 * Writes config.json and .env with credentials.
 * Run with: npm run setup
 */

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question, defaultValue) {
  return new Promise((resolve) => {
    const hint = defaultValue ? ` (default: ${defaultValue})` : '';
    rl.question(`${question}${hint}: `, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

function askSecret(question) {
  return new Promise((resolve) => {
    process.stdout.write(`${question}: `);
    // Hide input on TTY
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    let input = '';
    const onData = (char) => {
      char = char.toString();
      if (char === '\n' || char === '\r' || char === '\u0004') {
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(input);
      } else if (char === '\u0003') {
        process.exit();
      } else if (char === '\u007f') {
        input = input.slice(0, -1);
      } else {
        input += char;
        process.stdout.write('*');
      }
    };
    if (process.stdin.isTTY) {
      process.stdin.resume();
      process.stdin.on('data', onData);
    } else {
      // Non-TTY (piped input) — just read normally
      rl.question('', (answer) => resolve(answer.trim()));
    }
  });
}

console.log('\n🔧  Dev Metrics Agent — Setup\n');
console.log('This will create config.json and .env in the project root.\n');

// --- SonarCloud / SonarQube ---
console.log('── SonarQube / SonarCloud ──────────────────────────────');
const sonarHost = await ask('SonarQube host URL', 'https://sonarcloud.io');
const isSonarCloud = sonarHost.includes('sonarcloud.io');
const sonarOrg = isSonarCloud ? await ask('SonarCloud organisation key (e.g. my-org)') : '';
const sonarToken = await ask('SonarQube token (SONARQUBE_TOKEN)');
const sonarProjectKey = await ask('SonarQube project key (e.g. my-org_my-project)');
const teamName = await ask('Team name for this project', sonarProjectKey.split('_').pop() ?? 'my-team');

// --- Jira (optional) ---
console.log('\n── Jira (optional — press Enter to skip) ───────────────');
const jiraUrl = await ask('Jira MCP URL (leave blank to skip)', '');
const jiraToken = jiraUrl ? await ask('Jira token (JIRA_TOKEN)') : '';
const jiraProjectKey = jiraUrl ? await ask('Jira project key') : '';

// --- Department ---
console.log('\n── General ─────────────────────────────────────────────');
const department = await ask('Department name', 'Engineering');

rl.close();

// --- Build config.json ---
const serverUrl = isSonarCloud ? 'https://api.sonarcloud.io/mcp' : `${sonarHost}/mcp`;

const config = {
  sonarqube: { serverUrl },
  ...(jiraUrl ? { jira: { serverUrl: jiraUrl } } : {}),
  department: { name: department },
  teams: [
    {
      name: teamName,
      sonarqubeProjectKey: sonarProjectKey,
      ...(jiraProjectKey ? { jiraProjectKey } : {}),
    },
  ],
  output: { reportsDir: 'quality-metrics/reports' },
};

const configPath = path.join(ROOT, 'config.json');
fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
console.log(`\n✅  Written: config.json`);

// --- Build .env ---
const envLines = [
  `SONARQUBE_TOKEN=${sonarToken}`,
  ...(sonarOrg ? [`SONARQUBE_ORG=${sonarOrg}`] : []),
  ...(jiraToken ? [`JIRA_TOKEN=${jiraToken}`] : []),
];
const envPath = path.join(ROOT, '.env');
fs.writeFileSync(envPath, envLines.join('\n') + '\n', { mode: 0o600 });
console.log(`✅  Written: .env (permissions set to 600)`);

console.log('\n🚀  You\'re all set! Run the following to get started:\n');
console.log('    npm run build');
console.log('    npm run validate-config');
console.log('    npm run scan\n');
