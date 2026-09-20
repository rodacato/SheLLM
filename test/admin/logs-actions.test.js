'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const { compose } = require('../../src/admin/views');

// The composed page, not a partial: what is asserted here is where the control ended up once
// every include is in place, which is the part that was wrong.
function logsPage(html) {
  const start = html.indexOf('<!-- LOGS PAGE -->');
  assert.ok(start > -1, 'the logs page is in the composed dashboard');
  const end = html.indexOf('<!-- ', html.indexOf('<!-- Table -->') + 1);
  return html.slice(start, end > start ? end : undefined);
}

function slice(html, from, to) {
  const start = html.indexOf(from);
  assert.ok(start > -1, `expected to find ${from}`);
  const end = html.indexOf(to, start);
  assert.ok(end > start, `expected ${to} after ${from}`);
  return html.slice(start, end);
}

describe('refresh is an action on the logs table', () => {
  let page;

  before(() => { page = logsPage(compose()); });

  it('no longer hangs off the page title', () => {
    const header = slice(page, '<header', '</header>');
    assert.ok(!header.includes('refresh'), 'the heading is a heading, not a toolbar');
    assert.ok(header.includes('REQUEST LOGS'), 'the heading is still there — otherwise this proves nothing');
  });

  it('sits in the same group as export and clear', () => {
    const actions = slice(page, 'ml-auto flex gap-2', 'Clear All');
    assert.ok(actions.includes('>refresh<'), 'the reload icon belongs with the other actions');
    assert.ok(actions.includes('exportCSV()'), 'and that group is the one holding Export CSV');
  });

  it('stays reachable when the table is empty', () => {
    const button = slice(page, '<button @click="fetchLogs(); fetchStats()"', '</button>');
    assert.ok(!button.includes('total > 0'),
      'an empty table is exactly when re-reading it is worth doing');
    assert.ok(slice(page, '@click="exportCSV()"', '</button>').includes('total > 0')
      || page.includes('x-show="total > 0" @click="exportCSV()"'),
      'export is still gated — otherwise the check above proves nothing about gating');
  });

  it('says what it does, now that it is only an icon', () => {
    const button = slice(page, '<button @click="fetchLogs(); fetchStats()"', '</button>');
    assert.ok(button.includes('aria-label="Refresh"'), 'an icon-only control needs a name');
    assert.ok(/:title=/.test(button), 'and a tooltip on hover');
    assert.ok(button.includes(':disabled="loading"'), 'it cannot be pressed while it is already reading');
  });
});
