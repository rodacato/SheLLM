# Release Guide

Cutting a release is one decision — which part of the version number moves — and one review.
Everything else is done by CI.

## Cut it

**GitHub → Actions → Release → Run workflow**, pick the bump, run it.

| What changed | Bump |
|---|---|
| Bug fixes only | `patch` |
| New features, nothing breaks | `minor` |
| Something existing installs depend on is gone or behaves differently | `major` |

The workflow bumps `package.json`, generates the `CHANGELOG.md` entry from the conventional
commits since the last tag, and opens a pull request titled `Release vX.Y.Z`. It does not push to
`master` and it does not tag anything yet.

## Review the changelog before merging

This is the only manual step, and it is the one worth doing carefully, because the entry is what
people read to decide whether upgrading is safe.

**Check that anything breaking is under `### Breaking Changes`.** The generator puts it there when
the commit was written as `type!: description` or carried a `BREAKING CHANGE:` footer
([CONTRIBUTING.md](../../CONTRIBUTING.md#commit-messages)). A breaking change committed without
that marker lands in `Changed`, indistinguishable from a refactor. If you find one, move it by
hand in the pull request — nothing downstream can infer it.

Fix wording, reorder, or delete noise in the same pull request. It is an ordinary branch.

## Merge it

Merging publishes the release: the workflow runs the test suite, creates an annotated tag, and
publishes a GitHub Release carrying the changelog entry. If the suite fails, no tag is created
and nothing is published.

The tag is what a deployment follows, so the release is not cosmetic: it is what gets installed.

## Then

- If the release pins a different CLI version (`CLAUDE_VERSION` in
  [`scripts/setup/vps.sh`](../../scripts/setup/vps.sh)), update the tested-combinations table in
  [`VERSIONS.md`](../../VERSIONS.md).
- Deploy it on the host — see [deployment.md](./deployment.md).

## Things worth knowing

**The release pull request does not run CI.** It is opened by the workflow using the repository
token, and GitHub deliberately does not trigger workflows from token-authored events, to avoid
loops. The suite runs on merge, before the tag is created, so nothing is published untested —
but do not read an absent check as a passing one.

**Publishing is decided from the manifest, not from the pull request.** Any push to `master` that
changes `package.json` to a version with no tag publishes that version. That is what makes the
merge work, and it means a hand-edited version bump merged through an ordinary pull request also
releases.

**To preview an entry without releasing anything:**

```bash
node scripts/release-changelog.js --dry-run
```

**If a release goes out wrong**, do not delete and re-push the tag: an install may already point
at it. Cut the next patch instead.
