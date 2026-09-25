'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { RequestQueue } = require('../../src/infra/queue');
const { announceQueued, keepAlive, sendSSEComment } = require('../../src/lib/sse');

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function fakeRes() {
  const written = [];
  return { written, write(chunk) { written.push(chunk); return true; } };
}

describe('what the queue tells a caller about its wait', () => {
  let previous;

  beforeEach(() => {
    previous = process.env.MAX_CONCURRENT;
    process.env.MAX_CONCURRENT = '1';
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.MAX_CONCURRENT;
    else process.env.MAX_CONCURRENT = previous;
  });

  it('reports position 0 for a request that never waits', async () => {
    // A fixed clock: on a slow runner the real one can cross a millisecond inside enqueue.
    const queue = new RequestQueue(() => 1_000_000);
    const seen = await queue.enqueue(({ position, queued_ms }) => ({ position, queued_ms }));

    assert.equal(seen.position, 0);
    assert.equal(seen.queued_ms, 0);
  });

  it('numbers waiting requests from 1, in arrival order', async () => {
    const queue = new RequestQueue();
    const blocker = deferred();
    const positions = [];

    const running = queue.enqueue(() => blocker.promise);
    const second = queue.enqueue(({ position }) => positions.push(['ran', position]), null,
      { onQueued: (position) => positions.push(['queued', position]) });
    const third = queue.enqueue(({ position }) => positions.push(['ran', position]), null,
      { onQueued: (position) => positions.push(['queued', position]) });

    assert.deepEqual(positions, [['queued', 1], ['queued', 2]]);

    blocker.resolve();
    await Promise.all([running, second, third]);

    assert.deepEqual(positions.filter(([kind]) => kind === 'ran'), [['ran', 1], ['ran', 2]]);
  });

  it('measures the wait, and does not call onQueued when a slot is free', async () => {
    let clock = 1000;
    const queue = new RequestQueue(() => clock);
    const blocker = deferred();
    let announced = false;

    const running = queue.enqueue(() => blocker.promise);
    let measured;
    const waiting = queue.enqueue(({ queued_ms }) => { measured = queued_ms; }, null,
      { onQueued: () => { announced = true; } });

    clock = 1750;
    blocker.resolve();
    await Promise.all([running, waiting]);

    assert.equal(announced, true);
    assert.equal(measured, 750);

    let direct;
    await queue.enqueue(({ queued_ms }) => { direct = queued_ms; }, null,
      { onQueued: () => assert.fail('a request that found a free slot must not announce a wait') });
    assert.equal(direct, 0);
  });

  it('nextPosition agrees with what the next enqueue reports', async () => {
    const queue = new RequestQueue();
    const blocker = deferred();

    assert.equal(queue.nextPosition, 0);
    const running = queue.enqueue(() => blocker.promise);
    assert.equal(queue.nextPosition, 1);

    let reported;
    const waiting = queue.enqueue(({ position }) => { reported = position; });
    assert.equal(queue.nextPosition, 2);

    blocker.resolve();
    await Promise.all([running, waiting]);
    assert.equal(reported, 1);
  });
});

describe('the SSE lines a waiting stream writes', () => {
  it('writes a comment the moment it starts waiting', () => {
    const res = fakeRes();
    announceQueued(res, 3)();

    assert.deepEqual(res.written, [': queued position=3\n\n']);
  });

  it('keeps writing while it waits, and stops when told to', async () => {
    const res = fakeRes();
    const stop = announceQueued(res, 2, 5);

    await new Promise((r) => setTimeout(r, 40));
    stop();
    const afterStop = res.written.length;
    assert.ok(afterStop > 1, `expected repeated notices, got ${afterStop}`);
    for (const line of res.written) assert.match(line, /^: queued position=2/);

    await new Promise((r) => setTimeout(r, 30));
    assert.equal(res.written.length, afterStop);
  });

  it('writes a comment line no SSE parser reads as data', () => {
    const res = fakeRes();
    sendSSEComment(res, 'queued position=1');

    assert.equal(res.written[0], ': queued position=1\n\n');
    assert.doesNotMatch(res.written[0], /^data:/);
  });
});

describe('the keepalive a running stream writes', () => {
  it('writes a comment on every tick until stopped, so a silent model does not look like a dead connection', async () => {
    const res = fakeRes();
    const stop = keepAlive(res, 5);

    await new Promise((r) => setTimeout(r, 40));
    stop();
    const afterStop = res.written.length;
    assert.ok(afterStop > 1, `expected repeated keepalives, got ${afterStop}`);
    for (const line of res.written) assert.equal(line, ': keepalive\n\n');

    await new Promise((r) => setTimeout(r, 30));
    assert.equal(res.written.length, afterStop);
  });

  it('writes nothing once the response has ended', async () => {
    const res = { ...fakeRes(), writableEnded: true };
    const stop = keepAlive(res, 5);
    await new Promise((r) => setTimeout(r, 30));
    stop();
    assert.deepEqual(res.written, []);
  });

  it('stops by itself when the connection closes', async () => {
    const res = fakeRes();
    let onClose;
    res.on = (event, fn) => { if (event === 'close') onClose = fn; };
    keepAlive(res, 5);

    onClose();
    const atClose = res.written.length;
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(res.written.length, atClose);
  });
});
