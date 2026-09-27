'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const JS_DIR = path.join(__dirname, '../../src/admin/public/js');
const HTML = fs.readFileSync(path.join(__dirname, '../../src/admin/views/pages/playground.html'), 'utf8');

function fakePanel(top) {
  const scrolls = [];
  return { scrolls, getBoundingClientRect: () => ({ top }), scrollIntoView: (opts) => scrolls.push({ ...opts }) };
}

function loadPlayground({ panel = null, reduceMotion = false, fetch, clipboard } = {}) {
  const context = vm.createContext({
    AbortSignal,
    console, Intl, Date, Math, URLSearchParams, Promise, AbortController, Error, JSON,
    Alpine: { store: () => undefined },
    performance: { now: () => 0 },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    getComputedStyle: () => ({ getPropertyValue: () => '#849397' }),
    document: {
      documentElement: {},
      addEventListener: () => {},
      getElementById: (id) => (id === 'playground-response' ? panel : null),
    },
    navigator: { onLine: true, clipboard },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    location: { origin: 'https://shellm.example', pathname: '/admin/dashboard', hash: '', replace: () => {} },
    window: {
      addEventListener: () => {},
      innerHeight: 1000,
      matchMedia: (q) => ({ matches: reduceMotion && q === '(prefers-reduced-motion: reduce)' }),
    },
    fetch: fetch || (async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) })),
  });
  for (const f of ['app.js', 'playground.js']) {
    vm.runInContext(fs.readFileSync(path.join(JS_DIR, f), 'utf8'), context, { filename: f });
  }
  return context.playgroundPage();
}

const answered = (body) => async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body });

describe('the Playground response panel comes into view when there is something to watch', () => {
  it('reveals the no-key error instead of leaving it below the fold', async () => {
    const panel = fakePanel(1400);
    const page = loadPlayground({ panel });
    await page.send();

    assert.ok(page.error.includes('client key is required'));
    assert.strictEqual(panel.scrolls.length, 1, 'the only feedback for a missing key sat off-screen');
  });

  it('reveals the waiting clock as the request starts, not when it ends', async () => {
    const panel = fakePanel(1400);
    const page = loadPlayground({ panel, fetch: () => new Promise(() => {}) });
    page.apiKey = 'shellm-test';
    page.send();
    await Promise.resolve();

    assert.strictEqual(page.running, true);
    assert.strictEqual(panel.scrolls.length, 1, 'the clock and "stop waiting" are only useful while waiting');
  });

  it('leaves the page alone when the panel is already in view', async () => {
    const panel = fakePanel(500);
    const page = loadPlayground({ panel });
    page.apiKey = 'shellm-test';
    await page.send();

    assert.deepStrictEqual(panel.scrolls, [], 'scrolling a visible panel pulls the prompt away from the next edit');
  });

  it('jumps rather than glides under prefers-reduced-motion', async () => {
    const still = fakePanel(1400);
    const page = loadPlayground({ panel: still, reduceMotion: true });
    await page.send();
    assert.strictEqual(still.scrolls[0].behavior, 'auto', 'an explicit smooth scroll ignores the global CSS guard');

    const moving = fakePanel(1400);
    await loadPlayground({ panel: moving }).send();
    assert.strictEqual(moving.scrolls[0].behavior, 'smooth');
  });

  it('shows the waiting clock in minutes past one, and keeps the round trip exact', () => {
    assert.match(HTML, /x-text="formatAge\(waitingMs\)"/);
    assert.match(HTML, /formatDuration\(result\.elapsed_ms\)/);
    assert.strictEqual(loadPlayground().formatAge(184300), '3m 4s');
  });
});

describe('the Playground says which model answered', () => {
  it('reads the served model from either format and marks it when it is not the one typed', async () => {
    for (const format of ['openai', 'anthropic']) {
      const page = loadPlayground({ fetch: answered({ model: 'claude-sonnet-4-6' }) });
      page.apiKey = 'shellm-test';
      page.format = format;
      page.model = 'claude';
      await page.send();

      assert.strictEqual(page.result.served_model, 'claude-sonnet-4-6', format);
      assert.strictEqual(page.modelChanged(page.result), true, format);
    }

    const same = loadPlayground({ fetch: answered({ model: 'claude' }) });
    same.apiKey = 'shellm-test';
    same.model = 'claude';
    await same.send();
    assert.strictEqual(same.modelChanged(same.result), false);
  });

  it('renders the model in the stats row', () => {
    assert.match(HTML, /model <span :class="modelChanged\(result\) \? 'text-on-surface' : 'text-on-surface-variant'" x-text="result\.served_model">/);
  });

  it('says an empty answer is empty instead of painting a blank box', () => {
    assert.match(HTML, /<pre x-show="result\.ok && result\.answer"/);
    assert.match(HTML, /x-show="result\.ok && !result\.answer"[^>]*text-outline[^>]*>\(empty answer; see raw response\)</);
  });
});

describe('the Playground form is operable without a mouse', () => {
  it('binds every label to a control that exists', () => {
    const labels = [...HTML.matchAll(/<label\b([^>]*)>/g)].map((m) => m[1]);
    assert.ok(labels.length >= 6, `found only ${labels.length} labels`);
    for (const attrs of labels) {
      const target = /\bfor="([^"]+)"/.exec(attrs);
      assert.ok(target, `a label has no for=: <label${attrs}>`);
      assert.match(HTML, new RegExp(`\\bid="${target[1]}"`), `for="${target[1]}" points at nothing`);
    }
  });

  it('announces whether the raw response is open, and which element it opens', () => {
    const toggle = /<button[^>]*@click="showRaw = !showRaw"[^>]*>/.exec(HTML)[0];
    assert.match(toggle, /:aria-expanded="showRaw"/);
    assert.match(toggle, /aria-controls="playground-raw"/);
    assert.match(HTML, /<pre id="playground-raw" x-show="showRaw"/);
  });

  it('sends from the prompt with Cmd or Ctrl+Enter', () => {
    const textarea = /<textarea[^>]*>/.exec(HTML)[0];
    assert.match(textarea, /@keydown\.meta\.enter\.prevent="send\(\)"/);
    assert.match(textarea, /@keydown\.ctrl\.enter\.prevent="send\(\)"/);
  });

  it('ignores the shortcut while a request is already in flight', async () => {
    let calls = 0;
    const page = loadPlayground({ fetch: () => { calls++; return new Promise(() => {}); } });
    page.apiKey = 'shellm-test';
    page.send();
    await Promise.resolve();
    page.send();
    await Promise.resolve();

    assert.strictEqual(calls, 1, 'the disabled button does not stop a keyboard send');
  });
});

// The command is run through a real shell against a fake curl, so the quoting is proven rather
// than pattern-matched.
function runCurl(command, env) {
  assert.strictEqual(typeof command, 'string', 'no curl command was built');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-curl-'));
  const fake = path.join(dir, 'curl');
  fs.writeFileSync(fake, `#!${process.execPath}\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n`);
  fs.chmodSync(fake, 0o755);
  try {
    return JSON.parse(execFileSync('bash', ['-c', command], { input: '', timeout: 5000, env: { ...env, PATH: `${dir}:${process.env.PATH}` } }).toString());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('Copy as curl takes the call to an application without its secrets', () => {
  const realKey = 'shellm-realsecretvalue123';

  async function sent(format, { images = [] } = {}) {
    const page = loadPlayground({ fetch: answered({ model: 'claude' }) });
    page.apiKey = realKey;
    page.format = format;
    page.model = 'claude';
    page.prompt = "It's a test";
    page.images.push(...images);
    await page.send();
    return page;
  }

  it('posts the same OpenAI body to the same endpoint, with the key left to the shell', async () => {
    const page = await sent('openai');
    const { curl } = page.result;
    assert.ok(!curl.includes(realKey), 'the copied command carries the real key');

    const args = runCurl(curl, { SHELLM_KEY: 'from-the-env' });
    assert.strictEqual(args.at(-1), 'https://shellm.example/v1/chat/completions');
    assert.ok(args.includes('Authorization: Bearer from-the-env'));
    const body = JSON.parse(args[args.indexOf('-d') + 1]);
    assert.deepStrictEqual(body, { model: 'claude', messages: [{ role: 'user', content: "It's a test" }] });
  });

  it('posts the Anthropic body to /v1/messages', async () => {
    const page = await sent('anthropic');
    const args = runCurl(page.result.curl, { SHELLM_KEY: 'k' });
    assert.strictEqual(args.at(-1), 'https://shellm.example/v1/messages');
    assert.deepStrictEqual(JSON.parse(args[args.indexOf('-d') + 1]),
      { model: 'claude', max_tokens: 1024, messages: [{ role: 'user', content: "It's a test" }] });
  });

  it('elides image data but keeps where each image goes', async () => {
    const image = { id: 1, name: 'a.png', dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==' };
    const page = await sent('openai', { images: [image] });
    assert.ok(!page.result.curl.includes('iVBORw0KGgo'), 'the image payload was copied');

    const body = JSON.parse(runCurl(page.result.curl, { SHELLM_KEY: 'k' }).at(-2));
    assert.deepStrictEqual(body.messages[0].content[1], { type: 'image_url', image_url: { url: 'data:image/png;base64,…' } });
  });

  it('says so when the clipboard is out of reach, and leaves the command to select', async () => {
    const page = await sent('openai');
    await page.copyCurl();
    assert.strictEqual(page.copyError, true, 'an insecure origin has no clipboard, and the button looked like it worked');
    assert.match(HTML, /<pre x-show="copyError"[^>]*x-text="result\.curl">/);

    let written = null;
    const ok = loadPlayground({
      fetch: answered({}),
      clipboard: { writeText: async (text) => { written = text; } },
    });
    ok.apiKey = realKey;
    await ok.send();
    await ok.copyCurl();
    assert.strictEqual(ok.copied, true);
    assert.strictEqual(written, ok.result.curl);
  });
});
