#!/usr/bin/env node
'use strict';

/**
 * Seed the database with demo data for local development.
 * Usage: npm run seed
 */

const { initDb, closeDb, createClient, getDb } = require('../src/db');

initDb();
const db = getDb();

console.log('Seeding database...\n');

// --- Clients ---
const clients = [
  { name: 'demo-app', rpm: 60 },
  { name: 'test-runner', rpm: 10, models: ['claude', 'cerebras'] },
  { name: 'expired-client', rpm: 5, expires_at: new Date(Date.now() - 86400000).toISOString() },
];

for (const spec of clients) {
  try {
    const client = createClient(spec);
    console.log(`  + Client "${client.name}" (key: ${client.rawKey})`);
  } catch (err) {
    if (err.message?.includes('UNIQUE')) {
      console.log(`  ~ Client "${spec.name}" already exists, skipping`);
    } else {
      throw err;
    }
  }
}

// --- Request logs ---
const providers = ['claude', 'gemini', 'codex', 'cerebras'];
const statuses = [200, 200, 200, 200, 200, 200, 400, 400, 502, 200]; // 60% success, 20% client err, 10% server err
const clientNames = ['demo-app', 'test-runner', null];

const insertLog = db.prepare(`
  INSERT INTO request_logs (request_id, client_name, provider, model, status, duration_ms, queued_ms, tokens, cost_usd, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
`);

let logCount = 0;
for (let i = 0; i < 30; i++) {
  const provider = providers[i % providers.length];
  const status = statuses[i % statuses.length];
  const client = clientNames[i % clientNames.length];
  const duration = 500 + Math.floor(Math.random() * 5000);
  const tokens = status === 200 ? 50 + Math.floor(Math.random() * 500) : null;
  const cost = status === 200 ? Math.round(Math.random() * 0.05 * 10000) / 10000 : null;
  const daysAgo = `-${Math.floor(i / 5)} days`;

  insertLog.run(
    `seed-${String(i).padStart(3, '0')}`,
    client,
    provider,
    provider,
    status,
    duration,
    Math.floor(Math.random() * 200),
    tokens,
    cost,
    daysAgo,
  );
  logCount++;
}

console.log(`  + ${logCount} request log entries\n`);

closeDb();
console.log('Done. Start the server with: npm run dev');
