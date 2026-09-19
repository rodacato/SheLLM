#!/usr/bin/env node
'use strict';

// `npm audit` exits non-zero both when it finds a vulnerability and when it cannot reach the
// registry at all. Only the first should stop a merge: a registry outage is not a finding, and
// treating it as one teaches everyone to re-run CI until it passes.

const { execFileSync } = require('node:child_process');

const BLOCKING = ['critical', 'high'];

// An audit that ran reports counts under metadata.vulnerabilities. One that never reached the
// registry reports the HTTP failure instead, with no counts anywhere.
function decide(raw) {
  let report;
  try {
    report = JSON.parse(raw);
  } catch {
    return { block: true, reason: 'npm audit produced output that is not JSON' };
  }

  const counts = report.metadata?.vulnerabilities;
  if (!counts) {
    const detail = report.message || report.error?.summary || 'no vulnerability counts reported';
    return { block: false, reason: `audit did not run: ${detail}` };
  }

  const found = BLOCKING.map((level) => [level, counts[level] || 0]).filter(([, n]) => n > 0);
  if (found.length === 0) return { block: false, reason: 'no high or critical advisories' };

  return { block: true, reason: found.map(([level, n]) => `${n} ${level}`).join(', ') };
}

function main() {
  let raw;
  try {
    raw = execFileSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8' });
  } catch (err) {
    raw = err.stdout || '';
  }

  const { block, reason } = decide(raw);
  if (block) {
    console.error(`npm audit: ${reason}`);
    console.error(raw);
    process.exit(1);
  }
  console.log(`npm audit: ${reason}`);
}

if (require.main === module) main();

module.exports = { decide };
