'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const PAGES = ['site/index.html', 'site/api/index.html'];

// White is the kit's text-white and black only darkens overlays; Tailwind ships both, so neither
// has a custom property.
const OUTSIDE_THE_ROOT_BLOCK = ['#ffffff', '#000000'];

function kit() {
  const css = fs.readFileSync(path.join(ROOT, 'src/admin/public/css/custom.css'), 'utf8');
  const root = /:root\s*\{([\s\S]*?)\}/.exec(css)[1];
  const values = [...root.matchAll(/--[\w-]+:\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => m[1].toLowerCase());
  return new Set([...values, ...OUTSIDE_THE_ROOT_BLOCK]);
}

function expand(hex) {
  const h = hex.toLowerCase();
  return h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h;
}

describe('the public site draws only with the admin kit', () => {
  const palette = kit();

  it('reads a real palette — otherwise every check below passes vacuously', () => {
    assert.ok(palette.size >= 20, `expected the kit's colours, found ${palette.size}`);
  });

  for (const page of PAGES) {
    it(`${page} declares no hex colour outside the kit`, () => {
      const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
      const literals = [...html.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)].map((m) => m[0]);
      assert.ok(literals.length > 0, `${page} has colour literals to check`);

      const outside = [...new Set(literals.map(expand))].filter((hex) => !palette.has(hex));
      assert.deepStrictEqual(outside, [], `${page} retypes colours the kit does not have: ${outside.join(', ')}`);
    });
  }
});
