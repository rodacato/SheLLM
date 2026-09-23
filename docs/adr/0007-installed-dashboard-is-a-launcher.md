# ADR-0007 — The installed dashboard is a launcher, not an offline application

- **Status:** accepted
- **Date:** 2026-09-23
- **Context:** retires `docs/PWA-AUDIT.md`, the finding register this decision came out of. That
  document's fourteen findings all landed; what outlives them is the position below.

## Context

The admin dashboard ships a web app manifest and a service worker, so a browser offers to install
it. That offer implies something the app cannot do.

Four of the page's dependencies come from a CDN: Tailwind, Chart.js, Alpine and two Google Fonts
stylesheets. None is cached, and none can be — the Tailwind CDN build is a JIT compiler that runs
in the browser, and vendoring it means a build step, which `AGENTS.md` rules out.

So with no network the cached shell produces no Tailwind and therefore no classes, and no Alpine
and therefore no `x-data`: `[x-cloak]` elements stay hidden and every `x-show` element renders at
once. The cache fallback can only serve the parts of a page that cannot assemble themselves.

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
