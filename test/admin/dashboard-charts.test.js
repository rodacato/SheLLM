'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const JS_DIR = path.join(__dirname, '../../src/admin/public/js');
const HOUR_MS = 3600000;

// The page's own files, loaded the way the browser loads them. Chart.js is the one boundary
// stubbed, as a recorder, so the assertions read the configuration the page really built.
function loadOverview() {
  const built = [];
  class Chart {
    constructor(canvas, config) {
      this.canvas = canvas;
      this.config = config;
      built.push(config);
    }
    destroy() {}
  }

  const context = vm.createContext({
    console, Intl, Date, Chart, Math, JSON,
    getComputedStyle: () => ({ getPropertyValue: () => '#7ee787' }),
    document: { documentElement: {}, addEventListener: () => {} },
    fetch: async () => {}, navigator: { onLine: true },
    setTimeout: (fn) => { Promise.resolve().then(fn); return 0; },
    clearTimeout: () => {}, setInterval: () => 0,
    location: { pathname: '/admin/dashboard', hash: '', replace: () => {} },
    window: { addEventListener: () => {} },
  });

  for (const file of ['app.js', 'overview.js']) {
    vm.runInContext(fs.readFileSync(path.join(JS_DIR, file), 'utf8'), context, { filename: file });
  }
  return { context, built };
}

function statsFixture(now) {
  const firstAt = now - 12 * HOUR_MS;
  const timeline = [];
  for (let at = firstAt; at <= now; at += HOUR_MS) {
    const busy = at === firstAt || at === now;
    timeline.push({
      bucket_at: new Date(at).toISOString(),
      requests: busy ? 40 : 0,
      errors: busy ? 3 : 0,
      cost: 0, avg_duration_ms: 0, avg_queued_ms: 0,
    });
  }
  return {
    window: { from: new Date(firstAt).toISOString(), to: new Date(now).toISOString(), hours: 12, requests: 80, retention_days: 30 },
    timeline,
    recent_requests: [
      { created_at: '2026-09-19 12:00:00', duration_ms: 900, queued_ms: 10, status: 200, model: 'claude-fable' },
      { created_at: '2026-09-19 18:00:00', duration_ms: 400, queued_ms: null, status: 500, model: 'claude-fable' },
    ],
    recent_requests_total: 2,
  };
}

describe('the overview draws both charts on one time axis', () => {
  let page;
  let built;
  let now;

  before(() => {
    const loaded = loadOverview();
    page = loaded.context.overviewPage();
    built = loaded.built;
    now = Date.now();
    page.stats = statsFixture(now);
    page.$refs = { timeline: { id: 'timeline' }, scatter: { id: 'scatter' } };
    page.renderTimeline();
    page.renderScatter();
  });

  const timeline = () => built[0];
  const scatter = () => built[1];

  it('builds both charts', () => {
    assert.strictEqual(built.length, 2, 'both charts must render for the rest of this to mean anything');
  });

  it('measures time on both, rather than treating buckets as categories', () => {
    for (const config of [timeline(), scatter()]) {
      assert.strictEqual(config.options.scales.x.type, 'linear');
    }
    assert.ok(!('labels' in timeline().data),
      'category labels space buckets evenly however far apart they are');
  });

  it('gives them the same domain, so the two can be read against each other', () => {
    assert.strictEqual(timeline().options.scales.x.min, scatter().options.scales.x.min);
    assert.strictEqual(timeline().options.scales.x.max, scatter().options.scales.x.max);
  });

  it('starts at the oldest surviving request, not at the retention limit', () => {
    const min = timeline().options.scales.x.min;
    assert.strictEqual(min, Date.parse(page.stats.window.from));
  });

  it('leaves room past the present so the now marker is not clipped', () => {
    const { min, max } = timeline().options.scales.x;
    assert.ok(max > now, 'the axis has to reach past now for the line to be visible');
    assert.ok(max - now < (now - min) * 0.2, 'the padding is breathing room, not a second empty chart');
  });

  it('marks the present on both, at the same instant', () => {
    for (const config of [timeline(), scatter()]) {
      assert.ok(config.plugins.some((p) => p.id === 'nowMarker'), 'the marker plugin is registered');
      const at = config.options.plugins.nowMarker.at;
      assert.ok(at >= now - 5000 && at <= config.options.scales.x.max);
    }
    assert.strictEqual(timeline().options.plugins.nowMarker.at, scatter().options.plugins.nowMarker.at);
  });

  it('plots each bucket at the instant it happened', () => {
    const points = timeline().data.datasets[0].data;
    assert.strictEqual(points.length, page.stats.timeline.length);
    for (let i = 1; i < points.length; i++) {
      assert.strictEqual(points[i].x - points[i - 1].x, HOUR_MS,
        'consecutive buckets are one hour apart on the axis, quiet or not');
    }
    assert.strictEqual(points.filter((p) => p.y === 0).length, points.length - 2);
  });

  it('draws the traffic it measured, without smoothing a spike into a ramp', () => {
    for (const dataset of timeline().data.datasets) {
      assert.strictEqual(dataset.tension, 0,
        'a curve through hourly counts invents traffic between the hours');
    }
  });
});

describe('the scatter says when it is showing less than the totals', () => {
  let page;

  before(() => {
    page = loadOverview().context.overviewPage();
  });

  it('says nothing while it shows every request', () => {
    page.stats = { recent_requests: new Array(120).fill({}), recent_requests_total: 120 };
    assert.strictEqual(page.scatterCaption(), '');
  });

  it('names the cap once the totals cover more rows than the chart', () => {
    page.stats = { recent_requests: new Array(500).fill({}), recent_requests_total: 1234 };
    assert.strictEqual(page.scatterCaption(), 'last 500 of 1,234');
  });
});
