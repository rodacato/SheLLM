'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { decide } = require('../../scripts/audit-deps');

// The registry-error payload is the real one npm produced on 2026-09-19, trimmed: the property
// that matters is what it lacks, not what it carries.
const REGISTRY_DOWN = JSON.stringify({
  message: '503 Service Unavailable - POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk - We are currently performing maintenance.',
  method: 'POST',
  uri: 'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk',
});

function auditReport(vulnerabilities) {
  return JSON.stringify({ vulnerabilities: {}, metadata: { vulnerabilities } });
}

describe('audit-deps', () => {
  it('does not block when the registry never answered', () => {
    const { block, reason } = decide(REGISTRY_DOWN);
    assert.equal(block, false);
    assert.match(reason, /audit did not run/);
    assert.match(reason, /503/, 'the reason repeats what npm said, so the log is not a dead end');
  });

  it('blocks on a high or critical advisory', () => {
    assert.equal(decide(auditReport({ critical: 0, high: 2, moderate: 0, low: 0 })).block, true);
    assert.equal(decide(auditReport({ critical: 1, high: 0, moderate: 0, low: 0 })).block, true);
  });

  it('passes when nothing reaches the threshold', () => {
    const { block, reason } = decide(auditReport({ critical: 0, high: 0, moderate: 5, low: 9 }));
    assert.equal(block, false, 'moderate and low are reported by Dependabot, not by a merge gate');
    assert.match(reason, /no high or critical/);
  });

  it('blocks when the output cannot be read at all', () => {
    // Silence here would mean an audit that produced nothing counted as an audit that passed.
    assert.equal(decide('').block, true);
    assert.equal(decide('<html>502 Bad Gateway</html>').block, true);
  });
});
