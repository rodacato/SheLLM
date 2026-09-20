#!/usr/bin/env node
// release-changelog.js — generates a CHANGELOG entry from conventional commits
// Invoked automatically by `npm version` via the "version" lifecycle script.
// Can also be run manually: node scripts/release-changelog.js [--dry-run]

const { execSync } = require('node:child_process');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT    = join(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');

// ── Helpers ──────────────────────────────────────────────────────────────────

function git(cmd) {
  return execSync(cmd, { encoding: 'utf8', cwd: ROOT }).trim();
}

function getPreviousTag() {
  try {
    // When called from `npm version`, the new tag doesn't exist yet — get the latest existing tag
    return git('git describe --tags --abbrev=0');
  } catch {
    return null; // no tags yet — use first commit
  }
}

function getCommitsSince(ref) {
  const range = ref ? `${ref}..HEAD` : 'HEAD';
  const log = git(`git log ${range} --pretty=format:"%H\t%s\t%an" --no-merges`);
  if (!log) return [];
  return log.split('\n').map(line => {
    const [hash, subject, author] = line.split('\t');
    return { hash, subject: subject || '', author: author || '' };
  });
}

// Parse a conventional commit subject into { type, scope, description, breaking }
function parseCommit(subject) {
  const match = subject.match(/^(\w+)(\(([^)]+)\))?(!)?:\s*(.+)$/);
  if (!match) return null;
  const [, type, , scope, bang, description] = match;
  return { type, scope: scope || null, description, breaking: !!bang };
}

// ── Group commits by type ────────────────────────────────────────────────────

const TYPE_LABELS = {
  feat:     'Added',
  fix:      'Fixed',
  perf:     'Changed',
  refactor: 'Changed',
  style:    'Changed',
  docs:     'Documentation',
  chore:    'Maintenance',
  test:     'Testing',
  ci:       'CI',
};

const TYPE_ORDER = ['feat', 'fix', 'perf', 'refactor', 'style', 'docs', 'chore', 'test', 'ci'];

// Left out on purpose, with the reason, because "not in TYPE_ORDER" is how v1.6.0 dropped six
// commits without a word. The design system's own history is its `Log` frame in design/*.pen.
const SILENT_TYPES = { design: 'design/*.pen — its history is the flow\'s Log frame' };

function groupCommits(commits) {
  const groups  = {};
  const breaking = [];
  const dropped  = [];

  for (const { subject, hash } of commits) {
    const parsed = parseCommit(subject);
    if (!parsed) {
      dropped.push({ subject, hash, why: 'not a conventional commit' });
      continue;
    }

    const { type, scope, description, breaking: isBreaking } = parsed;

    if (isBreaking) {
      breaking.push({ scope, description, hash });
    }

    if (!TYPE_LABELS[type]) {
      dropped.push({ subject, hash, why: SILENT_TYPES[type] || `unknown type "${type}"` });
      continue;
    }

    if (!groups[type]) groups[type] = [];
    groups[type].push({ scope, description, hash });
  }

  return { groups, breaking, dropped };
}

// ── Format CHANGELOG entry ───────────────────────────────────────────────────

function formatEntry(version, date, groups, breaking) {
  const lines = [`## [${version}] - ${date}`, ''];

  if (breaking.length > 0) {
    lines.push('### Breaking Changes', '');
    for (const { scope, description } of breaking) {
      lines.push(`- ${scope ? `**${scope}:** ` : ''}${description}`);
    }
    lines.push('');
  }

  // Grouped by label rather than by type: perf, refactor and style all read as Changed, and
  // iterating types printed that heading once per type that had commits.
  const sections = new Map();
  for (const type of TYPE_ORDER) {
    if (!groups[type] || groups[type].length === 0) continue;
    const label = TYPE_LABELS[type];
    if (!sections.has(label)) sections.set(label, []);
    sections.get(label).push(...groups[type]);
  }

  for (const [label, entries] of sections) {
    lines.push(`### ${label}`, '');
    for (const { scope, description } of entries) {
      lines.push(`- ${scope ? `**${scope}:** ` : ''}${description}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function syncSpecVersion(next) {
  const specPath = join(ROOT, 'docs/api/openapi.yaml');
  const spec = readFileSync(specPath, 'utf8');
  writeFileSync(specPath, spec.replace(/^  version: .+$/m, `  version: ${next}`), 'utf8');

  const bundlePath = join(ROOT, 'docs/api/bundled.json');
  const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
  bundle.info.version = next;
  // No trailing newline: redocly writes none, and adding one makes every bundle churn.
  writeFileSync(bundlePath, JSON.stringify(bundle, null, 2), 'utf8');
}

// ── Main ─────────────────────────────────────────────────────────────────────

// A release that leaves a commit out of the entry has to say so. Stderr, so a piped --dry-run
// still yields only the entry.
function reportDropped(dropped) {
  if (dropped.length === 0) return;
  console.error(`release-changelog: ${dropped.length} commit(s) are not in this entry`);
  for (const { hash, subject, why } of dropped) {
    console.error(`  ${hash.slice(0, 7)} ${subject}  — ${why}`);
  }
}

function main() {
  const pkg        = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const version    = pkg.version;
  const date       = new Date().toISOString().slice(0, 10);
  const prevTag    = getPreviousTag();
  const commits    = getCommitsSince(prevTag);
  const { groups, breaking, dropped } = groupCommits(commits);

  const entry = formatEntry(version, date, groups, breaking);
  reportDropped(dropped);

  if (DRY_RUN) {
    console.log(entry);
    process.exit(0);
  }

  // The spec states the version of the build it ships with, and a test compares the two.
  syncSpecVersion(version);

  // Prepend to CHANGELOG.md, replacing the [Unreleased] section
  const changelogPath = join(ROOT, 'CHANGELOG.md');
  const current = readFileSync(changelogPath, 'utf8');

  // Build updated content: keep header, replace [Unreleased] placeholder, add new entry
  const header = current.slice(0, current.indexOf('## [Unreleased]'));
  const rest   = current.slice(current.indexOf('## [Unreleased]') + '## [Unreleased]'.length);

  // Update the [Unreleased] diff link and add link for new version
  const repoUrl  = 'https://github.com/rodacato/SheLLM';
  const newLinks = `\n[Unreleased]: ${repoUrl}/compare/v${version}...HEAD\n[${version}]: ${repoUrl}/compare/${prevTag || 'v0.0.0'}...v${version}`;

  // Remove old version links block at the bottom
  const restWithoutLinks = rest.replace(/\n\[Unreleased\]:.*$/ms, '').trimEnd();

  const updated = `${header}## [Unreleased]\n\n${entry}${restWithoutLinks}\n${newLinks}\n`;

  writeFileSync(changelogPath, updated, 'utf8');
  console.log(`CHANGELOG.md updated for v${version}`);
}

if (require.main === module) main();

module.exports = { parseCommit, groupCommits, formatEntry, TYPE_LABELS, TYPE_ORDER, SILENT_TYPES };
