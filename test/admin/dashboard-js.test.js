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

function systemPage(fetchImpl) {
  const { context, location } = loadDashboard(fetchImpl);
  const page = vm.runInContext('systemPage()', context);
  page.health = { build: { version: '1.3.0', repository: 'rodacato/SheLLM' } };
  return { page, location };
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

describe('the update button', () => {
  const READY = { trigger: 'ready', trigger_help: null, pending: false };
  const PREVIOUS = { ref: 'v1.3.0', state: 'ok', detail: 'running v1.3.0', started_at: '2026-09-19T00:00:00Z' };

  // A fake host: it answers the POST once, then walks the status file through the states the
  // runner really writes, one per poll.
  function host(states) {
    const calls = { post: 0, get: 0, canRequestWhenAsked: [] };
    let page = null;
    const fetchImpl = async (url, options = {}) => {
      if (options.method === 'POST') {
        calls.post += 1;
        if (calls.post > 1) return json(409, { error: { code: 'update_pending', message: 'already waiting' } });
        return json(202, { requested: 'v1.4.0', from: '1.3.0' });
      }
      calls.get += 1;
      // Whether a second press is possible is only meaningful while the first one is in flight.
      calls.canRequestWhenAsked.push(page.canRequest);
      return json(200, states[Math.min(calls.get - 1, states.length - 1)]);
    };
    const made = systemPage(fetchImpl);
    page = made.page;
    Object.assign(page, { updater: { ...READY, last: PREVIOUS }, target: 'v1.4.0' });
    return { ...made, calls };
  }

  it('cannot be pressed a second time while the first request is in flight', async () => {
    const { page, calls } = host([
      { ...READY, pending: true, last: PREVIOUS },
      { ...READY, last: { ref: 'v1.4.0', state: 'running', started_at: '2026-09-20T02:00:00Z' } },
      { ...READY, last: { ref: 'v1.4.0', state: 'ok', detail: 'running v1.4.0', started_at: '2026-09-20T02:00:00Z', finished_at: '2026-09-20T02:04:45Z' } },
    ]);

    assert.strictEqual(page.canRequest, true, 'the button starts enabled or this test proves nothing');
    await page.requestUpdate();

    assert.strictEqual(calls.post, 1);
    assert.ok(calls.get > 0, 'the page never polled for the result');
    assert.deepEqual(
      calls.canRequestWhenAsked.filter(Boolean),
      [],
      'the button went back to enabled while the update was still running — which is how one '
      + 'press becomes two and the second one gets a 409',
    );
  });

  it('says what it is doing from the press until the run ends', async () => {
    const { page } = host([
      { ...READY, pending: true, last: PREVIOUS },
      { ...READY, last: { ref: 'v1.4.0', state: 'ok', detail: 'running v1.4.0', started_at: '2026-09-20T02:00:00Z' } },
    ]);

    assert.strictEqual(page.updateButtonLabel, 'update this host');
    const inFlight = page.requestUpdate();
    assert.notStrictEqual(page.updateButtonLabel, 'update this host', 'the press changed nothing visible');
    await inFlight;
  });

  it('reloads the page once the run it asked for reports ok', async () => {
    const { page, location } = host([
      { ...READY, pending: true, last: PREVIOUS },
      { ...READY, last: { ref: 'v1.4.0', state: 'running', started_at: '2026-09-20T02:00:00Z' } },
      { ...READY, last: { ref: 'v1.4.0', state: 'ok', detail: 'running v1.4.0', started_at: '2026-09-20T02:00:00Z', finished_at: '2026-09-20T02:04:45Z' } },
    ]);

    await page.requestUpdate();
    assert.strictEqual(location.reloads, 1,
      'the version, the commit and the uptime all belong to a process that no longer exists');
  });

  it('does not mistake the previous run\'s outcome for this one', async () => {
    // The status file still holds the last run until the runner overwrites it, and between the
    // request being claimed and the first `running` record there is a window where a poll sees
    // no pending request and an `ok` status — the wrong one.
    const { page, location, calls } = host([
      { ...READY, pending: false, last: PREVIOUS },
      { ...READY, pending: false, last: PREVIOUS },
      { ...READY, last: { ref: 'v1.4.0', state: 'ok', detail: 'running v1.4.0', started_at: '2026-09-20T02:00:00Z', finished_at: '2026-09-20T02:04:45Z' } },
    ]);

    await page.requestUpdate();
    assert.strictEqual(location.reloads, 1);
    assert.ok(calls.get >= 3, `stopped after ${calls.get} polls: it accepted the previous run's status as its own`);
  });

  it('reports a refused request and leaves the button usable', async () => {
    // Whatever the page believes, the server is the one that decides. This is the 409 the second
    // press used to get, arriving on the first.
    const refuse = async () => json(409, { error: { code: 'update_pending', message: 'An update request is already waiting to be picked up' } });
    const { page, location } = systemPage(refuse);
    Object.assign(page, { updater: { ...READY, last: PREVIOUS }, target: 'v1.4.0' });

    await page.requestUpdate();

    assert.match(page.updateError, /already waiting/);
    assert.strictEqual(page.busy, null, 'a refused request must not leave the button stuck');
    assert.strictEqual(page.watching, false, 'there is nothing to watch: nothing was requested');
    assert.strictEqual(location.reloads, 0);
  });
});
