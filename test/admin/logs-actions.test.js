'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const { compose } = require('../../src/admin/views');

// The composed page, not a partial: what is asserted here is where the control ended up once
// every include is in place, which is the part that was wrong.
function logsPage(html) {
  const start = html.indexOf('<!-- LOGS PAGE -->');
  assert.ok(start > -1, 'the logs page is in the composed dashboard');
  const end = html.indexOf(' PAGE -->', start + '<!-- LOGS PAGE -->'.length);
  assert.ok(end > start, 'another page follows, which is what bounds this one');
  const slice = html.slice(start, html.lastIndexOf('<!--', end));
  assert.ok(slice.includes('Total Tokens'), 'the slice reaches the panels below the table');
  return slice;
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

describe('the logs panels do not name a period they do not measure', () => {
  let page;

  before(() => { page = logsPage(compose()); });

  it('dropped the labels that claimed 60 minutes and today', () => {
    assert.ok(!page.includes('Last 60m'),
      'the panel reads /admin/stats, which is the whole retained window, not an hour');
    assert.ok(!page.includes('Total Tokens (Today)'), 'same figure, same window, not today');
    assert.ok(page.includes('Error Rate') && page.includes('Total Tokens'),
      'the panels are still there — otherwise the two checks above prove nothing');
  });

  it('says which window it is showing instead', () => {
    const matches = page.match(/x-text="windowSpan\(\)"/g) || [];
    assert.strictEqual(matches.length, 2, 'both panels state the window they measured');
  });
});

describe('an expanded log detail sits under the row it belongs to', () => {
  let page;

  before(() => { page = logsPage(compose()); });

  // Two loops over the same array rendered every detail row below the whole table: the third
  // row sat at y=502 and its detail at y=2181, past the other twenty-four.
  it('renders the row and its detail in one pass over the logs', () => {
    const loops = page.match(/x-for="log in logs"/g) || [];
    assert.strictEqual(loops.length, 1, 'a second pass over the same array puts its rows after the first');
    assert.ok(!page.includes("'detail-' + log.id"), 'the detail rows had their own keyed loop');

    const loop = slice(page, '<template x-for="log in logs"', '</template>');
    assert.ok(loop.includes('@click="toggleRow(log.id)"'), 'the data row is inside the loop');
    assert.ok(loop.includes('x-show="expandedId === log.id"'), 'and so is the detail it expands to');
  });

  it('gives each row its own tbody, the single root x-for allows', () => {
    const loop = slice(page, '<template x-for="log in logs"', '</template>');
    assert.match(loop.trim(), /^<template[^>]*>\s*<tbody>/, 'two <tr> need a row group to be one root');
    assert.strictEqual((loop.match(/<tbody>/g) || []).length, 1, 'one root, not a row group per <tr>');
    assert.match(loop.trim(), /<\/tbody>\s*$/, 'the group closes inside the loop');
  });
});
