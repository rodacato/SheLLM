'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const UNIT = path.join(__dirname, '../../shellm.service');

// systemd accumulates repeated directives, so every key maps to a list.
function parseUnit(text) {
  const directives = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('[')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq);
    (directives[key] ||= []).push(trimmed.slice(eq + 1));
  }
  return directives;
}

function paths(directives, key) {
  return (directives[key] || []).flatMap((v) => v.split(/\s+/)).map((p) => p.replace(/^-/, ''));
}

describe('shellm.service sandbox', () => {
  const unit = parseUnit(readFileSync(UNIT, 'utf8'));

  it('confines the filesystem and refuses privilege escalation', () => {
    assert.deepEqual(unit.ProtectSystem, ['strict']);
    assert.deepEqual(unit.NoNewPrivileges, ['yes']);
    assert.deepEqual(unit.PrivateTmp, ['yes']);
  });

  it('makes the checkout read-only to the service and everything it spawns', () => {
    const workdir = unit.WorkingDirectory[0];
    assert.ok(
      paths(unit, 'ReadOnlyPaths').includes(workdir),
      `the working directory ${workdir} must be listed in ReadOnlyPaths, or a prompt injection can rewrite the code the service runs`,
    );
  });

  it('never grants the checkout back through ReadWritePaths', () => {
    const writable = paths(unit, 'ReadWritePaths');
    const workdir = unit.WorkingDirectory[0];
    assert.ok(!writable.includes(workdir), 'the checkout is listed as writable, which cancels the sandbox');
    assert.ok(
      writable.some((p) => workdir.startsWith(p + '/')),
      'the home directory above the checkout must stay writable — the CLIs keep their state there',
    );
  });

  it('tolerates the runtime directory being absent', () => {
    const raw = (unit.ReadWritePaths || []).flatMap((v) => v.split(/\s+/));
    const runtime = raw.find((p) => p.includes('/run/shellm'));
    assert.ok(runtime, '/run/shellm carries the update request');
    assert.ok(
      runtime.startsWith('-'),
      'without the leading dash a missing tmpfiles entry stops the service from starting at all',
    );
  });
});
