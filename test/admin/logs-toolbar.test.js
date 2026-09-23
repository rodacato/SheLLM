'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { compose } = require('../../src/admin/views');

const logsPageHtml = () => {
  const html = compose();
  const start = html.indexOf('<!-- LOGS PAGE -->');
  const end = html.indexOf('<!-- Stats Summary -->', start);
  assert.ok(start > -1 && end > start, 'the Logs page still opens with its filter bar');
  return html.slice(start, end);
};

// The filters share their row with the refresh control and the two data actions, so "every select
// on this row" is no longer the same set as "every filter". Only the filters are sized by data.
const filterGroupHtml = () => {
  const page = logsPageHtml();
  const start = page.indexOf('<div class="flex flex-wrap gap-4 items-end">');
  const end = page.indexOf('<div class="ml-auto flex items-center gap-4">', start);
  assert.ok(start > -1 && end > start, 'the filters are no longer grouped');
  return page.slice(start, end);
};

// A native select is as wide as its widest option, and a flex item defaults to min-width:auto — so
// one long model name pushed the filter row past <main>, which has no max-width, and the page
// scrolled sideways. A width class on every select is what stops the data sizing the layout.
describe('the Logs filter bar cannot be widened by its own data', () => {
  const selects = () => filterGroupHtml().match(/<select[\s\S]*?>/g) || [];

  it('has the four filters it is supposed to have', () => {
    assert.strictEqual(selects().length, 4);
  });

  it('gives every filter an explicit width', () => {
    for (const tag of selects()) {
      assert.match(tag, /class="w-\d+ /, `a filter is sized by its options: ${tag.slice(0, 80)}`);
    }
  });

  // The interval select carries five fixed labels, so nothing it holds can widen the row. It sits
  // outside the group precisely because it is a control, not a filter.
  it('keeps the refresh control out of the filter group', () => {
    assert.doesNotMatch(filterGroupHtml(), /Auto-refresh interval/);
    assert.match(logsPageHtml(), /aria-label="Auto-refresh interval"/);
  });

  // The count answers the filters above it, and sharing their row is what left no room for the
  // buttons. It now has that row to itself, below the filters and the actions alike.
  it('counts the results below the filters, not beside them', () => {
    const page = logsPageHtml();
    const total = page.indexOf('total logs found');
    assert.ok(total > page.lastIndexOf('</select>'), 'the result count comes after every filter');
    assert.ok(total > page.indexOf('Clear All'), 'the result count comes after the actions');
  });

  it('keeps the destructive action away from the filters', () => {
    const page = logsPageHtml();
    assert.ok(page.indexOf('Clear All') > page.lastIndexOf('</select>'));
  });
});
