'use strict';

const fs = require('node:fs');
const YAML = require('yaml');

// Re-read only when the file changes, so an edit on the host needs no restart. A missing or
// broken file answers the fallback rather than breaking the caller.
function yamlManifest(file, fallback) {
  let cached = { mtimeMs: null, data: fallback };
  return function read() {
    try {
      const { mtimeMs } = fs.statSync(file);
      if (mtimeMs !== cached.mtimeMs) cached = { mtimeMs, data: YAML.parse(fs.readFileSync(file, 'utf8')) || fallback };
      return cached.data;
    } catch {
      return fallback;
    }
  };
}

module.exports = { yamlManifest };
