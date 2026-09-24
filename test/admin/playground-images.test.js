'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const JS_DIR = path.join(__dirname, '../../src/admin/public/js');

function loadPlayground() {
  const context = vm.createContext({
    console, Intl, Date, Math, URLSearchParams, Promise, AbortController, Error,
    Alpine: { store: () => undefined },
    performance: { now: () => 0 },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    getComputedStyle: () => ({ getPropertyValue: () => '#849397' }),
    document: { documentElement: {}, addEventListener: () => {} },
    navigator: { onLine: true },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    location: { pathname: '/admin/dashboard', hash: '', replace: () => {} },
    window: { addEventListener: () => {} },
    fetch: async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ providers: [] }) }),
  });
  for (const f of ['app.js', 'playground.js']) {
    vm.runInContext(fs.readFileSync(path.join(JS_DIR, f), 'utf8'), context, { filename: f });
  }
  return context;
}

// The vm's objects belong to another realm; a JSON round trip makes them comparable.
const plain = (value) => JSON.parse(JSON.stringify(value));

const attached = { id: 1, name: 'front.jpg', dataUrl: 'data:image/jpeg;base64,/9j/4AAQ', width: 800, height: 600, bytes: 1, originalBytes: 1, resized: false };

describe('the Playground sends images the way an application would', () => {
  it('leaves a photo that already fits untouched, so it keeps its own type', () => {
    const { imagePlan } = loadPlayground();
    assert.deepEqual(plain(imagePlan(1200, 900, 300 * 1024)), { reencode: false, width: 1200, height: 900 });
  });

  it('scales a camera photo to the 1568 px long edge the model uses anyway', () => {
    const { imagePlan } = loadPlayground();
    assert.deepEqual(plain(imagePlan(4032, 3024, 3 * 1024 * 1024)), { reencode: true, width: 1568, height: 1176 });
    assert.deepEqual(plain(imagePlan(3024, 4032, 3 * 1024 * 1024)), { reencode: true, width: 1176, height: 1568 });
  });

  it('re-encodes a small but heavy file without changing its size on screen', () => {
    const { imagePlan } = loadPlayground();
    assert.deepEqual(plain(imagePlan(1000, 1000, 2 * 1024 * 1024)), { reencode: true, width: 1000, height: 1000 });
  });

  it('puts the prompt first and each image after it as an OpenAI image_url part', () => {
    const page = loadPlayground().playgroundPage();
    page.prompt = 'What is this?';
    page.images.push(attached, { ...attached, id: 2, dataUrl: 'data:image/png;base64,iVBORw0KGgo=' });

    assert.deepEqual(plain(page.requestBody().messages[0].content), [
      { type: 'text', text: 'What is this?' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/4AAQ' } },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
    ]);
  });

  it('keeps the content a plain string when nothing is attached', () => {
    const page = loadPlayground().playgroundPage();
    assert.equal(page.requestBody().messages[0].content, page.prompt);
  });

  it('never sends images to /v1/messages, which takes text only', () => {
    const page = loadPlayground().playgroundPage();
    page.images.push(attached);
    page.format = 'anthropic';

    assert.equal(page.imagesSupported, false);
    assert.equal(page.requestBody().messages[0].content, page.prompt);
  });

  it('refuses a file type SheLLM would reject, and attaches nothing', async () => {
    const page = loadPlayground().playgroundPage();
    await page.addImages([{ name: 'logo.svg', type: 'image/svg+xml', size: 10 }]);

    assert.equal(page.images.length, 0);
    assert.match(page.imageError, /logo\.svg is not JPEG, PNG, WebP or GIF/);
  });

  it('removes the image that was asked for and no other', () => {
    const page = loadPlayground().playgroundPage();
    page.images.push(attached, { ...attached, id: 2, name: 'inside.jpg' });
    page.removeImage(0);
    assert.deepEqual(plain(page.images.map((image) => image.name)), ['inside.jpg']);
  });

  it('shows a tiny image in bytes rather than as 0 KB', () => {
    const page = loadPlayground().playgroundPage();
    assert.equal(page.formatBytes(168), '168 B');
    assert.equal(page.formatBytes(200 * 1024), '200 KB');
    assert.equal(page.formatBytes(1.6 * 1024 * 1024), '1.6 MB');
  });
});
