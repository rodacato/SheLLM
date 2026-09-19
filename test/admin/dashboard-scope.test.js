'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '../../src/admin/public');

function dashboardSources() {
  const js = fs.readdirSync(path.join(PUBLIC, 'js'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => [`js/${f}`, fs.readFileSync(path.join(PUBLIC, 'js', f), 'utf8')]);
  return [['index.html', fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8')], ...js];
}

describe('dashboard component scope', () => {
  // $root returns the root ELEMENT of the current component, not its data scope, so `$root.health`
  // reads a property of a <div> and is always undefined. It looked like it worked: the queue panel
  // on the overview showed 0/0 for weeks because `$root.health?.queue?.active ?? 0` fell through
  // to the default, and a panel showing zeros reads as "nothing in the queue".
  it('never reads data through $root', () => {
    const sources = dashboardSources();
    assert.ok(sources.length > 3, 'found almost no dashboard sources — this check proves nothing');

    const offenders = sources
      .flatMap(([name, text]) => text.split('\n').map((line, i) => [name, i + 1, line]))
      .filter(([, , line]) => /\$root\s*\./.test(line));

    assert.deepEqual(
      offenders.map(([name, line]) => `${name}:${line}`),
      [],
      'use the inherited scope for reads, and Alpine.store for state a child writes back',
    );
  });

  it('declares Alpine wherever it reaches for the store', () => {
    for (const [name, text] of dashboardSources()) {
      if (!name.endsWith('.js') || !text.includes('Alpine.store')) continue;
      assert.match(text, /\/\* global Alpine \*\//, `${name} uses Alpine.store without declaring the global`);
    }
  });
});
