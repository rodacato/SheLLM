# Design audit — admin dashboard

> **Subject:** the shipped code. `src/admin/public/index.html` (1231 lines — the whole SPA),
> `css/custom.css`, `js/{app,overview,keys,logs,playground,system}.js`, and the
> `src/admin/*.js` routes that feed them. No `.pen` export exists yet, so there is nothing
> else to review.
>
> **Date:** 2026-09-20 · **Scope:** whole screen, not a change — so nothing is classified
> `Introduced` / `Pre-existing`; everything here is pre-existing and the label would say nothing.

## Method

Per [`README.md`](README.md), **the code is the source of truth**. The seven Stitch mockups in
`docs/screens/` are not authoritative and divergence from them is not a defect by itself — they
are read for intent only, and where code and mockup disagree the code wins.

The exception, and the highest-yield check here, is
`docs/screens/shellm_style_guide_v1_technical_design_system/code.html`: **the product wrote its own
style guide**, so comparing the shipped CSS against it finds places where the admin contradicts a
rule it set for itself. Both sides are quoted verbatim below.

Findings are numbered from **D2** — [`DECISIONS.md`](DECISIONS.md) holds one entry (D1) and there
is one flow (`admin.pen`), so there is no collision risk.

---

## Status — merged to master, 2026-09-20

| | Landed | Open |
|---|---|---|
| **Bugs** | B1 B2 B3 B4 | — |
| **Pass 1** | D2 D3 D4 D5 D6 D7 **D8** | — |
| **Pass 2** | D9 D10 D12 **D13** | D11 D14 |

Seven commits. Six merged in [#53](https://github.com/rodacato/SheLLM/pull/53); the above-the-fold
pass (D8 + D13) is on `design/above-the-fold`, not yet pushed. Every commit verified to pass
`npm test` and `npm run lint` on its own.

**Everything mechanical is done.** What remains is one feature and one lift:

- **D11** — a hung request has no home. The biggest remaining item by the audit's own reading: a
  CLI subprocess that never returns is this product's characteristic failure. Needs the queue to
  expose a start time per active job before the UI can show an age. Carded.
- **D14** — extend the verdict pattern past the two places that have it. A lift; the panels are
  correct without it. Carded.

**D10 closed without a card.** The banner and the browser's online/offline events landed with D9;
the residual — the queue panel rendering `0 / 0` as a measurement before anything had been read —
went with D13's pass. It shows a dash now.

### Three things this audit got wrong

- **B1 was nine missing keys, not five.** The count read the top-level keys of the `res.json({…})`
  literal and missed the four token columns arriving through the `...agg` spread.
- **D9 undercounted the Overview**, which had a fourth silent swallow (`fetchProviders`) beyond the
  two named.
- **D8 prescribed `text-2xl`**, which ties the page title with the latency values at
  `text-2xl font-black`. Shipped at `text-xl`: on a metrics page the numbers outrank the title.

### Two decisions taken

- **D4 → the system mono stack**, declared in the Tailwind config rather than left implicit. A
  webfont was rejected; the admin already loads two families plus Material Symbols, and the
  operator reads the system mono in their terminal anyway.
- **D13 → Errors first, conditional on rows.** A clean period renders no Errors card at all, so the
  promotion costs nothing when nothing is wrong.

### Two findings had a prerequisite this audit did not name

**D5** needed `byModel` to count priced rows, which only `usageByProvider` did — that is why the
cell could not simply copy its neighbour. **D3** could not be done cleanly before the shell was
split, because every Logs change sat in the same 1231-line file as everything else.

## The verdict

The admin is **an operator tool wearing a landing page's clothes for the first 180 vertical pixels
of every screen, and an operator tool everywhere below that.** The content below the fold is dense,
honest and — in places — genuinely well authored: the latency split with a verdict sentence instead
of a number, the scatter that refuses to average, the update panel that says what the operator must
run. That is not generic work and it is not the problem.

The problem is that **the admin cannot tell you it failed.** Thirteen fetches swallow their errors,
and a down gateway, an empty database and a healthy idle gateway render as the same screen. On a
tool whose entire job is diagnosis, that is the finding everything else is smaller than.

Second: **the Logs page — the page an operator lives in — is built from a different design system
than the other four**, imported wholesale from a mockup. And the status palette (`ok` / `warn` /
`fail`) is defined in four places and tokenised in none.

---

## Pass 1 — what is wrong

| # | Tag | Section | Finding |
|---|---|---|---|
| **D2** | `drift` | all | Four definitions of the status palette, zero tokens — and the one token that exists is written as a literal 6 times |
| **D3** | `vice` | logs | The Logs page is a different design system, imported from the mockup |
| **D4** | `drift` | all | 103 elements set in `font-mono`; no mono typeface is loaded or configured |
| **D5** | `vice` | overview | "By Model" conflates free with not-priced — a problem "By Subscription" solved 145 lines above |
| **D6** | `drift` | logs | A "Live Feed" badge on a table that never refreshes itself |
| **D7** | `vice` | login | The front door shares nothing with the dashboard but the accent colour |
| **D8** | `slop` | all | Landing-page headers on an operator tool |

### D2 · `drift` · Four status palettes, zero tokens

The shipped Tailwind config defines exactly one status colour:

```js
// index.html:39
'error':                    '#ffb4ab',
```

It is used as a token **3 times** (`text-error` ×2, `text-error/70` ×1) and written as its own
literal **6 times** — index.html:164, 533, 753, 954, 972, 1174:

```html
<span class="font-headline font-bold text-[#ffb4ab] text-sm">USAGE LIMIT HIT</span>
```

The other three status colours have no token at all and are redefined per surface:

| Colour | `index.html` | `custom.css` | `js/*.js` | Also |
|---|---|---|---|---|
| warn `#ffb800` | 14 | 1 (`.badge-4xx`) | 2 | — |
| fail `#ef4444` | 9 | 2 (`.badge-5xx`, `.dot-red`) | 2 | — |
| ok `#22c55e` | 2 | 2 (`.badge-2xx`, `.dot-green`) | 1 (`STATUS_COLORS`) | `text-green-400` at index.html:771 — a **fifth** green (`#4ade80`) |

The style guide is a fourth opinion again (`Status_OK #00FF41`, `tertiary-fixed-dim #00e639`). The
code wins on the values; what it has no answer for is that the same three meanings are declared in
HTML, CSS, JS and a Tailwind config that only knows one of them.

This is D1's neighbourhood, but it is not D1: D1 measured `#101417` / `#03e3ff` / `#e0e3e7` —
surfaces and brand. This is the **semantic** scale, and `#1a1e21` (7 sites) and `#2e3b44` (8 sites)
are not in the config either.

**Correction:** three tokens (`ok`, `warn`, `fail`) in the Tailwind config, consumed by the badge
classes, the dot classes and `STATUS_COLORS`. Replace the 6 `#ffb4ab` literals with `text-error`.

### D3 · `vice` · The Logs page is a different design system

Every other page draws containers with `bg-surface-container` (`#1c2023`) and square corners. The
Logs page does not, and the values it uses instead are the mockup's.

The shipped config abolishes radius deliberately, and `custom.css` says why:

```js
// index.html:45-52
borderRadius: { DEFAULT: '0px', sm: '0px', md: '0px', lg: '0px', xl: '0px', full: '9999px' },
```
```css
/* custom.css:51 */
/* Toggle switch (square, matches brutalist theme) */
```

The Logs table then does this:

```html
<!-- index.html:507 -->
<div class="bg-[#2e3b44] rounded-[10px] overflow-hidden">
```

`rounded-[10px]` is an arbitrary value that routes around the config, making the Logs table **the
only rounded container in the admin**. Its source is not ambiguous — the style guide's card:

```html
<!-- style guide code.html:256 -->
<div class="bg-[#2E3B44] p-8 rounded-[10px] space-y-8">
```

The rest of the page came with it: `bg-[#2e3b44]` on all four filter selects (:457, :465, :474,
:483) and the page-size select (:606), `bg-[#1a1e21]` on the table head (:510),
`divide-[#2a3038]` (:523) — a divider colour used nowhere else. The four selects also carry
`rounded-lg`, which the config maps to `0px`: **four dead classes**, plus a bare `rounded` at :606.

The header scale broke too. Four pages use one treatment, Logs uses another:

```html
<!-- index.html:134, and identically at :695, :898, :988 -->
<h2 class="text-5xl font-bold font-headline tracking-tighter …">OVERVIEW<span …>_</span></h2>
<!-- index.html:449 -->
<h2 class="text-3xl font-bold font-headline tracking-tight …">Request Logs</h2>
```

No `_` cursor, `tracking-tight` not `tracking-tighter`, `text-3xl` not `text-5xl`, no subtitle.

**Correction:** bring Logs onto the shipped config — `bg-surface-container`, no radius, the
`outline-variant` divider, and one header treatment. This is the single highest-leverage fix in
Pass 1; it is one page and it removes 12 off-system values.

### D4 · `drift` · 103 mono elements, no mono typeface

The style guide declares mono a first-class family and loads it:

```js
// style guide code.html:65-70
fontFamily: { "headline": [...], "body": [...], "mono": ["JetBrains Mono", "monospace"], … }
```
```html
<!-- style guide code.html:8 -->
…family=Space+Grotesk…&family=Inter…&family=JetBrains+Mono:wght@400;500&display=swap
```

The admin sets **103 elements** in `font-mono` — every metric, every timestamp, every ID, every
cost — and then:

```js
// index.html:41-44
fontFamily: {
  'headline': ['"Space Grotesk"', 'system-ui', 'sans-serif'],
  'body':     ['"Inter"', 'system-ui', 'sans-serif'],
},
```
```html
<!-- index.html:19 — the only text font link -->
…family=Space+Grotesk:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap
```

No `mono` key, no mono webfont. All 103 fall back to Tailwind's default `ui-monospace` stack, so
roughly half the admin's type is whatever the operator's OS happens to ship — the one axis of the
identity that is not controlled.

Deciding to use the system mono would be a legitimate call for an operator tool and cheaper than a
webfont. But it is not a decision anywhere: the style guide names a face, the config is silent, and
the result is accident rather than choice. **Either load it or declare the system stack in the
config.**

### D5 · `vice` · "By Model" conflates free with not-priced

The "By Subscription" table gets this exactly right:

```html
<!-- index.html:213-214 -->
<td class="py-2 text-right" :class="p.priced_requests > 0 ? 'text-white' : 'text-outline'"
  x-text="p.priced_requests > 0 ? formatCost(p.cost_usd) : 'not priced'"></td>
```

145 lines later, the "By Model" table on the same page does not:

```html
<!-- index.html:359 -->
<td class="py-2 text-right text-outline" x-text="formatCost(m.cost_usd)"></td>
```

`formatCost` returns `'-'` for both `null` and `0` (app.js:56), so a model SheLLM cannot price and
a model that genuinely cost nothing render identically — as the same `-` that means "no data"
everywhere else in the UI. The product already knows this distinction matters and drew it once.

### D6 · `drift` · "Live Feed" on a table that never refreshes

```html
<!-- index.html:450 -->
<span class="… uppercase tracking-widest font-headline font-bold">Live Feed</span>
```

There are exactly two timers in the admin, and neither is on this page:

```
js/app.js:120       setInterval(() => this.fetchHealth(), 30000);
js/overview.js:36   this._refreshInterval = setInterval(() => this.fetchStats(), 30000);
```

`logsPage()` has none. It also has no manual refresh control — the only ways to re-read the table
are to change a filter, change the page size, paginate, or reload the browser. The badge promises
the one thing the page does not do.

**Correction:** either add the poll (and pause it while a row is expanded), or replace the badge
with a refresh button and a last-read timestamp. The badge alone is the worst of the three.

### D7 · `vice` · The front door shares nothing with the dashboard

`src/admin/login.js:18` inlines a whole parallel palette:

```css
:root { color-scheme: dark; --bg:#1a1e21; --panel:#242a2e; --line:#38424a;
        --text:#f9f9f7; --accent:#03e3ff; --error:#ff6b6b; }
```

Of six values, **one** (`--accent`) exists in the dashboard. `#242a2e`, `#38424a`, `#f9f9f7`,
`#ff6b6b` appear nowhere else, and `--error:#ff6b6b` is a seventh red on top of D2's four. The
body is set in `ui-monospace, SFMono-Regular, Menlo, monospace` (login.js:21) while the dashboard
is Inter + Space Grotesk. There is no logo — `img/logo-dark.svg` exists and is used twice in the
dashboard (index.html:68, :79) but not here.

This is the first screen of the product and it looks like a different product. The page itself is
otherwise fine — small, fast, no dependencies, correct `autocomplete` attributes, a real
`safeNext` guard. It needs the palette and the logo, not a redesign.

One state is missing from it: a rate-limited operator gets `sendError(...)` (login.js:81) — raw
JSON — rather than the login page with the message and the retry-after. That is the one moment a
locked-out operator most needs a page.

### D8 · `slop` · Landing-page headers on an operator tool

Four of five pages open with the same block:

```html
<!-- index.html:132-143 -->
<header class="mb-10">
  <h2 class="text-5xl font-bold font-headline tracking-tighter …">OVERVIEW<span …>_</span></h2>
  <p class="text-on-surface-variant">System health, provider status, and request metrics at a glance.</p>
</header>
```

`text-5xl` is 48px. With `mb-10` and the subtitle, the header block costs roughly 180px before a
single number appears — on a 900px viewport, a fifth of the screen spent saying the word the
sidebar already highlights.

The subtitles are the tell. "System health, provider status, and request metrics at a glance",
"Manage client credentials, rate limits, and model access controls", "What is running, and which
providers are allowed to answer" — these are written for someone being *introduced* to the page.
The operator opening it at 3am to find out why a client is getting 502s has read them a hundred
times.

Applying the removal test: delete the subtitle and drop the title to `text-2xl`. Nothing is lost —
the sidebar already says which page this is, in a highlighted state, permanently. What is gained is
one more card above the fold on every page.

**The `_` cursor is not the problem and should stay.** It is a cheap, specific piece of brand that
would not survive transplant into another product — which is the opposite of slop.

---

## Pass 2 — what is missing

| # | Tag | Section | Finding |
|---|---|---|---|
| **D9** | `gap` | all | Down, empty and idle render identically — 13 fetches swallow their errors |
| **D10** | `gap` | shell | A PWA with no offline state at all |
| **D11** | `gap` | overview · playground | The hung request — the failure this product is most exposed to — has no home |
| **D12** | `gap` | overview · logs | Auto-refreshing data with no "as of" |
| **D13** | `gap` | overview | The Errors table is the most diagnostic thing on the page and it is last |
| **D14** | `lift` | all | The product wrote one verdict sentence and stopped |

### D9 · `gap` · Down, empty and idle render identically

This is the finding. Thirteen data fetches discard their failures:

```
js/app.js:135        fetchHealth
js/overview.js:30    fetchStats          js/overview.js:219  fetchProviders
js/logs.js:50        fetchLogs           js/logs.js:89       fetchStats        js/logs.js:101  clearLogs
js/keys.js:25        fetchKeys           js/keys.js:36       fetchAuditLogs    js/keys.js:133  toggleActive
js/keys.js:146       rotateKey           js/keys.js:155      deleteKey
js/system.js:56      fetchProviders      js/system.js:203    toggleProvider
```

all of the form `} catch { /* ignore */ }`, each paired with an `if (res.ok)` that has no `else`.
The consequences, drawn:

| The server is | The screen says |
|---|---|
| unreachable | `No logs found` (index.html:525) |
| unreachable | `No keys created yet` (index.html:736) |
| unreachable | `Active 0 / 0 · Pending 0 · Streams 0 / 0` and `0% of concurrency in use` (:234-254) |
| unreachable | `UP 3d 4h`, frozen, dot still pulsing (:103-104) — see **B2** |
| 500 on `/stats` | a blank Overview: header, period filter, empty provider list, nothing else |

Every one of those is the reading an operator would give a **healthy, idle** gateway. The tool
cannot say "I could not ask" — which is the one sentence a diagnostic tool must be able to say.

The server collapses the same distinction. `GET /logs` and `GET /stats` answer **200 with empty
data** when there is no database:

```js
// src/admin/logs.js:94
if (!db) return res.json({ logs: [], total: 0, limit: 50, offset: 0 });
// src/admin/stats.js:67
if (!getDb()) return res.json({ period: req.query.period || '24h', ...EMPTY });
```

So "the database is gone" and "you have made no requests" are the same response. Fixing the UI
without fixing this only moves the lie one layer down.

**Correction:** one shared banner state (`the gateway did not answer — last read 14:03`), set by a
single `catch` handler in `apiFetch`, plus a distinct empty state per table that only renders after
a *successful* fetch returned zero rows. Three states, not two: `loading` · `unreachable` · `empty`.

### D10 · `gap` · A PWA with no offline state

The admin ships a manifest (`display: standalone`) and a service worker. Neither `index.html` nor
any `js/*.js` mentions `navigator.onLine`, an `online`/`offline` listener, or the word offline —
verified by grep across all seven files.

`sw.js` is correctly conservative — shell only, network-first, nothing with account data cached
(sw.js:1). The consequence is that an installed, offline admin **opens successfully**: the shell
comes from cache, then every data fetch fails into D9's silent catches, and the operator gets
a fully-rendered dashboard reporting an idle gateway with no keys and no logs.

Installing it as an app is what makes this worse than a browser tab — there is no URL bar, no
browser error page, no reload affordance. The one context where the app is guaranteed to be wrong
is the one where the browser's own chrome has been removed.

**Correction:** the D9 banner, driven additionally by `window.addEventListener('offline', …)`, and
`start_url` state that makes the first paint say it is showing nothing rather than showing zero.

### D11 · `gap` · The hung request has no home

SheLLM's defining performance fact is that requests are CLI subprocesses measured in seconds
(`project-shellm`: 3.0–3.8s spawn, 0.86–1.03s warm). A subprocess that never returns is therefore
this product's characteristic failure, and it is the one failure not drawn anywhere.

What exists is counts. The queue panel (index.html:231-254) shows `active`, `pending`,
`active_streams` — never *how long* any active request has been running. An operator seeing
`Active 3 / 3 · Pending 12` cannot tell whether three requests are working normally or three have
been wedged for nine minutes holding the whole gateway. The distinction is the entire diagnosis.

The Playground has the same hole at single-request scale:

```html
<!-- index.html:956 -->
<p x-show="running" class="text-xs font-mono text-outline">Waiting for the CLI…</p>
```

`send()` (playground.js:67-105) uses a bare `fetch` with no `AbortController`, no timeout and no
cancel control. A hung CLI leaves that sentence on screen indefinitely with the Send button
disabled (`:disabled="running"`, :943) and no way out but a reload.

**Correction:** an age column on the in-flight requests (the data exists — the queue knows when each
active job started), and an abort on the Playground. The elapsed counter is worth more than the
count.

### D12 · `gap` · Auto-refreshing data with no "as of"

Overview re-reads stats every 30s (overview.js:36) and health every 30s (app.js:120). Nothing on
the page says when the numbers on screen were last read.

That is tolerable while refreshes succeed. Combined with D9 it is not: a failed refresh is silent
and leaves the previous values in place, so the page can show forty-minute-old numbers that look
exactly like current ones. The period filter (`24h / 7d / 30d`) makes it worse by supplying a
plausible-but-wrong answer to "how fresh is this?" — it describes the window, not the read.

**Correction:** one line in the Overview header — `read 14:03:22` — going amber when the last
attempt failed. Cheapest fix in this pass and it is the one that makes D9 legible.

### D13 · `gap` · The Errors table is last

The Overview reads, top to bottom: Capacity → Now → Latency → Usage → Traffic → **Errors**.

The Errors table (index.html:405-438) is the best-designed element on the page. It is the only view
that answers *what broke, whose it was and which route*, and every row is a link into the filtered
log (`@click="openErrorLogs(row)"`, :423 → overview.js:75-82). At 1440×900 it sits roughly five
screens down.

Above it are five sections that answer "how is throughput" — the question you ask when nothing is
wrong. The only failure surfaced at the top is the `USAGE LIMIT HIT` banner (:163-167), which
covers exactly one failure mode out of the four that matter.

**Correction:** promote Errors to directly under the period filter, and show it only when
`errorRows.length > 0` so it costs nothing on a healthy day. Latency and Usage are reference; errors
are the reason the page was opened.

### D14 · `lift` · The product wrote one verdict and stopped

```js
// js/overview.js:62-68
// The whole point of the split: queueing is fixed by raising concurrency, execution is not.
lagVerdict() {
  if (queuedPct >= 40) return `${queuedPct}% spent queueing — raise MAX_CONCURRENT`;
  if (queuedPct >= 15) return `${queuedPct}% queueing — concurrency is starting to bite`;
  return 'the CLI, not the queue';
}
```

This is the best thing in the admin. It does not report a number — it reports what the number
means and what to do about it, in the operator's vocabulary, and the comment says why. The update
panel does the same with `TRIGGER_HELP` (src/admin/update.js:21-27), deliberately: *"the dashboard
shows these verbatim, because 'the updater is not enabled' sends half of the people who read it to
the wrong command."*

Two places do this. Every other panel reports a raw value and leaves the inference to the reader:

- `Circuit: open · 5 failures` (system.js:32-37) — says nothing about what an open circuit means for
  traffic right now, or when it will retry.
- `not authenticated` (system.js:210) — the operator has to know which `login` command that implies.
- `$0.84/hr · 3.2 rpm` (index.html:176) — no read on whether that burn rate is normal for this host.

Extending the pattern to those three is a `lift`, not a `gap` — the panels are correct without it.
But it is the product's own strongest move, and it is currently used twice out of a possible dozen.

---

## Bug ledger

Verifiable correctness. These belong on the project board, not in the design tables, and do not
wait for a kit batch.

| # | Where | Bug |
|---|---|---|
| **B1** | `src/admin/stats.js:21-26` + `index.html:399, 408, 665, 668, 671` | The no-database response omits 9 keys, two of which the UI dereferences unguarded |
| **B2** | `js/app.js:122-136` + `index.html:103-104, 1215` | An unreachable server leaves the health indicator reading `UP`, frozen and pulsing |
| **B3** | `js/logs.js:50` + `index.html:525`; `js/keys.js:25` + `index.html:736` | A failed fetch renders as an empty table |
| **B4** | `css/custom.css:6` + 9 call sites | `.material-symbols-outlined` pins `font-size: 20px`; nine icon size utilities fight it at equal specificity |

**B1** — `EMPTY` ships 13 keys; the populated response ships **9** more: `error_rate`, `timeline`,
`error_breakdown`, `cost_by_provider`, `cost_burn_rate`, and the four token columns `tokens_in`,
`tokens_out`, `cache_write_tokens`, `cache_read_tokens`. (This audit first said five — it counted
the top-level keys of the `res.json({...})` literal and missed the four that arrive through the
`...agg` spread.) The UI dereferences two of them without a
guard — `stats.error_rate.success_pct` (index.html:399, :408),
`stats.error_rate.client_error_pct` (:665), `stats.timeline.slice(-15)` (:668, :671). With
`stats` truthy and those keys absent, each expression throws. `x-show` does not prevent it: the
`x-text` inside a hidden element still evaluates. Net effect: the Overview and the Logs summary
break in expressions precisely in the degraded case they exist to report. Either ship the same
shape from `EMPTY` or guard all five.

**B2** — `fetchHealth` assigns `this.health` only inside `if (res.ok)` and swallows throws, so the
last good value survives every subsequent failure. The sidebar keeps rendering
`'UP ' + formatUptime(health.uptime)` with a frozen figure and `animate-pulse` still running, and
the footer (`index.html:1215`) repeats it. The single element whose job is to say the server is
alive is the one that keeps saying so after it dies.

The never-connected case is the mirror image and no better: with `health.uptime` still `null` the
same element renders `CONNECTING...` (`index.html:104`) forever, with no attempt count and no
elapsed time, so "starting up" and "will never answer" are also the same screen.

**B3** — Listed under D9 as a design gap; the ledger entry is the narrow correctness half: `logs`
and `keys` are initialised to `[]`, `loading` is set `false` in the `catch` path, and the empty-row
branches test only `loading`. There is no state in which the UI can represent "the request failed",
so the code cannot be fixed by changing the template alone.

**B4** — `.material-symbols-outlined { font-size: 20px; }` is a class selector; so are
`text-[16px]` (×4), `text-[18px]` (×2), `text-[20px]` (×1) and `text-sm` (×2). Equal specificity
means source order decides, and the Tailwind Play CDN injects its stylesheet when the script at
`index.html:21` executes — before `custom.css` is linked at `:59`. If that ordering holds,
`custom.css` wins and all nine utilities are dead; if the CDN's observer re-inserts later, the
utilities win and the base rule is dead. **Not verified in a browser** — no rendering was done for
this audit. Either way one of the two is dead code and the contradiction is real from reading
alone. Drop `font-size` from the base rule and keep the utilities.

---

## The three questions

**Is the density and hierarchy an operator's, or a landing page's?**

Below the fold, an operator's — and convincingly. Tables at `text-xs` / `text-[10px]`, 4px-grid
padding, `tabular` mono columns, `p-5` cards with `gap-4`, real information density with no
decorative chrome. Group spacing follows the ≥2× rule (`gap-4` within a card, `mb-8` between
sections) without being told to. The "Now" band packs queue saturation, pending, streams and
per-provider state into two cards. That is not a consumer layout.

Above the fold, a landing page's, for the first ~180px of four pages (**D8**), and the ordering
optimises for a tour rather than a diagnosis (**D13**). The fix is small and mostly subtractive.

**Are the failure states drawn, or only the happy path?**

Mixed, and the split is sharp. **The failures SheLLM can observe are drawn well:**

- Provider down — `dot-red`, `providerState()` (system.js:207-213), the `health_error` block
  (index.html:1173-1175), circuit state with failure counts (system.js:32-44). Good.
- Quota exhausted — the `USAGE LIMIT HIT` banner (index.html:163-167) with provider and since-time.
- Invalid key — expired and expiring-soon rendered distinctly on the keys table (:777-779);
  the Playground surfaces the 401 body rather than a generic message (:972).
- Update failed / stalled — four distinct states, each with the command to run (:1086-1115).

**The failures SheLLM cannot observe are not drawn at all:** the gateway itself being unreachable
(**D9**), being offline (**D10**), and a request hanging (**D11**). The pattern is consistent — every
state whose data arrives *in a successful response* has a design; no state that means *the response
never came* has one.

**Does the UI assume online?**

Completely (**D10**). Zero connectivity handling in any of the seven files, a service worker that
caches the shell so the app opens anyway, and a manifest that installs it standalone so the
browser's own failure chrome is gone. The service worker is well built; the UI behind it was never
told it might be running without a server.

---

## What I left alone

Deliberately not reported as findings:

- **The zero-radius brutalist palette and the square toggle.** Authored, and `custom.css:51` says so
  in its own words. D3 is not an argument against it — it is an argument that Logs should join it.
- **The `_` cursor in the page titles.** Cheap, specific, would not survive transplant. `keep`.
- **`formatTime`'s two-shape parsing** (app.js:60-63) — the comment records the exact NaN bug it
  fixed. Left untouched.
- **The scatter plot's refusal to average** (index.html:328): *"at this volume an averaged line
  invents shape that is not there"*. A later pass should not "improve" this into a line chart.
- **The Playground going through `/v1` with a real client key** (playground.js:1-3) rather than an
  admin shortcut, and deliberately *not* using `apiFetch` so a 401 is not read as a dead session
  (:79-80). Both reasoned in place.
- **The typed-confirmation for a major version jump** (index.html:1064-1071) and `watchUpdate`'s
  stale-status reasoning (system.js:150-157). Genuinely good operator design.
- **`sw.js` caching no `/admin/*` data** (sw.js:1). Correct, and the cause of D10 only in the sense
  that the UI was never told.
- **Dark-only palette and desktop-only layout.** `DECISIONS.md` marks both out of scope; not
  re-litigated. The mobile sidebar and top bar that exist anyway are not reported as a contradiction.
- **The other six mockups in `docs/screens/`.** Not authoritative per `README.md`. Divergence from
  them was not counted as defect — the style guide was used for the `drift` checks above, and the
  Logs mockup only to identify D3's source.
- **Correctness, security and performance** beyond the four ledger entries. Someone else's review.

### Motion — not judged

Per the brief, no motion findings. This was a static code read with no rendering, and judging
timing or easing from a class name is exactly the invention this audit should not commit.

Inventory only, as **`/ui-motion` candidates**: `animate-pulse` ×1 (health dot),
`transition-colors` ×20, `transition-all` ×1 (queue saturation bar, `duration-300`),
`transition-transform` ×1, `x-transition.opacity` ×1 (mobile backdrop), `duration-100` ×15,
`duration-150` ×1, `duration-200` ×1, plus `custom.css:55, 65` (toggle track 150ms, knob 150ms).

One overlap worth flagging so `/ui-motion` does not misdiagnose it: the pulsing health dot keeps
pulsing when the server is unreachable. That is **B2**, not a motion defect — the animation is
correct, the state feeding it is wrong.

---

## Suggested order

1. **B1, B2** — the degraded case currently breaks or lies. Cheap, no design decision needed.
2. **D9 + D12** — one banner and one timestamp; together they are most of what this audit found.
3. **D3** — one page onto the shipped config; removes 12 off-system values.
4. **D2** — three tokens, then the 6 `#ffb4ab` literals.
5. **D8, D13** — subtractive, and free above the fold.
6. Everything else as it comes.

D5, D6 and B4 are one-line fixes and can ride along with anything.
