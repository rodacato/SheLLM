'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ADMIN = path.join(__dirname, '../../src/admin');
const CSS = path.join(ADMIN, 'public/css/custom.css');
const VIEWS = path.join(ADMIN, 'views');

// The switch is the one timing the motion audit measured and kept: 150ms is right for a control
// that flips, and it is hand-written CSS rather than a utility.
const TOGGLE_MS = 150;

function views() {
  return fs.readdirSync(VIEWS, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory()
      ? fs.readdirSync(path.join(VIEWS, e.name)).map((f) => path.join(VIEWS, e.name, f))
      : [path.join(VIEWS, e.name)]))
    .filter((f) => f.endsWith('.html'));
}

describe('motion is two durations and one curve', () => {
  let css;
  let root;

  before(() => {
    css = fs.readFileSync(CSS, 'utf8');
    root = /:root\s*\{([\s\S]*?)\}/.exec(css)[0];
  });

  it('declares the scale once, in the same place as the palette', () => {
    for (const name of ['--dur-fast', '--dur-move', '--ease-enter']) {
      assert.ok(root.includes(name), `${name} is declared in :root`);
    }
  });

  it('spends the whole scale — a token nothing uses is a token nobody checks', () => {
    const html = views().map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    assert.ok(/duration-fast/.test(html), 'duration-fast is used');
    assert.ok(/duration-move/.test(html), 'duration-move is used');
  });

  it('has no view naming a duration the scale does not contain', () => {
    const offenders = [];
    for (const file of views()) {
      const text = fs.readFileSync(file, 'utf8');
      for (const [, value] of text.matchAll(/\bduration-(\[[^\]]+\]|\d+)/g)) {
        offenders.push(`${path.relative(ADMIN, file)} sets duration-${value}`);
      }
    }
    assert.deepStrictEqual(offenders, [], offenders.join('\n'));
  });

  it('has nobody retyping the curve, and no second curve in the stylesheet', () => {
    const outsideRoot = css.replace(root, '');
    assert.strictEqual(outsideRoot.includes('cubic-bezier'), false,
      'custom.css retypes a timing function instead of reading --ease-enter');

    for (const file of views()) {
      const text = fs.readFileSync(file, 'utf8');
      const retyped = text.includes('cubic-bezier') && !text.includes('var(--ease-enter)');
      assert.strictEqual(retyped, false, `${path.relative(ADMIN, file)} retypes a timing function`);
    }
  });

  it('leaves no transition without a curve — the two hand-written ones are where drift started', () => {
    const declarations = [...css.matchAll(/transition:\s*([^;]+);/g)].map((m) => m[1].trim());
    assert.ok(declarations.length > 0, 'custom.css still hand-writes a transition — if it stopped, delete this test');

    for (const declaration of declarations) {
      assert.ok(declaration.includes('var(--ease-enter)'),
        `"transition: ${declaration}" falls back to the browser's bare ease`);
      assert.ok(declaration.includes(`${TOGGLE_MS}ms`),
        `"transition: ${declaration}" is outside the scale and is not the switch`);
    }
  });

  it('answers prefers-reduced-motion, and leaves the health dot readable', () => {
    const query = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?\n\})/.exec(css);
    assert.ok(query, 'custom.css answers prefers-reduced-motion');
    assert.match(query[1], /transition-duration:\s*0\.01ms\s*!important/);
    assert.match(query[1], /animation-duration:\s*0\.01ms\s*!important/);
    assert.match(query[1], /\.animate-pulse\s*\{[^}]*opacity:\s*1\s*!important/,
      'the pulse is pinned solid rather than frozen at whatever opacity the last frame had');
  });
});
