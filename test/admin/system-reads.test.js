'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const JS_DIR = path.join(__dirname, '../../src/admin/public/js');
const PAGE = path.join(__dirname, '../../src/admin/views/pages/system.html');

// The page's own files, loaded the way the browser loads them. fetch is the boundary stood in
// for; intervals are recorded so a test can fire one instead of waiting it out.
function loadSystem(fetchImpl) {
  const intervals = [];
  const context = vm.createContext({
    AbortSignal,
    console, Intl, Date, URLSearchParams, Set,
    Alpine: { store: () => undefined },
    fetch: fetchImpl, navigator: { onLine: true },
    setTimeout: (fn) => { Promise.resolve().then(fn); return 0; },
    clearTimeout: () => {},
    setInterval: (fn, ms) => { intervals.push({ fn, ms, cleared: false }); return intervals.length; },
    clearInterval: (id) => { intervals[id - 1].cleared = true; },
    location: { pathname: '/admin/dashboard', hash: '', replace: () => {} },
    window: { addEventListener: () => {} },
    document: { addEventListener: () => {} },
  });
  for (const file of ['app.js', 'system.js']) {
    vm.runInContext(fs.readFileSync(path.join(JS_DIR, file), 'utf8'), context, { filename: file });
  }
  return { page: context.systemPage(), intervals };
}

const json = (status, body) => ({ ok: status < 400, status, json: async () => body, headers: { get: () => null } });

// Answers each admin path from a table and counts what was asked, so a test can say which reads
// a step caused.
function gateway(routes) {
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(url);
    for (const [prefix, answer] of Object.entries(routes)) {
      if (url.startsWith(prefix)) return typeof answer === 'function' ? answer() : answer;
    }
    return json(404, {});
  };
  return { fetchImpl, asked, count: (prefix) => asked.filter((u) => u.startsWith(prefix)).length };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

const systemSection = () => fs.readFileSync(PAGE, 'utf8');

describe('the Build card never shows a dead gateway\'s last reading as live', () => {
  const buildCard = () => {
    const page = systemSection();
    const start = page.indexOf('>Build<');
    const end = page.indexOf('<!-- ================= QUEUE', start);
    assert.ok(start > -1 && end > start, 'the Build card is still a section of the System page');
    return page.slice(start, end);
  };

  const attribute = (card, label, name) => {
    const match = card.slice(card.indexOf(`>${label}</p>`)).match(new RegExp(`${name}="([^"]+)"`));
    assert.ok(match, `${label} renders through ${name}`);
    return match[1];
  };

  const render = (expression, scope) => String(vm.runInNewContext(`(${expression})`, { ...scope }));

  const { page } = loadSystem(async () => json(200, {}));
  const lastGood = {
    formatUptime: page.formatUptime,
    health: { uptime: 7200, status: 'ok', build: { version: '1.4.0', commit: 'abc1234' }, queue: { pending: 3 } },
  };

  it('stops reporting uptime and status once the health read fails', () => {
    const card = buildCard();
    const died = { ...lastGood, healthRead: 'failed' };

    assert.strictEqual(render(attribute(card, 'Uptime', 'x-text'), died), '—');
    assert.strictEqual(render(attribute(card, 'Status', 'x-text'), died), '—');
    assert.doesNotMatch(render(attribute(card, 'Status', ':class'), died), /status-ok/,
      'a gateway that stopped answering is still painted green');
  });

  it('still reports them while the read is live', () => {
    const card = buildCard();
    const live = { ...lastGood, healthRead: 'ok' };

    assert.strictEqual(render(attribute(card, 'Uptime', 'x-text'), live), '2h 0m');
    assert.strictEqual(render(attribute(card, 'Status', 'x-text'), live), 'ok');
    assert.match(render(attribute(card, 'Status', ':class'), live), /text-status-ok/);
  });

  it('falls back to the same dash as its neighbours when the commit is unknown', () => {
    const card = buildCard();
    assert.strictEqual(render(attribute(card, 'Commit', 'x-text'), { health: { build: { commit: null } } }), '—');
  });

  it('does not colour a waiting count the gateway is no longer reporting', () => {
    const page = systemSection();
    const waiting = page.slice(page.indexOf('>Waiting</span>')).match(/:class="([^"]+)"/)[1];
    assert.strictEqual(render(waiting, { ...lastGood, healthRead: 'failed' }), 'text-white');
    assert.strictEqual(render(waiting, { ...lastGood, healthRead: 'ok' }), 'text-status-warn');
  });
});

describe('the System page reads the breaker and the release the way they are written', () => {
  it('paints a half-open circuit in the warning colour', () => {
    const { page } = loadSystem(async () => json(200, {}));
    assert.match(page.circuitClass({ circuit: { state: 'half_open' } }), /text-status-warn/,
      'the breaker emits half_open, and the page compared against half-open');
  });

  it('offers no update to a host that runs ahead of the latest tag', () => {
    const { page } = loadSystem(async () => json(200, {}));
    page.health = { build: { version: '1.5.0' } };

    page.latestRelease = { tag_name: 'v1.4.0' };
    assert.strictEqual(page.updateAvailable, null, 'an older tag was announced as an update');

    page.latestRelease = { tag_name: 'v1.6.0' };
    assert.strictEqual(page.updateAvailable, '1.6.0');
  });
});

describe('the System page says when it could not read the updater', () => {
  it('keeps the reason instead of hiding the block', async () => {
    const { page } = loadSystem(async () => json(500, {}));
    await page.fetchUpdater();

    assert.strictEqual(page.updater, null);
    assert.match(page.updaterError, /500/);
  });

  it('clears it once a read lands', async () => {
    const { page } = loadSystem(async () => json(200, { trigger: 'ready' }));
    page.updaterError = 'the gateway did not answer';
    await page.fetchUpdater();

    assert.strictEqual(page.updaterError, null);
    assert.strictEqual(page.updater.trigger, 'ready');
  });

  it('renders the failure in the same sentence shape as the release line', () => {
    const page = systemSection();
    assert.ok(page.includes('x-text="\'Latest release unknown — \' + releaseError"'), 'the model line moved');
    assert.ok(page.includes('x-text="\'Update status unknown — \' + updaterError"'), 'the updater failure renders nothing');
  });
});

describe('the Settings header does not contradict a failed read', () => {
  it('says the read failed even though the failure opened the section', async () => {
    const { page } = loadSystem(async () => json(500, {}));
    await page.fetchConfig();

    assert.strictEqual(page.settingsExpanded, true, 'the control: the failure has to open the section');
    assert.strictEqual(page.settingsSummary, 'Could not be read');
  });
});

describe('the System page keeps re-reading while it is shown', () => {
  const routes = () => gateway({
    '/admin/providers': json(200, { providers: [{ name: 'claude', enabled: true, circuit: { state: 'open' } }] }),
    '/admin/config': json(200, { settings: [] }),
    '/admin/update': json(200, { trigger: 'ready' }),
  });

  it('reads on entry and again on the health cadence', async () => {
    const host = routes();
    const { page, intervals } = loadSystem(host.fetchImpl);

    page.show();
    await settle();
    assert.strictEqual(host.count('/admin/providers'), 1, 'showing the page did not read the providers');
    assert.strictEqual(host.count('/admin/config'), 1);

    const live = intervals.filter((i) => !i.cleared);
    assert.strictEqual(live.length, 1);
    assert.strictEqual(live[0].ms, 30000);

    live[0].fn();
    await settle();
    assert.strictEqual(host.count('/admin/providers'), 2, 'an open circuit stays on screen after it closed');
  });

  it('does not read again when the effect re-runs, and stops when the page is hidden', async () => {
    const host = routes();
    const { page, intervals } = loadSystem(host.fetchImpl);

    page.show();
    page.show();
    await settle();
    assert.strictEqual(host.count('/admin/providers'), 1, 'every effect re-run fired another read');
    assert.strictEqual(host.count('/admin/update'), 1, 'the updater is read once, not on every re-run');

    page.hide();
    assert.ok(intervals.every((i) => i.cleared), 'a hidden page kept polling');

    page.show();
    await settle();
    assert.strictEqual(host.count('/admin/providers'), 2, 'coming back showed what was read before leaving');
  });
});

describe('the release line on a cold load straight to #system', () => {
  it('waits for health, then asks GitHub about the repository it names', async () => {
    const host = gateway({
      'https://api.github.com/repos/rodacato/SheLLM/': json(200, [{ tag_name: 'v1.4.0', draft: false, prerelease: false }]),
      '/admin/': json(200, {}),
    });
    const { page } = loadSystem(host.fetchImpl);

    page.healthRead = 'pending';
    page.health = { build: null };
    page.show();
    await settle();
    assert.strictEqual(host.count('https://api.github.com'), 0);
    assert.strictEqual(page.releaseError, null, 'an unanswered health read is not a missing repository');

    page.healthRead = 'ok';
    page.health = { build: { version: '1.4.0', repository: 'rodacato/SheLLM' } };
    page.show();
    await settle();
    assert.strictEqual(host.count('https://api.github.com'), 1, 'the release was never asked for once health arrived');
    assert.strictEqual(page.latestRelease.tag_name, 'v1.4.0');
  });

  it('says so when the build names no repository at all', async () => {
    const { page } = loadSystem(async () => json(200, {}));
    page.healthRead = 'ok';
    page.health = { build: { version: '1.4.0', repository: null } };

    page.askForRelease();
    await settle();
    assert.ok(page.releaseError, 'the release line rendered nothing, not even unknown');
  });
});

describe('a refused Pause or Enable is reported on the card that was pressed', () => {
  it('keys the refusal by provider and carries the server\'s reason', async () => {
    const { page } = loadSystem(async () => json(400, { error: 'invalid_request', message: 'No valid fields to update' }));
    await page.toggleProvider({ name: 'claude', enabled: true });

    assert.match(page.toggleErrors.claude, /No valid fields to update/);
    assert.strictEqual(page.toggleErrors.codex, undefined, 'another card claims the refusal');
  });

  it('renders the line inside the provider loop, not after it', () => {
    const page = systemSection();
    const loop = page.slice(page.indexOf('x-for="prov in providers"'), page.indexOf('</template>', page.indexOf('x-for="prov in providers"')));
    assert.match(loop, /x-text="toggleErrors\[prov\.name\]"/);
  });
});

describe('the two read failures on the page end the same way', () => {
  it('closes the providers and the settings error with the same full stop', () => {
    const page = systemSection();
    assert.ok(page.includes("'Could not read the providers — ' + providersError + '.'"), 'the providers line moved');
    assert.ok(page.includes("'Could not read the settings — ' + configError + '.'"), 'the settings line ends differently');
  });
});

describe('the System page\'s own markup', () => {
  it('uses the brand button for both primary actions', () => {
    const buttons = [...systemSection().matchAll(/<button[^>]*>/g)].map((m) => m[0]);
    assert.ok(buttons.some((b) => b.includes('btn-brand')), 'the control: no brand button found');
    for (const button of buttons) {
      assert.doesNotMatch(button, /bg-primary-container/, `a primary button picks its own text colour: ${button.slice(0, 80)}`);
    }
  });

  it('pulses a dot only on the lines that say an update is in flight', () => {
    const page = systemSection();
    const pulses = [...page.matchAll(/<span class="[^"]*animate-pulse[^"]*"[^>]*><\/span>(?:<span x-text="([^"]+)")?([^<]{0,20})/g)];
    assert.strictEqual(pulses.length, 2);
    assert.match(pulses[0][1], /'Updating to '/);
    assert.match(pulses[1][2], /Watching the host/);
    for (const [tag] of pulses) assert.match(tag, /aria-hidden="true"/);
  });

  it('hides its icon ligatures from assistive technology', () => {
    const icons = [...systemSection().matchAll(/<span class="material-symbols-outlined[^"]*"[^>]*>/g)].map((m) => m[0]);
    assert.ok(icons.length >= 1, 'the control: no icon found');
    for (const icon of icons) assert.match(icon, /aria-hidden="true"/, icon);
  });
});
