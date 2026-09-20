'use strict';

const { readFileSync } = require('node:fs');
const path = require('node:path');

const VIEWS = path.join(__dirname, 'views');
const INCLUDE = /^[ \t]*<!--#include ([\w./-]+)-->[ \t]*\r?\n/gm;

// Substituting a file's bytes for its marker line is the only operation here. The moment a
// conditional or a variable is needed this stops being concatenation and wants a real engine.
function compose(root = VIEWS) {
  const read = (name) => readFileSync(path.join(root, name), 'utf8');
  return read('index.html').replace(INCLUDE, (_line, name) => read(name));
}

let cached = null;

// Composed per request off production so an edited partial shows up without a restart —
// node --watch does not see HTML.
function dashboardHtml() {
  if (process.env.NODE_ENV !== 'production') return compose();
  if (cached === null) cached = compose();
  return cached;
}

module.exports = { compose, dashboardHtml };
