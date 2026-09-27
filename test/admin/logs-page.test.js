'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { compose } = require('../../src/admin/views');

const JS_DIR = path.join(__dirname, '../../src/admin/public/js');
const LOGS_HTML = fs.readFileSync(path.join(__dirname, '../../src/admin/views/pages/logs.html'), 'utf8');

// The shell and the Logs component, merged the way Alpine's nested scopes merge them, so the
// page's getters read the shell's health exactly as they do in the browser. Only the network,
// the timers and the clipboard are stood in for.
function logsScreen({ stored = null, deleteAnswer = { status: 200, body: { deleted: 3 } } } = {}) {
  const requests = [];
  const timeouts = [];
  const stores = { nav: { pendingLogFilter: null }, connection: {} };
  const clipboard = { written: [], works: true };

  const context = vm.createContext({
    AbortSignal,
    console,
    URLSearchParams,
    Alpine: { store: (name) => stores[name] },
    document: { hidden: false, addEventListener() {} },
    navigator: {
      clipboard: {
        writeText: async (text) => {
          if (!clipboard.works) throw new Error('denied');
          clipboard.written.push(text);
        },
      },
    },
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: (fn, ms) => { timeouts.push({ fn, ms }); return timeouts.length; },
    clearTimeout: () => {},
    confirm: () => true,
    fetch: async (url, options = {}) => {
      const method = options.method || 'GET';
      requests.push(`${method} ${url}`);
      if (method === 'DELETE') {
        return { ok: deleteAnswer.status < 300, status: deleteAnswer.status, json: async () => deleteAnswer.body };
      }
      if (url.startsWith('/admin/stats')) {
        return { ok: true, status: 200, json: async () => ({ window: { hours: 19 }, timeline: [], by_client: [], by_model: [] }) };
      }
      return { ok: true, status: 200, json: async () => ({ logs: [], total: 0 }) };
    },
    location: { pathname: '/admin/dashboard', hash: '', replace() {} },
    window: { addEventListener() {} },
    localStorage: { getItem: () => stored, setItem: () => {} },
  });

  for (const file of ['app.js', 'logs.js']) {
    vm.runInContext(fs.readFileSync(path.join(JS_DIR, file), 'utf8'), context, { filename: file });
  }

  const merged = {};
  for (const source of [vm.runInContext('app()', context), vm.runInContext('logsPage()', context)]) {
    Object.defineProperties(merged, Object.getOwnPropertyDescriptors(source));
  }

  const screen = {
    page: merged,
    requests,
    timeouts,
    stores,
    clipboard,
    reads: () => requests.filter((r) => r.startsWith('GET /admin/logs')).length,
    queue(jobs, readAt = Date.now()) {
      merged.health = { ...merged.health, queue: { in_flight: jobs, timeout_ms: 600000 }, readAt };
      merged.healthRead = 'ok';
    },
  };
  return screen;
}

const job = (id, age = 1000) => ({ request_id: id, state: 'running', age_ms: age, path: '/v1/messages' });
const ids = (jobs) => Array.from(jobs, (j) => j.request_id);

describe('the in-flight rows do not move while the table is standing still', () => {
  it('keeps the rows it showed at the last read while auto-refresh is off', async () => {
    const { page, queue } = logsScreen();
    queue([job('a'), job('b')]);
    await page.fetchLogs();

    queue([job('b'), job('c')]);
    assert.deepStrictEqual(ids(page.shownInFlight), ['a', 'b'], 'the health poll reshuffled rows nobody asked to re-read');
    assert.deepStrictEqual(ids(page.inFlight), ['b', 'c'], 'the shell read did land — otherwise this proves nothing');
  });

  it('keeps counting their ages while they are held', async () => {
    const { page, queue } = logsScreen();
    const readAt = Date.now();
    queue([job('a', 1000)], readAt);
    await page.fetchLogs();
    queue([], readAt + 5000);

    page.now = readAt + 3000;
    assert.strictEqual(page.shownJobAge(page.shownInFlight[0]), 4000, 'a frozen row stopped its clock');
  });

  it('holds while a row is open with auto-refresh on, and lets go when it closes', () => {
    const { page, queue } = logsScreen({ stored: '10000' });
    queue([job('a')]);
    page.toggleRow(7);

    queue([job('z')]);
    assert.deepStrictEqual(ids(page.shownInFlight), ['a'], 'the rows moved under an open detail');

    page.toggleRow(7);
    assert.deepStrictEqual(ids(page.shownInFlight), ['z'], 'closing the row did not release the queue');
  });

  it('follows the queue live while the table itself is live', () => {
    const { page, queue } = logsScreen({ stored: '10000' });
    queue([job('a')]);
    queue([job('b')]);
    assert.deepStrictEqual(ids(page.shownInFlight), ['b']);
  });

  it('takes the current queue on a manual refresh', async () => {
    const { page, queue } = logsScreen();
    queue([job('a')]);
    await page.fetchLogs();
    queue([job('b')]);
    await page.fetchLogs();
    assert.deepStrictEqual(ids(page.shownInFlight), ['b']);
  });
});

describe('a request that finishes shows up in the table without a press', () => {
  it('re-reads once when a request leaves the queue on page 1', async () => {
    const { page, queue, reads } = logsScreen();
    queue([job('a'), job('b')]);
    page.noticeInFlight();
    assert.strictEqual(reads(), 0, 'the first sight of the queue is not a departure');

    queue([job('b')]);
    page.noticeInFlight();
    page.noticeInFlight();
    assert.strictEqual(reads(), 1, 'a finished request should bring its row in, exactly once');
  });

  it('does not re-read when the queue only grew', () => {
    const { page, queue, reads } = logsScreen();
    queue([job('a')]);
    page.noticeInFlight();
    queue([job('a'), job('b')]);
    page.noticeInFlight();
    assert.strictEqual(reads(), 0);
  });

  it('leaves the table alone while a row is open or a later page is showing', () => {
    const { page, queue, reads } = logsScreen();
    queue([job('a')]);
    page.noticeInFlight();

    page.expandedId = 3;
    queue([]);
    page.noticeInFlight();
    assert.strictEqual(reads(), 0, 'the rows were replaced under an open detail');

    const other = logsScreen();
    other.queue([job('a')]);
    other.page.noticeInFlight();
    other.page.offset = 25;
    other.queue([]);
    other.page.noticeInFlight();
    assert.strictEqual(other.reads(), 0, 'page 2 was re-read under the operator');
  });
});

describe('Delete logs', () => {
  it('re-reads the table, the band and the filter options once the rows are gone', async () => {
    const { page, requests } = logsScreen();
    page.offset = 50;
    await page.clearLogs();

    assert.ok(requests.includes('DELETE /admin/logs'));
    assert.ok(requests.some((r) => r.startsWith('GET /admin/logs?') && r.includes('offset=0')),
      'the table kept showing rows that no longer exist');
    assert.ok(requests.includes('GET /admin/stats'), 'the band kept counting deleted requests');
    assert.strictEqual(page.deleteError, null);
  });

  it('says inline why nothing was deleted, with the server\'s reason', async () => {
    const { page, requests } = logsScreen({ deleteAnswer: { status: 403, body: { message: 'read-only key' } } });
    await page.clearLogs();

    assert.strictEqual(page.deleteError, 'Could not delete the logs — read-only key');
    assert.ok(!requests.includes('GET /admin/stats'), 'a refused delete re-read as if it had worked');
  });
});

describe('filters that arrive from another page', () => {
  it('drops a provider left over from before, and lists what no select can show', () => {
    const { page, stores } = logsScreen();
    page.filterProvider = 'codex';
    page.expandedId = 4;
    stores.nav.pendingLogFilter = { status: '429', error_code: 'rate_limited' };

    assert.strictEqual(page.applyPendingFilter(), true);
    assert.strictEqual(page.filterProvider, '', 'a stale provider narrowed the arriving filter');
    assert.strictEqual(page.expandedId, null, 'an open row would hold the read the new filter needs');
    assert.deepStrictEqual(Array.from(page.hiddenFilters, (f) => `${f.label} ${f.value}`), ['Status 429', 'Error rate_limited']);
  });

  it('does not list a status class the select already shows', () => {
    const { page } = logsScreen();
    page.filterStatus = '5';
    assert.strictEqual(page.hiddenFilters.length, 0);
  });

  it('drops one of them and re-reads from the top', async () => {
    const { page, requests } = logsScreen();
    page.filterStatus = '429';
    page.filterErrorCode = 'rate_limited';
    page.offset = 25;
    await page.dropFilter('filterErrorCode');

    assert.strictEqual(page.filterErrorCode, '');
    assert.strictEqual(page.filterStatus, '429', 'dropping one chip cleared the others');
    assert.ok(requests.at(-1).includes('status=429') && !requests.at(-1).includes('error_code'));
    assert.ok(requests.at(-1).includes('offset=0'));
  });
});

describe('the summary band', () => {
  it('says it ignores the filters above it', () => {
    const { page } = logsScreen();
    page.stats = { window: { hours: 19 } };
    assert.strictEqual(page.windowSpan(), 'last 19 h · not filtered');
  });

  it('draws errors as a share of each bar, not as the colour of the whole bar', () => {
    const { page } = logsScreen();
    page.stats = { timeline: [{ requests: 100, errors: 1 }, { requests: 50, errors: 50 }, { requests: 0, errors: 0 }] };
    const bars = page.sparkBuckets;

    assert.deepStrictEqual(Array.from(bars, (b) => b.height), [100, 50, 8]);
    assert.deepStrictEqual(Array.from(bars, (b) => b.errorShare), [1, 100, 0], 'one failure in a hundred painted a whole bar red');
  });
});

describe('the refresh glyph', () => {
  it('turns for at least one whole turn', () => {
    const { page, timeouts } = logsScreen();
    page.manualLoading = true;
    page.settleSpinner(Date.now());
    assert.ok(timeouts.at(-1).ms > 490 && timeouts.at(-1).ms <= 500, `held ${timeouts.at(-1).ms}ms`);
  });

  it('stops on the next whole turn, never mid-arc', () => {
    const { page, timeouts } = logsScreen();
    page.manualLoading = true;
    page.settleSpinner(Date.now() - 620);
    const held = timeouts.at(-1).ms;
    assert.ok(held > 370 && held <= 380, `released at ${620 + held}ms, not on a turn`);
    timeouts.at(-1).fn();
    assert.strictEqual(page.manualLoading, false);
  });
});

describe('the request id copies with one press', () => {
  it('marks the id it copied', async () => {
    const { page, clipboard } = logsScreen();
    await page.copy('req-9', 'req_abc');
    assert.deepStrictEqual(clipboard.written, ['req_abc']);
    assert.strictEqual(page.copied, 'req-9');
  });

  it('says so when the clipboard is out of reach', async () => {
    const { page, clipboard } = logsScreen();
    clipboard.works = false;
    await page.copy('req-9', 'req_abc');
    assert.strictEqual(page.copied, null);
    assert.strictEqual(page.copyError, 'req-9');
  });
});

describe('revisiting the page reads it again', () => {
  it('reads on arrival even with auto-refresh off, and only once per visit', () => {
    const { page, reads } = logsScreen();
    page.startAutoRefresh();
    page.startAutoRefresh();
    assert.strictEqual(reads(), 1);

    page.stopAutoRefresh();
    page.startAutoRefresh();
    assert.strictEqual(reads(), 2, 'coming back showed the rows from the last visit');
  });
});

describe('the Logs markup', () => {
  const page = () => {
    const html = compose();
    const start = html.indexOf('<!-- LOGS PAGE -->');
    const end = html.indexOf(' PAGE -->', start + 20);
    return html.slice(start, html.lastIndexOf('<!--', end));
  };

  it('names the destructive action for what it does', () => {
    const button = page().slice(page().indexOf('@click="clearLogs()"'), page().indexOf('</button>', page().indexOf('@click="clearLogs()"')));
    assert.match(button, /Delete logs/);
    assert.match(button, />delete_forever</);
    assert.doesNotMatch(button, /filter_list_off/, 'it wears the clear-filters icon again');
  });

  it('does not count zero logs while the first read is still loading', () => {
    const count = /<div x-show="([^"]*)"[^>]*x-text="total \+ ' total logs found'"/.exec(page());
    assert.ok(count, 'the result count is gone');
    assert.match(count[1], /!loading/);
    assert.doesNotMatch(count[0], /italic/);
  });

  it('opens a row from a button that says whether it is open', () => {
    const loop = page().slice(page().indexOf('<template x-for="log in logs"'));
    const firstCell = loop.slice(loop.indexOf('<td'), loop.indexOf('</td>'));
    assert.match(firstCell, /<button type="button" @click\.stop="toggleRow\(log\.id\)"/);
    assert.match(firstCell, /:aria-expanded="expandedId === log\.id"/);
  });

  it('offers to clear the filters when they are what emptied the table', () => {
    const empty = page().slice(page().indexOf('<tr x-show="logs.length === 0">'));
    assert.match(empty.slice(0, empty.indexOf('</tr>')), /hasFilters[\s\S]*clearFilters\(\)/);
  });

  it('hides every icon glyph from screen readers', () => {
    const glyphs = LOGS_HTML.match(/<span class="material-symbols-outlined[^>]*>/g) || [];
    assert.ok(glyphs.length > 5);
    for (const tag of glyphs) assert.match(tag, /aria-hidden="true"/, tag);
  });

  it('binds every label to its control', () => {
    const labels = LOGS_HTML.match(/<label[^>]*>/g) || [];
    assert.strictEqual(labels.length, 5);
    for (const tag of labels) {
      const id = /for="([^"]+)"/.exec(tag);
      assert.ok(id, `unbound: ${tag}`);
      assert.ok(LOGS_HTML.includes(`id="${id[1]}"`), `no control has id ${id[1]}`);
    }
  });

  it('titles the page with its one h1', () => {
    assert.strictEqual((LOGS_HTML.match(/<h1\b/g) || []).length, 1);
    assert.strictEqual((LOGS_HTML.match(/<h2\b/g) || []).length, 0);
  });
});
