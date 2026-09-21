#!/usr/bin/env node
'use strict';

/**
 * Where a request's time went, from the request log — no benchmark, no quota.
 *
 * The log already carries every layer the server can see:
 *
 *   duration_ms  the whole HTTP request, measured in the logging middleware. No network.
 *   queued_ms    waiting for a queue slot before the provider was called.
 *   api_ms       what the CLI reports spending upstream (`duration_api_ms`).
 *
 * What is left over is process startup plus SheLLM's own layer — the part a warm pool would
 * have removed, and the only part nobody has ever measured on real traffic.
 *
 * Usage: node scripts/latency-breakdown.js [--db PATH] [--days N] [--provider NAME]
 */

const Database = require('better-sqlite3');
const { DB_FILE } = require('../src/cli/paths');

function parseArgs(argv) {
  const opts = { db: DB_FILE, days: 30, provider: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--db') opts.db = argv[++i];
    else if (argv[i] === '--days') opts.days = Number(argv[++i]);
    else if (argv[i] === '--provider') opts.provider = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') opts.help = true;
  }
  return opts;
}

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

function summarise(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    median: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9),
    min: sorted[0] ?? null,
    max: sorted[sorted.length - 1] ?? null,
  };
}

function readRows(db, { days, provider }) {
  const where = ["created_at >= datetime('now', ?)", 'status < 400', 'duration_ms IS NOT NULL'];
  const params = [`-${days} days`];
  if (provider) {
    where.push('provider = ?');
    params.push(provider);
  }
  return db.prepare(`
    SELECT provider, streamed, duration_ms, queued_ms, api_ms
    FROM request_logs
    WHERE ${where.join(' AND ')}
  `).all(...params);
}

// A row is decomposable only when the CLI reported its upstream time. codex reports none, and a
// missing queue reading is not a zero — a streamed request never records one at all.
function breakdown(rows) {
  const decomposable = rows.filter((r) => r.api_ms !== null);
  const overhead = decomposable.map((r) => r.duration_ms - (r.queued_ms || 0) - r.api_ms);
  return {
    rows: rows.length,
    decomposable: decomposable.length,
    streamed: decomposable.filter((r) => r.streamed === 1).length,
    queueUnrecorded: decomposable.filter((r) => r.queued_ms === null).length,
    negative: overhead.filter((ms) => ms < 0).length,
    duration: summarise(decomposable.map((r) => r.duration_ms)),
    queued: summarise(decomposable.filter((r) => r.queued_ms !== null).map((r) => r.queued_ms)),
    api: summarise(decomposable.map((r) => r.api_ms)),
    overhead: summarise(overhead),
  };
}

function ms(value) {
  return value === null ? '—' : `${Math.round(value)} ms`;
}

function render(result, opts) {
  const lines = [];
  lines.push(`Request log: ${opts.db}`);
  lines.push(`Window: last ${opts.days} days${opts.provider ? `, provider=${opts.provider}` : ''}`);
  lines.push('');

  if (result.decomposable === 0) {
    lines.push(`${result.rows} successful requests, none decomposable.`);
    lines.push('Only a provider that reports its upstream time can be split; codex reports none.');
    return lines.join('\n');
  }

  lines.push(`${result.decomposable} of ${result.rows} successful requests carry an upstream time and can be split.`);
  lines.push('');
  lines.push('| Layer | Median | p90 | n |');
  lines.push('|---|---|---|---|');
  lines.push(`| whole request (no network) | ${ms(result.duration.median)} | ${ms(result.duration.p90)} | ${result.duration.n} |`);
  lines.push(`| waiting for a queue slot | ${ms(result.queued.median)} | ${ms(result.queued.p90)} | ${result.queued.n} |`);
  lines.push(`| upstream, as the CLI reports it | ${ms(result.api.median)} | ${ms(result.api.p90)} | ${result.api.n} |`);
  lines.push(`| **startup + SheLLM's own layer** | **${ms(result.overhead.median)}** | **${ms(result.overhead.p90)}** | ${result.overhead.n} |`);
  lines.push('');
  lines.push(`Streamed: ${result.streamed} of ${result.decomposable}.`);

  if (result.queueUnrecorded > 0) {
    lines.push(`${result.queueUnrecorded} rows record no queue time and were counted as zero, which`);
    lines.push('inflates the last row by however long they actually queued. A streamed request');
    lines.push('never records one, so that count is a floor on the distortion, not a rounding error.');
  }
  if (result.negative > 0) {
    lines.push(`${result.negative} rows came out negative — the CLI reported more upstream time than`);
    lines.push('the whole request took. Read the last row as unreliable until that is explained.');
  }
  return lines.join('\n');
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('Usage: node scripts/latency-breakdown.js [--db PATH] [--days N] [--provider NAME]');
    return;
  }
  const db = new Database(opts.db, { readonly: true, fileMustExist: true });
  try {
    console.log(render(breakdown(readRows(db, opts)), opts));
  } finally {
    db.close();
  }
}

if (require.main === module) main();

module.exports = { breakdown, summarise, quantile, readRows, render };
