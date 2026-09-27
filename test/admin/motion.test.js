'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ADMIN = path.join(__dirname, '../../src/admin');
const CSS = path.join(ADMIN, 'public/css/custom.css');
const VIEWS = path.join(ADMIN, 'views');

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

  // The scale is two durations, and a transition with no token is not outside it by naming a third
  // value — it is outside it by silently taking Tailwind's 150ms default.
  it('has no view animating at a duration it never names', () => {
    const offenders = [];
    for (const file of views()) {
      const text = fs.readFileSync(file, 'utf8');
      for (const [, classes] of text.matchAll(/class="([^"]*\btransition-[a-z]+\b[^"]*)"/g)) {
        if (!/\bduration-(fast|move)\b/.test(classes)) offenders.push(`${path.relative(ADMIN, file)}: ${classes.trim().slice(0, 60)}`);
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

  // The switch kept a 150ms literal after the curve moved to the token, the drift the scale's own
  // comment rules out. Hand-written transitions read the tokens like everything else.
  it('leaves no hand-written transition outside the scale', () => {
    const declarations = [...css.matchAll(/transition:\s*([^;]+);/g)].map((m) => m[1].trim());
    assert.ok(declarations.length > 0, 'custom.css still hand-writes a transition — if it stopped, delete this test');

    for (const declaration of declarations) {
      assert.ok(declaration.includes('var(--ease-enter)'),
        `"transition: ${declaration}" falls back to the browser's bare ease`);
      assert.match(declaration, /var\(--dur-(fast|move)\)/, `"transition: ${declaration}" names no duration of the scale`);
      assert.doesNotMatch(declaration, /\d+m?s\b/, `"transition: ${declaration}" retypes a duration`);
    }
  });

  it('answers prefers-reduced-motion, and leaves any pulse readable', () => {
    const query = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?\n\})/.exec(css);
    assert.ok(query, 'custom.css answers prefers-reduced-motion');
    assert.match(query[1], /transition-duration:\s*0\.01ms\s*!important/);
    assert.match(query[1], /animation-duration:\s*0\.01ms\s*!important/);
    assert.match(query[1], /\.animate-pulse\s*\{[^}]*opacity:\s*1\s*!important/,
      'the pulse is pinned solid rather than frozen at whatever opacity the last frame had');
  });

  // A destructive button and a button that spends real subscription quota both confirmed nothing
  // on press until this landed. The rule is one block; what it must not lose is its reach.
  it('gives every kind of click target a press state', () => {
    const rule = /([^{}]*):active[^{}]*\{([^}]*)\}/.exec(css.replace(/@media[\s\S]*$/, ''));
    assert.ok(rule, 'custom.css declares a press state');

    const selector = rule[0];
    for (const target of ['button:not(:disabled)', 'a:active', 'cursor-pointer']) {
      assert.ok(selector.includes(target), `the press state still reaches ${target}`);
    }
    assert.match(rule[2], /var\(--press-veil\)/, 'and it reads the declared veil rather than a literal');
  });
});

// The sidebar dot pulsed forever, always on screen, and claimed a liveness it never measured: a
// hung gateway kept it pulsing. It now dims on a stale reading, which is the actual signal.
describe('the health dot says liveness without looping', () => {
  it('does not pulse', () => {
    const html = fs.readFileSync(path.join(VIEWS, 'index.html'), 'utf8');
    const dot = /<div class="w-1\.5 h-1\.5 rounded-full"\s*:class="([^"]+)"/.exec(html);
    assert.ok(dot, 'the sidebar health dot is gone — this check proves nothing');
    assert.doesNotMatch(dot[1], /animate-/);
    assert.match(dot[1], /healthStale/, 'the dot no longer dims when its reading goes stale');
  });
});

// The sign-in page idles for hours inside an installed app. Animating top or background-position
// repaints on every frame; transform does not.
describe('the sign-in screen moves only by transform', () => {
  let style;
  before(() => {
    style = /<style>([\s\S]*?)<\/style>/.exec(fs.readFileSync(path.join(ADMIN, 'login.js'), 'utf8'))[1];
  });

  it('animates no layout or paint property', () => {
    const keyframes = [...style.matchAll(/@keyframes\s+(\w+)\s*\{([\s\S]*?\}\s*)\}/g)];
    assert.ok(keyframes.length >= 3, 'found no keyframes — this check proves nothing');
    for (const [, name, body] of keyframes) {
      assert.doesNotMatch(body, /\b(top|left|background-position)\s*:/, `@keyframes ${name} animates a property that repaints`);
    }
  });

  it('overhangs the drifting grid by a tile, so its travel never uncovers an edge', () => {
    assert.match(style, /\.crt-grid\s*\{[^}]*inset:\s*-40px/);
    assert.match(style, /background-size:\s*40px 40px/);
    assert.match(style, /@keyframes drift[^\n]*translate\(40px, 40px\)/);
  });

  it('confirms the press on the one button it has, with the dashboard\'s veil', () => {
    assert.match(style, /button:active\s*\{[^}]*box-shadow:\s*inset 0 0 0 999px var\(--press-veil\)/);
  });

  it('still stops every loop under prefers-reduced-motion', () => {
    const query = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n  \}/.exec(style);
    assert.ok(query, 'the sign-in page stopped answering prefers-reduced-motion');
    assert.match(query[1], /\.crt-grid, \.crt-glow, \.cursor::after\s*\{\s*animation:\s*none/);
    assert.match(query[1], /\.crt-sweep\s*\{\s*display:\s*none/);
  });
});
