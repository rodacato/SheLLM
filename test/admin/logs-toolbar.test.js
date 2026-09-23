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

// A native select is as wide as its widest option, and a flex item defaults to min-width:auto — so
// one long model name pushed the filter row past <main>, which has no max-width, and the page
// scrolled sideways. A width class on every select is what stops the data sizing the layout.
describe('the Logs filter bar cannot be widened by its own data', () => {
  const selects = () => logsPageHtml().match(/<select[\s\S]*?>/g) || [];

  it('has the four filters it is supposed to have', () => {
    assert.strictEqual(selects().length, 4);
  });

  it('gives every filter an explicit width', () => {
    for (const tag of selects()) {
      assert.match(tag, /class="w-\d+ /, `a filter is sized by its options: ${tag.slice(0, 80)}`);
    }
  });

  // The count answers the filters above it, and sharing their row is what left no room for the
  // buttons; the row it sits on now is also the row that carries them.
  it('counts the results below the filters, not beside them', () => {
    const page = logsPageHtml();
    const lastSelect = page.lastIndexOf('</select>');
    const total = page.indexOf('total logs found');
    assert.ok(total > lastSelect, 'the result count comes after every filter');
  });

  it('keeps the destructive action away from the filters', () => {
    const page = logsPageHtml();
    assert.ok(page.indexOf('Clear All') > page.lastIndexOf('</select>'));
  });
});
