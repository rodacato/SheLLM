# ADR-0007 — The installed dashboard is a launcher, not an offline application

- **Status:** accepted, amended 2026-10-28 (see [Changelog](#changelog))
- **Date:** 2026-09-23
- **Context:** retires `docs/PWA-AUDIT.md`, the finding register this decision came out of. That
  document's fourteen findings all landed; what outlives them is the position below.

## Context

The admin dashboard ships a web app manifest and a service worker, so a browser offers to install
it. That offer implies something the app cannot do.

Four of the page's dependencies come from a CDN: Tailwind, Chart.js, Alpine and two Google Fonts
stylesheets. They stay on the CDN — the Tailwind CDN build is a JIT compiler that runs in the
browser, and vendoring it means a build step, which [`CONTRIBUTING.md`](../../CONTRIBUTING.md)
rules out. The service worker precaches them, best effort: a CDN that is down when the worker
installs is skipped rather than failing the install.

So a shell whose CDN copies were never cached produces no Tailwind and therefore no classes, and
no Alpine and therefore no `x-data`: `[x-cloak]` elements stay hidden and every `x-show` element
renders at once. With the copies cached, the shell assembles and says it cannot reach the gateway.

It would not matter if they could. Every number on every screen comes from the gateway, so an
offline dashboard has nothing to show.

## Decision

**The install is a launcher — its own window, its own icon, a warm start — and the product says
so.** It is not an offline application, and no wording implies it is.

Two consequences follow, and both are decisions rather than open questions:

- **The sign-in page stays out of the service worker's `SHELL`.** It carries the manifest, the
  theme colour, the safe-area insets and the same icon declarations the dashboard makes, so it
  does not read as a different application — but caching it would replace the browser's offline
  error page with a branded sign-in form that then fails on submit, because the thing that is
  unreachable is the gateway that would answer it. The operator learns nothing, and the app gains
  a cached page that has to stay in sync.
- **The manifest declares no `screenshots`.** They would buy Chrome's richer install dialog for
  roughly 350 KB of PNG shipped to every install, on a dashboard one person installs once.

The service worker stays. Chrome requires a fetch handler to offer an install at all, and the
cache makes a warm load instant — which is the launcher's whole point.

## Consequences

- `README.md` and `docs/guides/deployment.md` describe the install as a launcher and never as
  offline support.
- Reopen only if the CDN dependencies become local. That is a different decision — it means a
  build step — and needs its own ADR.
- `design/DECISIONS.md` **D20** stays open on its own terms: the sign-in page's nine palette
  aliases are a design call, not a consequence of this one.

## Changelog

- **2026-10-28** — Context corrected: it said none of the CDN dependencies is cached. Since
  `fd82ec8` (2026-09-27) the service worker precaches them, best effort, so the offline banner
  can render; `af69c4b` fetches the scripts pinned with integrity in CORS mode, because an opaque
  copy fails the check. The decision is unchanged: every number still comes from the gateway, so
  the install remains a launcher and not an offline application.
