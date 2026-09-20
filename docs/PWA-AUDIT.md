# PWA audit — admin dashboard

> **Subject:** the shipped code at `0a4bec6`. `src/admin/public/{manifest.webmanifest,sw.js}`,
> `src/admin/views/index.html`, `src/admin/public/css/custom.css`, the `/admin` routes in
> `src/app.js`, `src/admin/login.js`, and `test/admin/{pwa,install-path}.test.js`.
>
> **Date:** 2026-09-20 · **Method:** read against the installability and offline contracts the
> code already claims for itself. Nothing was verified on a device — there is no browser in this
> environment, so every finding below is derived from the source and the confidence is stated
> where it is less than certain.

Findings are numbered **P1–P13** so a board card can cite one. Severity is what an installed app
does wrong, not how hard it is to fix.

---

## Status — 2026-09-20

| | Landed | Open |
|---|---|---|
| 🔴 | P1 · P2 *(documented, not fixed — that was the recommendation)* | — |
| 🟠 | P3 *(partly)* · P4 | P3 *(residual)* · P5 |
| 🟡 | P6 · P7 · P9 | P8 |
| 🟢 | P10 · P12 · P13 | P11 |

Nine commits, every one green on `npm test` and `npm run lint`. What is left, and why:

- **P3 residual.** The sign-in page now carries the manifest, the theme colour, the safe-area
  insets and the app's own frame, so it no longer reads as a different application. Two things
  survive: it is still outside `SHELL`, so offline it is the browser's error page inside a
  windowed app, and it still declares its own nine palette aliases — which is **D20**, an open
  design call, not an oversight.
- **P5** needs a drawn asset, not a code change. A maskable icon is a different composition, not
  a resize: the mark inside the middle 60% of the canvas on `surface-shell`.
- **P8** needs a decision. `skipWaiting()` + `clients.claim()` stays, or it goes and the
  connection banner grows a "reload to update" line. Either is defensible; leaving it undecided
  is what this entry objects to.
- **P11** is ~350 KB of PNG in the repo for a taller install dialog. Worth it if the exports are
  going to be committed anyway, not worth it on its own.

---

## What is already right

Worth stating, because the non-obvious parts were done deliberately and a later change could
undo them by accident.

- **The worker is served from `/admin/sw.js`, not from the static mount.** That is the only path
  that lets it claim `/admin/` as its scope, which is what keeps `/admin/login` inside the
  installed window instead of bouncing the user to a browser tab. `src/app.js:87`.
- **The manifest and the worker answer without a session** (`src/app.js:84-89`, registered before
  the authenticated routers) while the page itself stays behind auth. A manifest that 401s is not
  read, and an install that needs a cookie to start does not install.
- **The shell cache holds no account data.** GET only, same-origin only, and an allow-list rather
  than a pattern — `sw.js:31-35`. `test/admin/pwa.test.js` asserts the worker never names
  `/admin/keys`, `/admin/logs`, `/admin/stats` or `/v1/`.
- **The worker script is served `Cache-Control: no-cache`** (`src/app.js:88`), which is the one
  header that decides whether an update is ever picked up.
- **`Cache-Control: no-store` on everything under `/admin/dashboard/`** (`src/app.js:113`) does
  *not* break the shell cache — the Cache Storage API ignores it. Do not "fix" this.
- **`start_url` sits inside `scope`,** both icon sizes exist and are served, and the tests check
  that every icon the manifest promises actually answers 200.

---

## Findings

| # | Severity | Finding |
|---|---|---|
| **P1** | 🔴 | The stylesheet that declares the entire palette is not in the shell cache |
| **P2** | 🔴 | The app cannot boot without the network — the offline story is fiction |
| **P3** | 🟠 | The login page is not part of the app, and an installed app lands there daily |
| **P4** | 🟠 | An iOS install draws its top bar underneath the status bar |
| **P5** | 🟠 | The maskable icon is the same file as the plain one, so Android crops the mark |
| **P6** | 🟡 | A dead session makes the whole worker install fail, silently |
| **P7** | 🟡 | No `id` in the manifest — moving the dashboard path orphans every install |
| **P8** | 🟡 | Nothing tells an installed app that it changed under it |
| **P9** | 🟡 | `cache.match` without `ignoreSearch` misses the page when it carries a query |
| **P10** | 🟢 | `background_color` is the shell colour, so the splash flashes a shade the app never shows |
| **P11** | 🟢 | No `screenshots` in the manifest, so the install dialog is the minimal one |
| **P12** | 🟢 | Nothing in the product ever says the dashboard can be installed |
| **P13** | 🟢 | No `display_override` |

---

### P1 🔴 The stylesheet that declares the entire palette is not in the shell cache

`sw.js:3-15` lists six scripts, three images and the manifest. It does not list
`/admin/dashboard/css/custom.css`.

That was survivable when the stylesheet held badges and a scrollbar. It is not survivable now:
since `6decf61` every colour in the Tailwind config is `var(--…)` (`index.html:26-47`) and every
one of those custom properties is declared in exactly one place — `custom.css:13-41`. A load that
misses the stylesheet resolves every colour to nothing.

The test that exists to catch this cannot. `test/admin/pwa.test.js` greps the composed page for
`<script src="js/…">` and asserts each one appears in `SHELL`. A `<link rel="stylesheet">` is
invisible to that regex.

**Fix:** add `/admin/dashboard/css/custom.css` to `SHELL`, bump `CACHE` to `v3`, and extend the
test to collect stylesheet hrefs the same way it collects scripts.

### P2 🔴 The app cannot boot without the network

Four of the page's dependencies come from a CDN: Tailwind (`index.html:21`), Chart.js (`:66`),
Alpine (`:67`) and two Google Fonts stylesheets (`:19-20`). None is cached, and none can be —
the Tailwind CDN build is a JIT compiler that runs in the browser, and vendoring it means a build
step, which `AGENTS.md` rules out.

So offline, the cached shell produces: no Tailwind, therefore no classes; no Alpine, therefore
`x-data` never initialises, `[x-cloak]` elements stay hidden forever and every `x-show` element
renders at once. The `.catch(() => caches.match(request))` fallback at `sw.js:46` can only ever
serve the parts of a page that cannot assemble themselves.

This is not an argument for deleting the worker. Chrome still requires a fetch handler to offer
an install, and the cache makes a warm load instant. It is an argument for **saying what the
install is**: a launcher with its own window and icon, not an offline application. Which is
honest anyway — every number on every screen comes from the gateway, so an offline dashboard has
nothing to show.

**Fix:** land P1, then state the limit in one line in `docs/guides/deployment.md` and drop any
wording that implies offline use. Revisit only if the CDN dependencies ever become local, which
is a different decision with its own ADR.

### P3 🟠 The login page is not part of the app

`src/admin/login.js:11` builds a self-contained page: no `<link rel="manifest">`, no
`theme-color`, a monospace font stack where the app uses Inter and Space Grotesk, and eight
colour literals re-typed (`login.js:18-19`) from the palette the codebase just finished declaring
once.

The session TTL is 12 hours (`src/middleware/admin-session.js:6`), so an installed app lands on
this page roughly once a day, inside a standalone window with no browser chrome to explain the
change. It reads as a different application.

Two consequences beyond the look:

- The page is outside `SHELL`, so offline it is the browser's own network-error screen, inside an
  app window with no address bar and no way back.
- `redirectToLogin()` (`src/admin/public/js/app.js:11-16`) sends the user there on any 401, so
  this is the *normal* path, not an edge case.

**Fix:** give the login the manifest link, the theme colour, the app's fonts and the app's
palette. This is also the screen where the CRT treatment belongs — see the note at the end.

### P4 🟠 An iOS install draws its top bar underneath the status bar

`index.html:5` sets `viewport-fit=cover` and `:9` sets
`apple-mobile-web-app-status-bar-style: black-translucent`. That pair is exactly the combination
that extends the web view *behind* the status bar. Nothing in `custom.css` or the markup reads
`env(safe-area-inset-*)`, and the mobile top bar is `fixed top-0 inset-x-0 h-14`
(`index.html:73`).

On an iPhone home-screen install the hamburger and the wordmark sit under the clock and the
notch. Confidence is high on the mechanism and zero on the pixels — no iOS device was available.

**Fix:** `padding-top: env(safe-area-inset-top)` on the mobile bar and a matching offset on the
content, plus `env(safe-area-inset-bottom)` on the sidebar footer. Two rules.

### P5 🟠 The maskable icon is the same file as the plain one

`manifest.webmanifest:13-14` declares `icon-512.png` twice, once `purpose: "any"` and once
`purpose: "maskable"`. Android applies a circle or squircle mask to a maskable icon and expects
roughly 20% bleed on every side; an icon drawn to its own edges loses its outer ring.

**Fix:** a separate `icon-512-maskable.png` with the mark inside the middle 60% of the canvas on
`--surface-shell`, and a third icon entry pointing at it.

### P6 🟡 A dead session makes the whole worker install fail

`SHELL` includes `/admin/dashboard/` (`sw.js:4`), which 302s to the login without a session.
`cache.addAll` follows the redirect and then `cache.put` rejects on a redirected response, so the
whole `addAll` rejects and the new worker never installs. Bump `CACHE` while a session happens to
be expired and the old worker keeps serving indefinitely, with nothing reported anywhere.

**Fix:** precache the assets only and let the page cache itself on its first successful fetch —
the fetch handler already does the write. Or keep it in `addAll` and catch per-entry.

### P7 🟡 No `id` in the manifest

Without `id`, the install identity is derived from `start_url`. Any later move of the dashboard
path makes every existing install a different app: the old one stays on home screens, pointing at
a URL that no longer exists.

**Fix:** `"id": "/admin/"`. One line, and it costs nothing to add before there are installs to
strand.

### P8 🟡 Nothing tells an installed app that it changed under it

`sw.js:18` calls `skipWaiting()` and `:25` calls `clients.claim()`, so a new worker takes over an
open page immediately. Cache entries are refreshed one request at a time (`sw.js:40-43`), so
after a `shellm update` the cache can hold a page from one release and a script from another
until every entry has been re-fetched. Nothing surfaces the change.

Low severity because the fetch handler is network-first, so an online page is always fresh. It
becomes real the first time someone debugs a phantom.

**Fix:** either drop `skipWaiting()` and add a "reload to update" line to the connection banner,
or accept it and write down why. Do not leave it undecided.

### P9 🟡 `cache.match` without `ignoreSearch`

`sw.js:46` matches on the full URL. `SHELL.includes(url.pathname)` at `:35` deliberately ignores
the query, so a request for `/admin/dashboard/?anything` passes the filter and then misses the
cache entry it was routed to.

**Fix:** `caches.match(request, { ignoreSearch: true })`.

### P10 🟢 `background_color` is the shell colour

`background_color` and `theme_color` are both `#1a1e21` — `--surface-shell`, the sidebar and
mobile-bar colour. The page body is `bg-surface`, `#101417`. The splash screen shows a shade the
app itself never uses full-bleed.

This is also the one place a CSS custom property genuinely cannot reach, so the literal has to
stay. It should carry a comment saying which token it mirrors, or the next palette change will
miss it — which is precisely how D19 happened.

**Fix:** `background_color: "#101417"`, and a note in the manifest's neighbourhood naming the
tokens both values mirror.

### P11 🟢 No `screenshots` in the manifest

Chrome's richer install dialog — the tall one on Android, and the preview on desktop — reads
`screenshots` with a `form_factor`. Without it the prompt is the minimal bar.

`design/exports/` already holds candidates, and the CSP already allows them (`img-src 'self'`).
Three are usable as-is; `admin-overview-default.png` is not, because two of its panels render the
words *"CHART INTERIOR NOT MIRRORED"* — a Pencil placeholder, not a product state.

**Fix:** copy the usable exports into `src/admin/public/img/`, resized, and add
`"screenshots": [{ "src": …, "sizes": …, "type": "image/png", "form_factor": "wide" }]`.

### P12 🟢 Nothing in the product says the dashboard can be installed

No listener for `beforeinstallprompt`, and the System page — which exists to say "this is your
instance" — never mentions it. The only places it is written down are one line in
`docs/guides/deployment.md:95` and one clause in the README's API table.

iOS fires no install event at all, so on the platform where installing matters most, copy is the
only available route.

**Fix:** one line on the System page, shown only when
`matchMedia('(display-mode: browser)')` matches, naming the browser's own menu item. An intercepted
`beforeinstallprompt` with a custom button is more work for the same outcome and does nothing on
iOS.

### P13 🟢 No `display_override`

`"display_override": ["standalone", "minimal-ui"]` gives a fallback other than a browser tab
where standalone is unavailable. Marginal; listed for completeness.

---

## Suggested order

1. **P1** — one line in `sw.js`, one assertion in the test. The stylesheet is load-bearing today.
2. **P3 + P4** — the login page and the safe-area insets are the two things a person actually
   sees on an installed app. P3 carries the CRT work.
3. **P5, P6, P7, P9, P10** — the manifest and worker corrections, one commit.
4. **P2's documentation line, P8's decision** — both are "write down what is true", not code.
5. **P11, P12, P13** — reach, not defects.

**P2 is the one that needs a call before anything else is worth doing.** If the answer is "an
install is a launcher", everything above is a two-hour tidy. If the answer is "it should work on
a plane", it is a build step, a vendored Tailwind and a new ADR — and that contradicts
`AGENTS.md`. The audit's recommendation is the launcher.

## Note for the `.pen` work

The login screen is not in `design/flows/admin.pen`. It is a real screen of this app — the one an
installed PWA shows roughly daily — and it is currently the only surface that does not consume the
palette. It should be mirrored, and its CRT treatment drawn, before the code changes, per the
source-of-truth rule in `design/README.md`.
