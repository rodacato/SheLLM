'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ADMIN = path.join(__dirname, '../../src/admin');
const CSS = path.join(ADMIN, 'public/css/custom.css');

// Browser chrome the CSS cannot reach: a web manifest is JSON and <meta name="theme-color"> is
// read before any stylesheet applies. Both are allowed to carry the literal.
const LITERAL_IS_THE_ONLY_OPTION = ['public/manifest.webmanifest', 'views/index.html:theme-color'];

function paletteFromRoot() {
  const css = fs.readFileSync(CSS, 'utf8');
  const root = /:root\s*\{([\s\S]*?)\}/.exec(css);
  assert.ok(root, 'custom.css declares the palette in :root');

  const palette = new Map();
  for (const [, name, value] of root[1].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    palette.set(value.toLowerCase(), name);
  }
  return { palette, rootBlock: root[0], css };
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return /\.(html|js|css)$/.test(e.name) ? [full] : [];
  });
}

describe('the palette is declared once and never retyped', () => {
  let palette;
  let rootBlock;

  before(() => { ({ palette, rootBlock } = paletteFromRoot()); });

  it('declares a useful number of colours — otherwise the checks below are vacuous', () => {
    assert.ok(palette.size >= 19, `expected the whole palette in :root, found ${palette.size}`);
  });

  it('has the Tailwind config read those declarations rather than repeat them', () => {
    const html = fs.readFileSync(path.join(ADMIN, 'views/index.html'), 'utf8');
    const colors = /colors:\s*\{([\s\S]*?)\n\s*\},/.exec(html);
    assert.ok(colors, 'the config declares a colors block');

    const literals = [...colors[1].matchAll(/'(#[0-9a-fA-F]{6})'/g)].map((m) => m[1]);
    assert.deepStrictEqual(literals, [],
      `the Tailwind config retypes ${literals.join(', ')} instead of reading a custom property`);
    assert.ok(colors[1].includes('var(--surface)'), 'and it does read them — control for the line above');
  });

  it('finds no palette value retyped anywhere the dashboard can reach a custom property', () => {
    const offenders = [];
    for (const file of walk(ADMIN)) {
      let text = fs.readFileSync(file, 'utf8');
      if (file === CSS) text = text.replace(rootBlock, '');
      const rel = path.relative(ADMIN, file);
      if (rel === 'login.js') continue;

      for (const [value, name] of palette) {
        const at = text.toLowerCase().indexOf(value);
        if (at === -1) continue;
        if (LITERAL_IS_THE_ONLY_OPTION.some((a) => a.startsWith(rel) && text.slice(at - 80, at).includes('theme-color'))) continue;
        offenders.push(`${rel} retypes ${value}, which is --${name}`);
      }
    }
    assert.deepStrictEqual(offenders, [], offenders.join('\n'));
  });

  // The sign-in page ships one self-contained <style> on purpose: it has to render when the rest
  // of the admin cannot. That earns it a second copy of the palette — it does not earn drift, so
  // every colour it names is pinned to the canonical declaration. Consolidating is D20.
  it('keeps the sign-in page pinned to the same values it duplicates', () => {
    const login = fs.readFileSync(path.join(ADMIN, 'login.js'), 'utf8');
    const aliases = {
      '--bg': '--surface', '--panel': '--surface-container', '--line': '--outline-variant',
      '--text': '--on-surface', '--accent': '--primary-container', '--error': '--error',
      '--error-bg': '--surface-container-lowest', '--muted': '--outline', '--on-accent': '--on-primary',
    };
    const canonical = new Map([...palette].map(([v, n]) => [`--${n}`, v]));

    for (const [alias, name] of Object.entries(aliases)) {
      const found = new RegExp(`${alias}:\\s*(#[0-9a-fA-F]{6})`).exec(login);
      assert.ok(found, `the sign-in page still declares ${alias} — if it stopped, delete this test`);
      assert.strictEqual(found[1].toLowerCase(), canonical.get(name),
        `sign-in's ${alias} has drifted from ${name}`);
    }
  });

  it('leaves no arbitrary Tailwind colour values in the markup', () => {
    const offenders = [];
    for (const file of walk(path.join(ADMIN, 'views'))) {
      const text = fs.readFileSync(file, 'utf8');
      for (const [, cls] of text.matchAll(/((?:bg|text|border|accent|fill)-\[#[0-9a-fA-F]{3,8}\])/g)) {
        offenders.push(`${path.relative(ADMIN, file)} uses ${cls}`);
      }
    }
    assert.deepStrictEqual(offenders, [], offenders.join('\n'));
  });
});
