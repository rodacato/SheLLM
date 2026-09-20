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
  // CSS grid stretches its items, so the Playground's response card was the form's height
  // whether or not an answer had arrived.
  it('lets the Playground response card hug its content', () => {
    const text = fs.readFileSync(path.join(PAGES, 'playground.html'), 'utf8');
    const grid = /<div class="(grid[^"]*lg:grid-cols-2[^"]*)"/.exec(text);
    assert.ok(grid, 'the two-column grid is gone — this check cannot say anything');
    assert.match(grid[1], /items-start/, 'the response card stretches to the form again');
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
