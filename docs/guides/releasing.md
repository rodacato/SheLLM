# Release Guide

Cutting a release is one decision — which part of the version number moves — and one review.
Everything else is done by CI.

## Cut it

**GitHub → Actions → Release · Cut → Run workflow**, pick the bump, run it
([`.github/workflows/release.yml`](../../.github/workflows/release.yml)).

| What changed | Bump |
|---|---|
| Bug fixes only | `patch` |
| New features, nothing breaks | `minor` |
| Something existing installs depend on is gone or behaves differently | `major` |

The workflow runs `npm version`, which bumps `package.json` and, through
[`scripts/release-changelog.js`](../../scripts/release-changelog.js), writes the `CHANGELOG.md`
entry from the conventional commits since the last tag and the version in the OpenAPI spec. It
pushes all of it as one commit on a `release/vX.Y.Z` branch. It does not push to `master`
and it does not tag anything yet.

**Open the pull request yourself** — the run's summary links straight to it. The workflow
deliberately does not: letting Actions open pull requests needs a repository setting that also
lets it approve them, and a pull request authored by the repository token runs no CI. Opening it
by hand is what gives the release branch its checks.

## Review the changelog before merging

This is the only manual step, and it is the one worth doing carefully, because the entry is what
people read to decide whether upgrading is safe.

**Check that anything breaking is under `### Breaking Changes`.** The generator reads only the
subject line, so it puts a commit there only when it was written as `type!: description`
([CONTRIBUTING.md](../../CONTRIBUTING.md#commit-messages)). A `BREAKING CHANGE:` footer is not
read, and a breaking change without the `!` lands only in its type's section, indistinguishable
from any other change. If you find one, move it by hand in the pull request — nothing downstream
can infer it.

**Check what was left out.** A commit that is not a conventional commit, or whose type the
generator does not list, is not in the entry; the run's log names each one with the reason.

Fix wording, reorder, or delete noise in the same pull request. It is an ordinary branch.

## Merge it

Merging publishes the release: the push to `master` that changes `package.json` runs the test
suite, creates an annotated tag, and publishes a GitHub Release carrying the changelog entry. If
the suite fails, no tag is created and nothing is published.

The tag is what a deployment follows, so the release is not cosmetic: it is what gets installed.

## Then

- If the release moves a CLI pin, check that [`VERSIONS.md`](../../VERSIONS.md) has its tested
  combination — the pin bump's own pull request should have added it.
- Deploy it on the host — see [deployment.md](./deployment.md).

## Things worth knowing

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
