# Release Guide

Step-by-step instructions for cutting a SheLLM release. Follow this in order — each step depends on the previous one.

---

## Before you start

- [ ] You are on `master` and your working tree is clean (`git status`)
- [ ] All tests pass locally (`npm test`)
- [ ] The features or fixes you want in the release are merged

---

## Step 1 — Decide the version bump

| What changed | Command |
|---|---|
| Bug fixes only | `npm version patch` |
| New features, backwards-compatible | `npm version minor` |
| Breaking API change | `npm version major` |

**Not sure?** Check [Semantic Versioning](https://semver.org): MAJOR.MINOR.PATCH.

---

## Step 2 — Preview the CHANGELOG entry (optional)

Before actually bumping, see what the generated entry will look like:

```bash
node scripts/release-changelog.js --dry-run
```

This parses all conventional commits since the last tag and prints the CHANGELOG section without touching any file. If the output looks wrong, check your commit messages — they need to follow the `type(scope): description` format documented in [CONTRIBUTING.md](../../CONTRIBUTING.md#commit-messages).

---

## Step 3 — Bump the version

```bash
npm version patch   # replace with minor or major as needed
```

This single command does four things automatically:

1. Bumps `version` in `package.json`
2. Runs `scripts/release-changelog.js` → prepends the new entry to `CHANGELOG.md`
3. Stages `CHANGELOG.md` (`git add`)
4. Creates a git commit `v0.x.y` and a git tag `v0.x.y`

After it runs, verify the result:

```bash
git log --oneline -3          # should show the version commit at the top
git tag --list | tail -5      # should show the new tag
```

Open `CHANGELOG.md` and confirm the new entry looks correct. If it doesn't, you can:

```bash
# Edit CHANGELOG.md manually, then amend the commit (before pushing)
git add CHANGELOG.md
git commit --amend --no-edit
```

---

## Step 4 — Push the commit and the tag

```bash
git push && git push --tags
```

> **Order matters.** Push the commit first, then the tags. The tag push triggers the release CI — you want the commit already on `master` before that happens.

---

## Step 5 — Watch the release CI

Go to **GitHub → Actions → Release** workflow. The job:

1. Checks out the repo
2. Runs `npm ci && npm test` — if tests fail, the release is **not** created
3. Extracts the release notes for this version from `CHANGELOG.md`
4. Creates a GitHub Release with those notes

Expected duration: ~1 minute.

If it fails:
- Fix the issue on `master`
- Delete the tag locally and remotely, then re-tag:

```bash
git tag -d v0.x.y
git push origin :refs/tags/v0.x.y
# fix the issue, commit, then re-tag
git tag v0.x.y
git push --tags
```

---

## Step 6 — Verify the GitHub Release

Open **GitHub → Releases** and confirm:

- [ ] Title: `SheLLM v0.x.y`
- [ ] Release notes match the CHANGELOG entry
- [ ] Tag points to the right commit

---

## Step 7 — Update VERSIONS.md (if CLI versions changed)

If this release pins or changes a CLI version (`GEMINI_CLI_VERSION`, `CODEX_CLI_VERSION` in the Dockerfile), update the tested combinations table:

```
VERSIONS.md → Tested Combinations → add a new row
```

---

## Full example — patch release

```bash
# 1. Confirm clean state
git status
npm test

# 2. Preview
node scripts/release-changelog.js --dry-run

# 3. Bump
npm version patch

# 4. Review
git log --oneline -3
# open CHANGELOG.md and check the new entry

# 5. Push
git push && git push --tags

# 6. Check GitHub Actions → Release
# 7. Check GitHub → Releases
```

---

## Hotfix on a released version

If you need to patch a released version that is behind `master`:

```bash
# Create a branch from the tag
git checkout -b hotfix/v0.1.1 v0.1.0

# Apply the fix
# ... edit files ...
git add .
git commit -m "fix(router): prevent double-resolution on timeout"

# Bump patch version from that branch
npm version patch
git push origin hotfix/v0.1.1 --tags

# CI will run and create the release from the tag
# Then merge the fix back to master
git checkout master
git merge hotfix/v0.1.1
git push
```

---

## Reference

| File | Purpose |
|---|---|
| `scripts/release-changelog.js` | Generates CHANGELOG entry from git log |
| `scripts/release-changelog.js --dry-run` | Preview without writing |
| `.github/workflows/release.yml` | CI job that creates the GitHub Release |
| `CHANGELOG.md` | Human-readable release history |
| `VERSIONS.md` | CLI versions tested with each SheLLM release |
| `CONTRIBUTING.md#commit-messages` | Conventional commit format |
