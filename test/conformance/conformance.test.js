'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { SUITES, REFERENCE, readRecording, startOffline, judge } = require('./suite');

function explain(blocking) {
  return blocking.map((d) => `  ${d.kind} ${d.path}: reference ${d.reference}, SheLLM ${d.actual}`).join('\n');
}

describe('SheLLM against recorded first-party responses', () => {
  let offline;

  before(async () => { offline = await startOffline(); });
  after(() => offline.stop());

  for (const { api, CASES, ACCEPTED } of SUITES) {
    describe(`${api} format, judged against recorded/${REFERENCE[api]}/`, () => {
      for (const kase of CASES) {
        it(`${kase.id}: ${kase.title}`, async (t) => {
          const reference = readRecording(REFERENCE[api], kase.id);
          if (!reference) return t.skip('not recorded yet: npm run conformance:record');
          const { blocking } = await judge({ api, kase, accepted: ACCEPTED, reference, actualTarget: offline.target });
          assert.equal(blocking.length, 0, `unaccepted differences — fix SheLLM or accept them in cases/${api}.js:\n${explain(blocking)}`);
        });
      }
    });
  }
});
