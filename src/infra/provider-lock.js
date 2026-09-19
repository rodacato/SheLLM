// Some CLIs cannot have two of their processes running at once. Codex refreshes its OAuth
// token per process and concurrent refreshes corrupt the credentials (openai/codex#17340),
// so its adapter serializes every call through one of these.
function createMutex() {
  let tail = Promise.resolve();

  return function acquire() {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const waitFor = tail;
    tail = tail.then(() => held);
    return waitFor.then(() => release);
  };
}

module.exports = { createMutex };
