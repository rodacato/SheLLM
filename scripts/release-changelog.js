#!/usr/bin/env node
// release-changelog.js — generates a CHANGELOG entry from conventional commits
// Invoked automatically by `npm version` via the "version" lifecycle script.
// Can also be run manually: node scripts/release-changelog.js [--dry-run]

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT    = new URL('..', import.meta.url).pathname;
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
  docs:     'Documentation',
  chore:    'Maintenance',
  test:     'Testing',
  ci:       'CI',
};

const TYPE_ORDER = ['feat', 'fix', 'perf', 'refactor', 'docs', 'chore', 'test', 'ci'];

function groupCommits(commits) {
  const groups  = {};
  const breaking = [];

  for (const { subject, hash } of commits) {
    const parsed = parseCommit(subject);
    if (!parsed) continue; // skip non-conventional commits

    const { type, scope, description, breaking: isBreaking } = parsed;

    if (isBreaking) {
      breaking.push({ scope, description, hash });
    }

    if (!groups[type]) groups[type] = [];
    groups[type].push({ scope, description, hash });
  }

  return { groups, breaking };
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

  for (const type of TYPE_ORDER) {
    if (!groups[type] || groups[type].length === 0) continue;
    lines.push(`### ${TYPE_LABELS[type] || type}`, '');
    for (const { scope, description } of groups[type]) {
      lines.push(`- ${scope ? `**${scope}:** ` : ''}${description}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Main ─────────────────────────────────────────────────────────────────────

const pkg        = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const version    = pkg.version;
const date       = new Date().toISOString().slice(0, 10);
const prevTag    = getPreviousTag();
const commits    = getCommitsSince(prevTag);
const { groups, breaking } = groupCommits(commits);

const entry = formatEntry(version, date, groups, breaking);

if (DRY_RUN) {
  console.log(entry);
  process.exit(0);
}

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
