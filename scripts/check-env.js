#!/usr/bin/env node
// check-env.js — validates the local environment before starting SheLLM
// Run: npm run check:env
// Also used as a pre-flight gate: npm run check:env && npm start

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const BOLD  = '\x1b[1m';
const CYAN  = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED   = '\x1b[31m';
const AMBER = '\x1b[33m';
const DIM   = '\x1b[2m';
const RESET = '\x1b[0m';

let errors   = 0;
let warnings = 0;

function ok(label, detail = '')  { console.log(`  ${GREEN}✓${RESET} ${label}${detail ? DIM + '  ' + detail + RESET : ''}`); }
function warn(label, hint = '')  { warnings++; console.log(`  ${AMBER}⚠${RESET} ${label}${hint ? '\n    ' + DIM + hint + RESET : ''}`); }
function fail(label, hint = '')  { errors++;   console.log(`  ${RED}✗${RESET} ${label}${hint ? '\n    ' + DIM + hint + RESET : ''}`); }
function section(name)           { console.log(`\n${BOLD}${CYAN}${name}${RESET}`); }

// ── Node.js version ──────────────────────────────────────────────────────────
section('Runtime');

const nodeVersion = process.versions.node;
const [major] = nodeVersion.split('.').map(Number);
if (major >= 22) {
  ok(`Node.js ${nodeVersion}`);
} else {
  fail(`Node.js ${nodeVersion} — requires >= 22`, 'Install via https://nodejs.org or use nvm: nvm install 22');
}

// ── .env file ────────────────────────────────────────────────────────────────
section('.env');

const envPath = join(ROOT, '.env');
if (existsSync(envPath)) {
  ok('.env file found');
} else {
  fail('.env file missing', 'Run: cp .env.example .env  — then edit as needed');
}

// ── Required binaries ────────────────────────────────────────────────────────
section('CLI Providers');

const clis = [
  { cmd: 'claude',  name: 'Claude Code',  install: 'curl -fsSL https://claude.ai/install.sh | bash' },
  { cmd: 'gemini',  name: 'Gemini CLI',   install: 'npm install -g @google/gemini-cli' },
  { cmd: 'codex',   name: 'Codex CLI',    install: 'npm install -g @openai/codex' },
];

for (const { cmd, name, install } of clis) {
  try {
    const versionOutput = execSync(`${cmd} --version 2>/dev/null || ${cmd} -v 2>/dev/null || echo unknown`, { encoding: 'utf8', timeout: 5000 }).trim();
    const version = versionOutput.split('\n')[0].trim();
    ok(`${name} (${cmd})`, version !== 'unknown' ? version : '');
  } catch {
    warn(`${name} (${cmd}) not found — provider will be unavailable`, `Install: ${install}`);
  }
}

// ── Optional: Cerebras API key ───────────────────────────────────────────────
section('API Providers');

// Load .env manually (dotenv may not be installed yet during check)
let envVars = {};
if (existsSync(envPath)) {
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    envVars[key] = val;
  }
}

const cerebrasKey = process.env.CEREBRAS_API_KEY || envVars.CEREBRAS_API_KEY || '';
if (cerebrasKey && cerebrasKey !== 'csk-xxx') {
  ok('Cerebras API key set');
} else {
  ok('Cerebras API key not set', 'optional — only needed for cerebras provider');
}

// ── Admin password ───────────────────────────────────────────────────────────
section('Configuration');

const adminPass = process.env.SHELLM_ADMIN_PASSWORD || envVars.SHELLM_ADMIN_PASSWORD || '';
if (adminPass) {
  ok('SHELLM_ADMIN_PASSWORD set', 'admin dashboard enabled');
} else {
  warn('SHELLM_ADMIN_PASSWORD not set', 'Admin endpoints (/admin/*) will return 501. Set in .env to enable the dashboard.');
}

const port = process.env.PORT || envVars.PORT || '6100';
ok(`PORT=${port}`);

// ── node_modules ─────────────────────────────────────────────────────────────
section('Dependencies');

if (existsSync(join(ROOT, 'node_modules'))) {
  ok('node_modules present');
} else {
  fail('node_modules missing', 'Run: npm install');
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('');
if (errors > 0) {
  console.log(`${RED}${BOLD}✗ ${errors} error${errors > 1 ? 's' : ''} — fix the above before starting SheLLM${RESET}`);
  process.exit(1);
} else if (warnings > 0) {
  console.log(`${AMBER}${BOLD}⚠ ${warnings} warning${warnings > 1 ? 's' : ''} — SheLLM will start, but some providers may be unavailable${RESET}`);
  process.exit(0);
} else {
  console.log(`${GREEN}${BOLD}✓ Environment looks good — run: shellm start${RESET}`);
  process.exit(0);
}
