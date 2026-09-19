'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const REPO_PATTERN = /github\.com[/:]([^/]+\/[^/.]+)/;

let cached = null;

// A tarball deploy has no .git and reports null rather than failing: the commit is diagnostic,
// not something the service depends on.
function readCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch {
    return null;
  }
}

function readRepo(manifest) {
  const url = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
  return url ? (REPO_PATTERN.exec(url)?.[1] ?? null) : null;
}

function getBuildInfo() {
  if (!cached) {
    const manifest = require(path.join(ROOT, 'package.json'));
    cached = { version: manifest.version, commit: readCommit(), repository: readRepo(manifest) };
  }
  return cached;
}

function resetBuildInfo() {
  cached = null;
}

module.exports = { getBuildInfo, resetBuildInfo };
