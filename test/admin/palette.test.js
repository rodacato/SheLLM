'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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

function tailwindConfig() {
  const html = fs.readFileSync(path.join(ADMIN, 'views/index.html'), 'utf8');
  const script = /<script>([\s\S]*?tailwind\.config[\s\S]*?)<\/script>/.exec(html);
  assert.ok(script, 'index.html declares an inline tailwind.config');

  const sandbox = { tailwind: {} };
  vm.runInNewContext(script[1], sandbox);
  return { source: script[1], colors: sandbox.tailwind.config.theme.extend.colors };
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
    const { source, colors } = tailwindConfig();

    const literals = [...source.matchAll(/'(#[0-9a-fA-F]{6})'/g)].map((m) => m[1]);
    assert.deepStrictEqual(literals, [],
      `the Tailwind config retypes ${literals.join(', ')} instead of reading a custom property`);

    const declared = new Set(palette.values());
    const offenders = Object.entries(colors)
      .filter(([name, value]) => !String(value).includes(`var(--${name})`) || !declared.has(name))
      .map(([name]) => name);
    assert.deepStrictEqual(offenders, [],
      `these colours do not read a custom property declared in :root: ${offenders.join(', ')}`);
    assert.ok(colors.surface.includes('var(--surface)'), 'and it does read them — control for the lines above');
  });

  // Tailwind builds bg-outline/20 by substituting <alpha-value> into the colour; a value with no
  // placeholder emits no rule at all, so the modified class fails silently.
  it('keeps every theme colour usable with an alpha modifier', () => {
    const { colors } = tailwindConfig();
    const missing = Object.entries(colors)
      .filter(([, value]) => !String(value).includes('<alpha-value>'))
      .map(([name]) => name);
    assert.deepStrictEqual(missing, [],
      `every /N class on these colours emits nothing: ${missing.join(', ')}`);
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

  // The sign-in page ships one self-contained <style> so it renders when the admin cannot. That
  // earns it a second copy of the palette; it does not earn drift. Consolidating is D20.
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

  // The exemption above says the manifest may carry the literal. It does not say the literal may
  // be the wrong one: background_color was surface-shell, a colour the page never shows full-bleed.
  it('keeps the manifest pinned to the tokens it has to spell out', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ADMIN, 'public/manifest.webmanifest'), 'utf8'));
    const canonical = new Map([...palette].map(([value, name]) => [`--${name}`, value]));

    assert.strictEqual(manifest.background_color.toLowerCase(), canonical.get('--surface'),
      'background_color is what the splash screen resolves into — the body colour, not the chrome');
    assert.strictEqual(manifest.theme_color.toLowerCase(), canonical.get('--surface-shell'),
      'theme_color is the browser chrome, which sits against the sidebar colour');

    const meta = /<meta name="theme-color" content="(#[0-9a-fA-F]{6})">/.exec(
      fs.readFileSync(path.join(ADMIN, 'views/index.html'), 'utf8'));
    assert.ok(meta, 'the page declares a theme colour');
    assert.strictEqual(meta[1].toLowerCase(), manifest.theme_color.toLowerCase(),
      'the page and the manifest disagree about the theme colour');
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
