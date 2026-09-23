const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CHANGELOG = path.join(__dirname, '..', '..', 'CHANGELOG.md');

function parse() {
  const text = fs.readFileSync(CHANGELOG, 'utf8');
  const headings = [...text.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((m) => m[1]);
  const definitions = [...text.matchAll(/^\[(\d+\.\d+\.\d+)\]:\s*\S+/gm)].map((m) => m[1]);
  return { text, headings, definitions };
}

describe('CHANGELOG', () => {
  it('gives every released version a comparison link', () => {
    const { headings, definitions } = parse();

    assert.ok(headings.length > 1, `expected version headings, found ${headings.length}`);

    const defined = new Set(definitions);
    const unresolved = headings.filter((v) => !defined.has(v));
    assert.deepStrictEqual(
      unresolved,
      [],
      `${unresolved.length} of ${headings.length} versions render as literal text: ${unresolved.join(', ')}`,
    );
  });

  it('defines no link for a version that has no section', () => {
    const { headings, definitions } = parse();
    const released = new Set(headings);
    const orphaned = definitions.filter((v) => !released.has(v));
    assert.deepStrictEqual(orphaned, [], `link defined for a missing section: ${orphaned.join(', ')}`);
  });

  it('keeps an Unreleased link pointing at the newest version', () => {
    const { text, headings } = parse();
    const unreleased = text.match(/^\[Unreleased\]:\s*\S+\/compare\/v(\d+\.\d+\.\d+)\.\.\.HEAD$/m);
    assert.ok(unreleased, 'no [Unreleased] comparison link');
    assert.strictEqual(unreleased[1], headings[0], 'Unreleased compares against a version that is not the newest');
  });
});
