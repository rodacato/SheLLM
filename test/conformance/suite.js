'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { send } = require('./capture');
const { diff, classify } = require('./compare');
const { REFERENCE } = require('./targets');

const RECORDED = path.join(__dirname, 'recorded');
const SUITES = [require('./cases/anthropic'), require('./cases/openai')];

function recordingPath(target, id) {
  return path.join(RECORDED, target, `${id}.json`);
}

function readRecording(target, id) {
  const file = recordingPath(target, id);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

function writeRecording(target, recording) {
  const file = recordingPath(target, recording.case);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(recording, null, 2)}\n`);
}

// A SheLLM on a real port with the fake claude, the same one test/sdk/ runs against.
async function startOffline() {
  const { startShellm } = require('../sdk/shellm-server');
  const shellm = await startShellm();
  return {
    target: { name: 'shellm-offline', baseUrl: shellm.origin, apiKey: shellm.apiKey, model: 'claude-haiku' },
    stop: shellm.stop,
  };
}

async function judge({ api, kase, accepted, reference, actualTarget, actualRecording }) {
  const actual = actualRecording ?? await send(actualTarget, api, kase);
  const diffs = classify(diff(api, reference.response, actual.response), [...accepted, ...(kase.accepted || [])]);
  return { actual, diffs, blocking: diffs.filter((d) => d.blocking) };
}

module.exports = { SUITES, REFERENCE, readRecording, writeRecording, startOffline, judge };
