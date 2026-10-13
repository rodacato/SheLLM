const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { RequestQueue } = require('../../src/infra/queue');

// MAX_QUEUE_DEPTH caps how many may wait for a slot, so 0 means "never wait", not "never run".
describe('a queue that allows no waiting', () => {
  const previous = {};

  beforeEach(() => {
    for (const key of ['MAX_CONCURRENT', 'MAX_QUEUE_DEPTH']) previous[key] = process.env[key];
    process.env.MAX_CONCURRENT = '1';
    process.env.MAX_QUEUE_DEPTH = '0';
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('runs a request when a slot is free', async () => {
    const queue = new RequestQueue();
    assert.equal(await queue.enqueue(() => 'ran'), 'ran');
  });

  it('refuses a request that would have to wait', async () => {
    const queue = new RequestQueue();
    let finish;
    const running = queue.enqueue(() => new Promise((r) => { finish = r; }));

    await assert.rejects(queue.enqueue(() => 'ran'), (err) => err.status === 429);

    finish();
    await running;
  });
});
