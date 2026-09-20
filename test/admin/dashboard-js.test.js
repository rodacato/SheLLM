'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const JS_DIR = path.join(__dirname, '../../src/admin/public/js');

// The dashboard's scripts are plain browser files, so they are loaded here the way the browser
// loads them — in order, into one shared global — and exercised for real. The only things stubbed
// are the two boundaries this code does not own: `fetch` and `window.location`.
function loadDashboard(fetchImpl) {
  let waits = 0;
  const location = { pathname: '/admin/dashboard', hash: '#system', reloads: 0 };
  location.reload = () => { location.reloads += 1; };
  location.replace = (url) => { location.replacedWith = url; };

  const context = vm.createContext({
    console,
    // Every wait in the page is a poll interval; firing them at once keeps the real loop and
    // takes the fifteen minutes out of the test. The cap turns a watch loop that never reaches
    // its exit into a fast failure instead of a run that hangs until the real deadline.
    setTimeout: (fn) => {
      if ((waits += 1) > 50) throw new Error('the page polled 50 times without deciding the run was over');
      Promise.resolve().then(fn);
      return 0;
    },
    clearTimeout: () => {},
    setInterval: () => 0,
    fetch: fetchImpl,
    document: { addEventListener: () => {} },
    location,
    window: { location, addEventListener: () => {} },
  });

  for (const file of ['app.js', 'system.js']) {
    vm.runInContext(fs.readFileSync(path.join(JS_DIR, file), 'utf8'), context, { filename: file });
  }
  return { context, location };
}

const json = (status, body) => ({ ok: status < 400, status, json: async () => body });

describe('formatTime', () => {
  const format = () => {
    const { context } = loadDashboard(async () => json(200, {}));
    return (value) => vm.runInContext('formatTime', context)(value);
  };

  // The System page read "Last update: running v1.4.0 · NaN/NaN NaN:NaN:NaN" on a host that had
  // just updated successfully. `new Date(value + 'Z')` on a value that already ends in Z is an
  // Invalid Date, and every component of it formats as NaN.
  it('formats an instant that already carries its timezone', () => {
    const formatted = format()('2026-09-20T02:04:45Z');
    assert.doesNotMatch(formatted, /NaN/, 'the updater writes a full ISO instant, ending in Z');
    assert.match(formatted, /^\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  // SQLite writes `datetime('now')` as UTC with nothing saying so, and every other caller on the
  // page passes one of those. Reading it as local time would shift every timestamp shown.
  it('still reads a SQLite timestamp as UTC', () => {
    const at = format()('2026-09-20 02:04:45');
    const sameInstant = format()('2026-09-20T02:04:45Z');
    assert.strictEqual(at, sameInstant);
  });

  it('shows a dash rather than NaN for something it cannot parse', () => {
    assert.strictEqual(format()('not a date at all'), '-');
    assert.strictEqual(format()(null), '-');
  });
});
