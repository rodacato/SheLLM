'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compose } = require('../../src/admin/views');

const PAGES = path.join(__dirname, '../../src/admin/views/pages');

// The eyebrow above a group of cards and the title inside one of them were the same string, so
// the only thing separating a section from its contents was whether the label sat on a surface.
const SECTION = 'tracking-[0.2em] text-outline';
const CARD = 'uppercase text-on-surface-variant';

function labelClasses() {
  return [...compose().matchAll(/class="([^"]*)"/g)]
    .map((m) => m[1])
    .filter((c) => c.includes('text-[10px]') && c.includes('font-headline'));
}

function pages() {
  return fs.readdirSync(PAGES).map((f) => [f, fs.readFileSync(path.join(PAGES, f), 'utf8')]);
}

describe('the dashboard draws two label levels, not one', () => {
  let labels;

  before(() => { labels = labelClasses(); });

  it('has enough labels for the checks below to mean anything', () => {
    assert.ok(labels.length >= 45, `found only ${labels.length} small headline labels`);
  });

  it('keeps both levels populated', () => {
    assert.ok(labels.filter((c) => c.includes(SECTION)).length >= 7, 'no section eyebrows left');
    assert.ok(labels.filter((c) => c.includes(CARD)).length >= 16, 'no card titles left');
  });

  it('never gives one element both treatments', () => {
    const both = labels.filter((c) => c.includes(SECTION) && c.includes(CARD));
    assert.deepStrictEqual(both, [], 'a label is both a section eyebrow and a card title');
  });
});

describe('a panel looks the same on every page', () => {
  it('ships exactly one card recipe', () => {
    const recipes = new Set();
    for (const [, text] of pages()) {
      for (const [, r] of text.matchAll(/(bg-surface-container p-\d|bg-surface-container-low p-\d)/g)) {
        recipes.add(r);
      }
    }
    assert.ok(recipes.size > 0, 'found no cards at all — this check proves nothing');
    assert.deepStrictEqual([...recipes].sort(), ['bg-surface-container p-5']);
  });

  // 4px cyan on the left edge is "you are here" in the sidebar and "this was just created" on
  // the keys page. A static panel wearing it is a selection affordance used as decoration.
  it('reserves the left rail for the sidebar and the new-key banner', () => {
    const wearing = pages().filter(([f, t]) => f !== 'keys.html' && t.includes('border-l-4'));
    assert.deepStrictEqual(wearing.map(([f]) => f), []);
  });
});

describe('a panel is as tall as what it holds', () => {
  // CSS grid stretches its items, so beside the form the response card was the form's height
  // whether or not an answer had arrived. Stacking removes the constraint rather than working
  // around it: a single column has no sibling to match, and the response gets the whole width
  // for a curl, an answer and its stats.
  it('does not put the Playground response beside the form', () => {
    const text = fs.readFileSync(path.join(PAGES, 'playground.html'), 'utf8');
    assert.doesNotMatch(text, /lg:grid-cols-2/, 'the response is beside the form again, where it stretches to its height');
    assert.match(text, /<div class="grid grid-cols-1 gap-6"/, 'the two panels are no longer a stacked grid');
  });

  // Stacking handed the row the whole page. Three short controls across it beats three stretched
  // to 1400px each, and the answer has to find the eye once the form is taller than the fold.
  it('spends the Playground width on the controls rather than on one of them', () => {
    const text = fs.readFileSync(path.join(PAGES, 'playground.html'), 'utf8');
    assert.match(text, /grid grid-cols-1 md:grid-cols-3 gap-4 mb-4 items-start/, 'the short controls are stretched again');
    assert.match(text, /id="playground-response"/, 'nothing identifies the panel the answer lands in');
  });
});

describe('a metric value is not a heading', () => {
  it('gives each page exactly one <h2>, its title', () => {
    for (const [file, text] of pages()) {
      const count = (text.match(/<h2/g) || []).length;
      assert.strictEqual(count, 1, `${file} has ${count} <h2> elements`);
    }
  });
});
