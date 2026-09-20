'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { RequestQueue } = require('../../src/infra/queue');

// A real queue running real promises. The only thing stood in for is the clock, because a test
// that waited nine real minutes to prove a nine-minute request is visible would never be run.
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('the queue can say how long each in-flight request has been running', () => {
  it('reports nothing in flight when nothing is', () => {
    const q = new RequestQueue(clock().now);
    assert.deepStrictEqual(q.stats.in_flight, []);
    assert.strictEqual(q.stats.oldest_age_ms, null);
    assert.strictEqual(q.stats.active, 0);
  });

  it('ages a running job as the clock moves', async () => {
    const c = clock();
    const q = new RequestQueue(c.now);
    const job = deferred();

    const running = q.enqueue(() => job.promise, 'claude · claude-fable');
    await Promise.resolve();

    assert.strictEqual(q.stats.in_flight.length, 1);
    assert.strictEqual(q.stats.oldest_age_ms, 0);

    c.advance(9 * 60 * 1000);
    assert.strictEqual(q.stats.oldest_age_ms, 540000, 'nine minutes in, the age says nine minutes');
    assert.strictEqual(q.stats.in_flight[0].label, 'claude · claude-fable');

    job.resolve('done');
    assert.strictEqual(await running, 'done');
  });

  it('drops a job from the set the moment it finishes', async () => {
    const c = clock();
    const q = new RequestQueue(c.now);
    const job = deferred();

    const running = q.enqueue(() => job.promise);
    await Promise.resolve();
    assert.strictEqual(q.stats.active, 1);

    job.resolve(null);
    await running;

    assert.strictEqual(q.stats.active, 0);
    assert.deepStrictEqual(q.stats.in_flight, []);
    assert.strictEqual(q.stats.oldest_age_ms, null);
  });

  it('drops a job that threw, so a failure cannot look wedged forever', async () => {
    const q = new RequestQueue(clock().now);
    await assert.rejects(q.enqueue(async () => { throw new Error('boom'); }));
    assert.strictEqual(q.stats.active, 0);
  });

  it('reports the oldest first, which is the one worth looking at', async () => {
    const c = clock();
    const q = new RequestQueue(c.now);
    process.env.MAX_CONCURRENT = '3';

    const first = deferred();
    const second = deferred();
    const a = q.enqueue(() => first.promise, 'old one');
    await Promise.resolve();
    c.advance(300000);
    const b = q.enqueue(() => second.promise, 'new one');
    await Promise.resolve();
    c.advance(1000);

    const flight = q.stats.in_flight;
    assert.strictEqual(flight.length, 2);
    assert.strictEqual(flight[0].label, 'old one');
    assert.strictEqual(flight[0].age_ms, 301000);
    assert.strictEqual(flight[1].age_ms, 1000);
    assert.strictEqual(q.stats.oldest_age_ms, 301000);

    first.resolve(null); second.resolve(null);
    await Promise.all([a, b]);
    delete process.env.MAX_CONCURRENT;
  });

  it('keeps active the same number every existing caller already reads', async () => {
    const q = new RequestQueue(clock().now);
    const job = deferred();
    const running = q.enqueue(() => job.promise);
    await Promise.resolve();

    assert.strictEqual(typeof q.stats.active, 'number');
    assert.strictEqual(q.stats.active, 1);
    assert.strictEqual(q.stats.active, q.stats.in_flight.length);

    job.resolve(null);
    await running;
  });
});
