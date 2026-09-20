'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compose } = require('../../src/admin/views');

const CSS = path.join(__dirname, '../../src/admin/public/css/custom.css');
const AA = 4.5;

// The token itself passes at 5.2:1. The opacity modifiers are what fell below, and they were
// applied to the smallest type in the product - the footer's read stamp and the catalog notes,
// the two places the admin explains itself.
const DIMMED = /\btext-(outline|on-surface-variant|on-surface|error)\/(\d+)\b/;

function palette() {
  const root = /:root\s*\{([\s\S]*?)\}/.exec(fs.readFileSync(CSS, 'utf8'));
  const map = new Map();
  for (const [, name, hex] of root[1].matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
    map.set(name, hex.toLowerCase());
  }
  return map;
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lin = (c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : (((c / 255) + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

function contrast(fgHex, bgHex, alpha) {
  const bg = rgb(bgHex);
  const fg = rgb(fgHex).map((c, i) => alpha * c + (1 - alpha) * bg[i]);
  const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

// The surface an element sits on, resolved by walking the markup rather than assumed.
function dimmedTextOnItsSurface(colours) {
  const stack = [colours.get('surface')];
  const found = [];
  let resolved = 0;

  for (const [, close, tag, attrs] of compose().matchAll(/<(\/?)([a-z][\w-]*)([^>]*)>/gi)) {
    if (close) { if (stack.length > 1) stack.pop(); continue; }
    const selfClosing = /\/$/.test(attrs) || ['br', 'img', 'input', 'meta', 'link', 'hr'].includes(tag.toLowerCase());

    const cls = (/\bclass="([^"]*)"/.exec(attrs) || [, ''])[1];
    const named = (/\bbg-(surface[\w-]*)\b/.exec(cls) || [])[1];
    const surface = named && colours.has(named) ? colours.get(named) : stack[stack.length - 1];
    if (named && colours.has(named)) resolved += 1;

    const dim = DIMMED.exec(cls);
    // Disabled controls are exempt, and the app marks them with cursor-not-allowed. Icon glyphs
    // answer to the 3:1 non-text rule, not this one.
    if (dim && !cls.includes('cursor-not-allowed') && !cls.includes('material-symbols')) {
      found.push({ cls, token: dim[1], alpha: Number(dim[2]) / 100, surface, named });
    }
    if (!selfClosing) stack.push(surface);
  }
  return { found, resolved };
}

describe('the text the operator reads meets AA', () => {
  let colours;

  before(() => { colours = palette(); });

  it('computes a ratio the same way WCAG does', () => {
    const outline = colours.get('outline');
    const card = colours.get('surface-container');
    assert.ok(Math.abs(contrast(outline, card, 1) - 5.16) < 0.05, 'the formula disagrees with a hand-checked value');
    assert.ok(contrast(outline, card, 0.5) < AA, 'a half-opacity outline must read as below AA');
  });

  it('reads the markup rather than falling through to the page background', () => {
    const { resolved } = dimmedTextOnItsSurface(colours);
    assert.ok(resolved >= 20, `only ${resolved} surfaces were resolved from the markup`);
  });

  it('leaves no dimmed text below the threshold', () => {
    const { found } = dimmedTextOnItsSurface(colours);
    const offenders = found
      .map((e) => ({ ...e, ratio: contrast(colours.get(e.token), e.surface, e.alpha) }))
      .filter((e) => e.ratio < AA)
      .map((e) => `text-${e.token}/${e.alpha * 100} on ${e.named || 'inherited'} = ${e.ratio.toFixed(2)}:1`);

    assert.deepStrictEqual(offenders, [], offenders.join('\n'));
  });
});
