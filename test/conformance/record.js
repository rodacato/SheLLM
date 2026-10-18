'use strict';

const { parseArgs } = require('node:util');
const { send, buildRequest } = require('./capture');
const { SUITES, writeRecording } = require('./suite');
const { resolveTarget } = require('./targets');

const USAGE = `Usage: npm run conformance:record -- --target <name>[,<name>] [--only <id>,<id>] [--dry-run]

Targets: anthropic, openai, anthropic-openai (OpenAI format served by Anthropic), shellm (a live SheLLM).
Keys come from CONFORMANCE_*_API_KEY, read from .env.conformance when it exists.`;

async function main() {
  const { values } = parseArgs({
    options: { target: { type: 'string' }, only: { type: 'string' }, 'dry-run': { type: 'boolean' }, help: { type: 'boolean' } },
  });
  if (values.help || !values.target) {
    console.log(USAGE);
    process.exit(values.help ? 0 : 1);
  }
  const only = values.only ? new Set(values.only.split(',')) : null;
  let failed = 0;

  for (const target of values.target.split(',').map(resolveTarget)) {
    if (!target.apiKey && !values['dry-run']) {
      console.error(`${target.name}: ${target.keyEnv} is not set, skipped`);
      failed++;
      continue;
    }
    for (const { api, CASES } of SUITES.filter((s) => target.apis.includes(s.api))) {
      for (const kase of CASES.filter((c) => !only || only.has(c.id))) {
        if (values['dry-run']) {
          const { method, path } = buildRequest(target, api, kase);
          console.log(`${target.name}  ${kase.id.padEnd(36)} ${method} ${target.baseUrl}${path}`);
          continue;
        }
        try {
          const recording = await send(target, api, kase);
          writeRecording(target.name, { ...recording, recorded_at: new Date().toISOString() });
          console.log(`${target.name}  ${kase.id.padEnd(36)} ${recording.response.status}`);
        } catch (err) {
          failed++;
          console.error(`${target.name}  ${kase.id.padEnd(36)} failed: ${err.message}`);
        }
      }
    }
  }
  process.exit(failed ? 1 : 0);
}

main();
