'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { compose } = require('../../src/admin/views');

const overviewHeader = () => {
  const html = compose();
  const start = html.indexOf('<!-- OVERVIEW PAGE -->');
  const end = html.indexOf('<!-- Every figure below is over this window', start);
  assert.ok(start > -1 && end > start, 'the Overview page still opens with its header');
  return html.slice(start, end);
};

describe('the Overview refresh control', () => {
  it('renders its options from the shared ladder rather than a second copy in the markup', () => {
    const header = overviewHeader();
    assert.match(header, /x-for="step in ladder"/, 'the options are not driven by REFRESH_LADDER');
    assert.doesNotMatch(header, /<option value="30000"/, 'an interval was hardcoded into the markup');
  });

  // With the interval switched off there is no loop, so the button is the only way to re-read the
  // page at all. Losing it would make Off mean "this page is now frozen until you reload".
  it('keeps a manual read that does not depend on the interval', () => {
    assert.match(overviewHeader(), /@click="fetchStats\(\)"/);
  });

  it('names both halves for a screen reader', () => {
    const header = overviewHeader();
    assert.match(header, /aria-label="Re-read this page now"/);
    assert.match(header, /aria-label="Auto-refresh interval"/);
  });

  // The two halves are one control. Drawn as two bordered boxes 8px apart they read as two
  // unrelated items, which is the shape this replaced.
  it('draws one border around both halves, not one each', () => {
    const header = overviewHeader();
    const unit = header.slice(header.indexOf('items-stretch'), header.indexOf('</select>'));
    assert.ok(unit.length > 0, 'the joined control is gone');

    const borders = (unit.match(/\bborder border-outline-variant\/30\b/g) || []).length;
    assert.strictEqual(borders, 1, 'each half carries its own border');
    assert.match(unit, /w-px bg-outline-variant\/30/, 'the halves are not separated by a divider');
  });

  it('only names durations the motion scale contains', () => {
    const header = overviewHeader();
    for (const token of header.match(/duration-[a-z0-9]+/g) || []) {
      assert.ok(['duration-fast', 'duration-move'].includes(token), `${token} is off the scale`);
    }
  });
});
