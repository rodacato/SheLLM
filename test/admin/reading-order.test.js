'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGES = path.join(__dirname, '../../src/admin/views/pages');

const page = (name) => fs.readFileSync(path.join(PAGES, name), 'utf8');

function orderOf(text, anchors) {
  return anchors.map(([label, needle]) => {
    const at = text.indexOf(needle);
    assert.notStrictEqual(at, -1, `anchor "${label}" is gone — this check cannot compare positions`);
    return [label, at];
  });
}

describe('what describes the numbers comes before them', () => {
  // The footer keeps its copy for the four short screens. The Overview is 2200px tall, so its
  // footer sits two screens below the fold - the one page that refreshes on a timer was the one
  // page that could not say when it last did.
  it('puts the read stamp in the Overview meta row, above the first panel', () => {
    const [[, read], [, errors]] = orderOf(page('overview.html'), [
      ['read stamp', "'· read ' + lastReadAt"],
      ['errors panel', '>Errors<'],
    ]);
    assert.ok(read < errors, 'the read stamp is below the first panel it describes');
  });
});
