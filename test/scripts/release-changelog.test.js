'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { groupCommits, formatEntry, mergeLinkBlock, TYPE_LABELS, TYPE_ORDER } = require('../../scripts/release-changelog');

const commit = (subject, hash = 'a'.repeat(40)) => ({ subject, hash, author: 'Adrian Castillo' });

function entryFor(subjects) {
  const { groups, breaking, dropped } = groupCommits(subjects.map((s) => commit(s)));
  return { entry: formatEntry('9.9.9', '2026-09-20', groups, breaking), dropped };
}

describe('release-changelog', () => {
  it('files each type under its label', () => {
    const { entry } = entryFor([
      'feat(admin): a new thing',
      'fix(api): a broken thing',
      'docs: a written thing',
    ]);

    assert.match(entry, /### Added\n\n- \*\*admin:\*\* a new thing/);
    assert.match(entry, /### Fixed\n\n- \*\*api:\*\* a broken thing/);
    assert.match(entry, /### Documentation\n\n- a written thing/);
  });

  // perf, refactor and style all read as Changed. Iterating types printed that heading once per
  // type, so a release carrying two of them got two Changed sections.
  it('prints one section per label, not one per type', () => {
    const { entry } = entryFor([
      'perf(db): a faster thing',
      'refactor(admin): a tidier thing',
      'style(admin): a smaller thing',
    ]);

    assert.strictEqual(entry.match(/### Changed/g).length, 1);
    for (const description of ['a faster thing', 'a tidier thing', 'a smaller thing']) {
      assert.ok(entry.includes(description), `${description} is under it`);
    }
  });

  // v1.6.0 dropped six commits because their type was not in TYPE_ORDER, and said nothing.
  it('reports what it leaves out, and why', () => {
    const { entry, dropped } = entryFor([
      'feat(admin): a new thing',
      'design(admin): a drawn thing',
      'wibble(admin): a thing nobody planned for',
      'not a conventional commit at all',
    ]);

    assert.strictEqual(dropped.length, 3);
    assert.ok(!entry.includes('a drawn thing'), 'design stays out of an operator changelog');

    const reasons = Object.fromEntries(dropped.map((d) => [d.subject, d.why]));
    assert.match(reasons['design(admin): a drawn thing'], /Log frame/, 'and says why it is out');
    assert.match(reasons['wibble(admin): a thing nobody planned for'], /unknown type "wibble"/);
    assert.match(reasons['not a conventional commit at all'], /not a conventional commit/);
  });

  it('drops nothing it can file', () => {
    const { dropped } = entryFor(TYPE_ORDER.map((type) => `${type}(scope): a ${type} thing`));
    assert.deepStrictEqual(dropped, []);
  });

  it('puts a breaking change first, and keeps it in its own section too', () => {
    const { entry } = entryFor(['feat(api)!: a thing that breaks an install']);

    assert.ok(entry.indexOf('### Breaking Changes') < entry.indexOf('### Added'));
    assert.strictEqual(entry.match(/a thing that breaks an install/g).length, 2);
  });

  it('labels every type it orders — a heading of "style" means the map was missed', () => {
    for (const type of TYPE_ORDER) {
      assert.ok(TYPE_LABELS[type], `${type} is ordered but has no label`);
    }
  });
});

const REPO = 'https://github.com/rodacato/SheLLM';

const EXISTING_LINKS = [
  '',
  '## [1.8.0] - 2026-09-20',
  '',
  '- something',
  '',
  `[Unreleased]: ${REPO}/compare/v1.8.0...HEAD`,
  `[1.8.0]: ${REPO}/compare/v1.7.0...v1.8.0`,
  `[1.7.0]: ${REPO}/compare/v1.6.1...v1.7.0`,
  '',
].join('\n');

// v1.9.0 shipped with 17 of 18 versions unlinked: the release step deleted the whole block and
// re-added two lines.
describe('release-changelog link block', () => {
  it('keeps every released version when a new one is cut', () => {
    const merged = mergeLinkBlock(EXISTING_LINKS, '1.9.0', 'v1.8.0', REPO);

    assert.match(merged, /^\[Unreleased\]: .+\/compare\/v1\.9\.0\.\.\.HEAD$/m);
    assert.match(merged, /^\[1\.9\.0\]: .+\/compare\/v1\.8\.0\.\.\.v1\.9\.0$/m);
    assert.match(merged, /^\[1\.8\.0\]: .+\/compare\/v1\.7\.0\.\.\.v1\.8\.0$/m);
    assert.match(merged, /^\[1\.7\.0\]: .+\/compare\/v1\.6\.1\.\.\.v1\.7\.0$/m);
  });

  it('carries exactly one Unreleased line forward', () => {
    const merged = mergeLinkBlock(EXISTING_LINKS, '1.9.0', 'v1.8.0', REPO);
    const unreleased = merged.split('\n').filter((line) => line.startsWith('[Unreleased]:'));
    assert.strictEqual(unreleased.length, 1);
  });

  it('grows the block by one line per release', () => {
    const before = EXISTING_LINKS.match(/^\[\d+\.\d+\.\d+\]:/gm).length;
    const after = mergeLinkBlock(EXISTING_LINKS, '1.9.0', 'v1.8.0', REPO).match(/^\[\d+\.\d+\.\d+\]:/gm).length;
    assert.strictEqual(after, before + 1);
  });

  it('still works on a changelog that has no link block yet', () => {
    const merged = mergeLinkBlock('## [0.1.0]\n\n- first\n', '0.1.0', null, REPO);
    assert.match(merged, /^\[0\.1\.0\]: .+\/compare\/v0\.0\.0\.\.\.v0\.1\.0$/m);
  });
});
