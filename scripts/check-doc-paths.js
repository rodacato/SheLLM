'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const TRACKED_ROOTS = ['src', 'test', 'scripts', 'config', 'docs', 'design', 'assets', 'site'];
const CODE_EXT = /\.(js|mjs|sql|json|html|css|yaml|yml|webmanifest)$/;

const DEFAULT_DOCS = ['docs/guides/architecture.md'];

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function backtickedPaths(text) {
  const found = new Set();
  for (const [, span] of text.matchAll(/`([^`\n]+)`/g)) {
    const candidate = span.trim().replace(/[.,;:]$/, '');
    if (!TRACKED_ROOTS.some((r) => candidate.startsWith(`${r}/`))) continue;
    if (!CODE_EXT.test(candidate) && !candidate.endsWith('/')) continue;
    // `src/providers/<name>.js` is a placeholder in prose, not a file to look for.
    if (/[*?\s<>]/.test(candidate)) continue;
    found.add(candidate.replace(/\/$/, ''));
  }
  return [...found];
}

function treeFilenames(text) {
  const found = new Set();
  for (const [, block] of text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
    if (!block.includes('├──') && !block.includes('└──')) continue;
    for (const line of block.split('\n')) {
      const entry = line.replace(/^[\s│├└─]+/, '').split(/\s+/)[0];
      if (!entry || !CODE_EXT.test(entry) || /[<>]/.test(entry)) continue;
      // Flow diagrams qualify their files (`routing/index.js`); trees do not.
      found.add(path.basename(entry));
    }
  }
  return [...found];
}

function indexBasenames(dir, acc = new Set()) {
  for (const item of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (item.name === 'node_modules' || item.name.startsWith('.')) continue;
    const rel = path.join(dir, item.name);
    if (item.isDirectory()) indexBasenames(rel, acc);
    else acc.add(item.name);
  }
  return acc;
}

function check(docs = DEFAULT_DOCS) {
  const basenames = indexBasenames('src');
  const missingPaths = [];
  const missingFiles = [];
  let pathCount = 0;
  let fileCount = 0;

  for (const doc of docs) {
    const text = read(doc);
    for (const rel of backtickedPaths(text)) {
      pathCount += 1;
      if (!exists(rel)) missingPaths.push(`${doc}: ${rel}`);
    }
    for (const name of treeFilenames(text)) {
      fileCount += 1;
      if (!basenames.has(name)) missingFiles.push(`${doc}: ${name}`);
    }
  }

  return { pathCount, fileCount, missingPaths, missingFiles };
}

function main() {
  const docs = process.argv.slice(2);
  const result = check(docs.length ? docs : DEFAULT_DOCS);

  // A run that found nothing to check would otherwise pass without proving anything.
  if (result.pathCount + result.fileCount === 0) {
    console.error('DOC_PATHS_VACUOUS: no path or filename was extracted, so nothing was verified');
    process.exit(1);
  }

  for (const miss of result.missingPaths) console.error(`missing path      ${miss}`);
  for (const miss of result.missingFiles) console.error(`missing under src ${miss}`);

  if (result.missingPaths.length || result.missingFiles.length) {
    console.error(`DOC_PATHS_FAILED: ${result.missingPaths.length + result.missingFiles.length} of ${result.pathCount + result.fileCount}`);
    process.exit(1);
  }

  console.log(`DOC_PATHS_OK ${result.pathCount} paths and ${result.fileCount} filenames verified`);
}

if (require.main === module) main();

module.exports = { check };
