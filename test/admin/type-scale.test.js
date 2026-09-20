'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const VIEWS = path.join(__dirname, '../../src/admin/views');

// Seven steps for text, three for icons, and one spelling each. The product had two sizes used
// once apiece — a 9px footer and a 16px icon written as text-base while its four siblings were
// written as text-[16px] — which is how a scale becomes fifteen sizes one decision at a time.
const TEXT = new Set(['text-[10px]', 'text-[11px]', 'text-xs', 'text-sm', 'text-lg', 'text-xl', 'text-2xl']);
const ICON = new Set(['text-[16px]', 'text-[18px]', 'text-[20px]']);

const SIZE = /\btext-(?:\[\d+(?:\.\d+)?(?:px|rem|em)\]|xs|sm|base|lg|xl|[2-9]xl)/g;

function classAttributes() {
  const files = fs.readdirSync(VIEWS, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory()
      ? fs.readdirSync(path.join(VIEWS, e.name)).map((f) => path.join(VIEWS, e.name, f))
      : [path.join(VIEWS, e.name)]))
    .filter((f) => f.endsWith('.html'));

  return files.flatMap((file) => {
    const text = fs.readFileSync(file, 'utf8');
    return [...text.matchAll(/class="([^"]*)"/g)].map((m) => ({
      file: path.relative(VIEWS, file),
      line: text.slice(0, m.index).split('\n').length,
      value: m[1],
    }));
  });
}

describe('the type scale is seven steps and three icon sizes', () => {
  const attributes = classAttributes();

  it('reads enough markup for the checks below to mean anything', () => {
    assert.ok(attributes.length >= 200, `only ${attributes.length} class attributes found`);
    const sized = attributes.filter((a) => a.value.match(SIZE));
    assert.ok(sized.length >= 100, `only ${sized.length} of them set a size`);
  });

  it('names no size outside the scale', () => {
    const offenders = [];
    for (const { file, line, value } of attributes) {
      for (const size of value.match(SIZE) || []) {
        if (TEXT.has(size) || ICON.has(size)) continue;
        offenders.push(`${file}:${line} uses ${size}`);
      }
    }
    assert.deepStrictEqual(offenders, [], offenders.join('\n'));
  });

  it('keeps the icon sizes on icons, where 18 and 20 mean something different', () => {
    const offenders = [];
    for (const { file, line, value } of attributes) {
      for (const size of value.match(SIZE) || []) {
        if (!ICON.has(size)) continue;
        if (value.includes('material-symbols-outlined')) continue;
        offenders.push(`${file}:${line} sets ${size} on something that is not an icon`);
      }
    }
    assert.deepStrictEqual(offenders, [], offenders.join('\n'));
  });

  it('spends every step it declares', () => {
    const used = new Set(attributes.flatMap((a) => a.value.match(SIZE) || []));
    for (const size of [...TEXT, ...ICON]) {
      assert.ok(used.has(size), `${size} is in the scale and nothing uses it — drop it or use it`);
    }
  });
});
