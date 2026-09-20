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

> **A second pass ran on 2026-09-20 with the exports in hand — [Pasada 2](#pasada-2--con-exports),
> below.** It does not repeat this one. It reports what the composition shows and the code does
> not: **D30–D42**, plus **B5–B7** continuing the ledger here. It corrects nothing in this
> document; it does answer the question this one left open, which is why the page is ordered the
> way it is.

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

> **Judged since, 2026-09-20 — [`MOTION-AUDIT.md`](MOTION-AUDIT.md).** The app was driven in a
> browser: **D21–D27**, two 🐞 bugs at **D28–D29**, and one accepted proposal that defers to
> **D11**. It corrects this inventory in one place (`animate-spin` ×1 was missed) and confirms
> **B2** was fixed before the pass ran. Its numbers continue `DECISIONS.md`, not the `B1–B4`
> ledger below, which stays this document's.


---

## Suggested order

1. **B1, B2** — the degraded case currently breaks or lies. Cheap, no design decision needed.
2. **D9 + D12** — one banner and one timestamp; together they are most of what this audit found.
3. **D3** — one page onto the shipped config; removes 12 off-system values.
4. **D2** — three tokens, then the 6 `#ffb4ab` literals.
5. **D8, D13** — subtractive, and free above the fold.
6. Everything else as it comes.

D5, D6 and B4 are one-line fixes and can ride along with anything.

---

# Pasada 2 — con exports

> **Subject:** the seven committed PNGs in [`exports/`](exports/) (five screens, the brief frame and
> the Log frame), the kit export `ui-kit-tokens-0.2.0.png`, and the shipped code they mirror —
> `src/admin/views/`, `src/admin/public/js/`, `src/admin/public/css/custom.css`, plus
> `src/admin/stats.js` and `src/db/stats.js` where a screen's number is computed.
>
> **Date:** 2026-09-20 · at `0a4bec6` · **Scope:** the whole flow, not a change — so nothing is
> classified `Introduced` / `Pre-existing`. Findings continue `DECISIONS.md` at **D30**; the
> correctness half goes to this document's ledger at **B5**.

Pass 1 was a code read with no rendering. It closed D2–D10, D12 and D13 and is not re-litigated
here — every finding below is one a code read structurally cannot make: it needs two screens side
by side, or a measured distance, or the artboard contradicting the file that describes it.

**Inventory correction.** The brief for this pass named eight screen exports and the kit at
`0.1.1`. There are **seven** admin PNGs — five screens, one brief frame, one Log frame — and the
kit export is named `ui-kit-tokens-0.2.0.png`. That last name is itself **D33**.

## Two limits, declared

**1. The charts.** Both plot interiors carry `CHART INTERIOR NOT MIRRORED` and neither is drawn.
Measured from the code rather than from the picture: `h-[200px]` (scatter,
[`overview.html:249`](../src/admin/views/pages/overview.html#L249)) and `h-[180px]` (timeline,
[`overview.html:321`](../src/admin/views/pages/overview.html#L321)) against an Overview frame of
2201 px.

| | Of the Overview | Of the whole flow (4997 px drawn) |
|---|---|---|
| Plot interiors only | **17.3 %** (380 / 2201) | 7.6 % |
| Including card chrome | **23.4 %** (516 / 2201) | 10.3 % |

So **roughly a quarter of the Overview could not be judged**, and the Overview is the only screen
with charts. Nothing below concerns colour-by-status, axis density, the `now` marker, the legend or
the zero-filled quiet hours. The refusal to approximate is correct and is marked `keep`.

**2. Motion.** None. Static PNGs show none and [`MOTION-AUDIT.md`](MOTION-AUDIT.md) already ran in a
browser. D34 and D42 touch layouts that will need a transition decision; that decision is
`/ui-motion`'s, not this document's.

One more, smaller: the Overview export is 2880×4402, so at any width that fits a page it
downsamples past 10 px legibility. Every claim about small type below was verified on a
native-resolution crop, not on the full-page view. One suspected defect — a stray rule through the
`1` in `ACTIVE 1 / 2` — **did not survive** that check: it is Space Grotesk's flag, and it is not
reported.

---

## The verdict

Pass 1 found an operator tool that could not say it had failed. That is fixed. What the exports
show is a different class of problem: **the admin has one visual level where it needs three, and it
spends its best positions on its least urgent facts.**

One typographic treatment — `text-[10px] font-headline font-bold uppercase tracking-[0.2em]
text-outline` — carries **49 elements** across five jobs: section eyebrow, card title, table column
header, form field label, and a disclosure button. Nothing in the type says which level you are
reading. Sections are distinguished from cards only by sitting outside a `bg-surface-container`,
which is a fact about the background, not about the hierarchy.

The cost is visible in one measurement. At the project's own declared frame of 1440×900
([`README.md`](README.md), *Canvas conventions*), the Overview's first screen ends **between the
queue panel's column labels and its numbers**:

| CSS px from top | What is there |
|---|---|
| 110 – 552 | **Errors** — four rows, 16 requests, 7–8 minutes old |
| 888 | `ACTIVE  PENDING  STREAMS` — the labels |
| **900** | **the fold** |
| 911 | `1 / 2 · 0 · 0 / 2` — the values |
| 958 | `50% of concurrency in use` |
| **984** | `oldest has been running 9.0m (claude · claude-fable) — that is long past a normal call` |

The page leads with sixteen requests the gateway **correctly rejected** eight minutes ago, and
clips the one sentence saying a subprocess is wedged **right now**. That sentence is 10 px,
`text-status-fail`, and 84 px below the fold. The largest type in the entire product — `text-4xl`,
36 px — is on Logs, on a retrospective error percentage, below a 25-row table.

That is the whole pass in one line: **the hierarchy is inverted, and there is no typographic level
available to fix it with.**

---

## Pass 1 — what is wrong

| # | Tag | Section | Finding |
|---|---|---|---|
| **D30** | `vice` | all | One label treatment, five jobs, 49 elements — the product has two hierarchy levels and one way to draw them |
| **D31** | `vice` | overview | Errors leads the page on `length > 0`, and the criterion that would qualify it is one line below, unused |
| **D32** | `vice` | logs | The summary band never joined the system D3 brought the table onto |
| **D33** | `drift` | kit | The export named `0.2.0` is the `0.1.1` canvas and says `0.1.0` in its own header |
| **D34** | `drift` | playground | The artboard draws a card the CSS stretches — the real empty space is inside it, not beside it |
| **D35** | `vice` | all | 15 type sizes, three spellings of 11 px, two of them identical — and zero type tokens in the kit |
| **D36** | `drift` | overview | `Last 7d` over 18 h of data, on the page whose sibling was fixed for exactly this |

### D30 · `vice` · One label treatment, five jobs

`text-[10px] font-headline font-bold uppercase tracking-[0.2em] text-outline` — 49 elements under
`src/admin/views/`, in five distinct roles:

| Role | Count | Example |
|---|---|---|
| Section eyebrow | 7 | `Capacity` ([`overview.html:68`](../src/admin/views/pages/overview.html#L68)), `Build` ([`system.html:9`](../src/admin/views/pages/system.html#L9)) |
| Card title | 14 | `Errors` ([`overview.html:30`](../src/admin/views/pages/overview.html#L30)), `p50` ([`:204`](../src/admin/views/pages/overview.html#L204)) |
| Table column header | 8 | `Name`, `Key prefix`, … ([`keys.html:33-40`](../src/admin/views/pages/keys.html#L33)) |
| Form field label | 12 | `RPM` ([`keys.html:107`](../src/admin/views/pages/keys.html#L107)), `Provider` ([`logs.html:11`](../src/admin/views/pages/logs.html#L11)) |
| Disclosure button | 1 | `Activity log` ([`keys.html:139`](../src/admin/views/pages/keys.html#L139)) |

The two declarations are the same string with the words in a different order:

```html
<!-- overview.html:68 — a SECTION -->
<span class="text-[10px] font-headline font-bold tracking-[0.2em] text-outline uppercase block mb-3">Capacity</span>
<!-- overview.html:30 — a CARD inside a section -->
<p class="text-[10px] font-headline font-bold uppercase tracking-[0.2em] text-outline">Errors</p>
```

Three consequences the exports make plain and a code read does not:

- **`p50` has the same type as `Latency`.** A metric name and the section containing it are drawn
  identically, four times over ([`:204`, `:208`, `:212`, `:216`](../src/admin/views/pages/overview.html#L204)).
- **The promoted block was typographically demoted.** D13 moved `Errors` to first position, but
  `Errors` is a *card title* while `Capacity`, `Now`, `Latency` and `Usage` below it are *section
  eyebrows*. The one block whose position says "read me first" is the junior of the four beneath it.
  `Traffic` has the same problem at the other end. Only **System** applies the eyebrow consistently
  — it is the one screen where the level actually reads.
- **On API Keys the level collapses entirely.** Column headers, form labels and the `Activity log`
  button are the same grey 10 px uppercase. In the export you cannot tell a column from a field from
  a control by type alone.

**Correction — one step, not a redesign.** Section eyebrows keep this treatment. Card titles drop
to `text-on-surface-variant` at normal weight, or lose `tracking-[0.2em]`. Column headers and field
labels are already distinguishable by position and need no change. One class edit per card title;
the kit gets the two named as distinct roles (**D39**).

### D31 · `vice` · Errors leads on `length > 0`

This is the answer to the third brief question, and it is narrower than "does it deserve the top".

```html
<!-- overview.html:27 — the ordering decision -->
<template x-if="stats && errorRows.length > 0">
```
```html
<!-- overview.html:51 — 24 lines below, the criterion that exists and is not consulted -->
:class="row.status < 500 ? 'text-status-warn' : 'text-status-fail'"
```

The page already knows that a 4xx and a 5xx are different kinds of news — it **colours** them
differently — and the condition that promotes the block to first position does not read that
distinction. In the drawn state the consequence is exact: four rows, statuses `400 / 401 / 404 /
404`, clients `Benchmark` (Adrian's own load-test key) and `(unauthenticated)`. Not one of them is
the gateway failing. A 401 to a caller with no key is the gateway **working**, and it is the lead
item on the operator's home screen.

The block also spends its premium width on nothing. Of six columns, two carry no information for
any drawn row:

| Column | Source | Drawn state |
|---|---|---|
| Error | `COALESCE(error_code, '(none)')` ([`db/stats.js:165`](../src/db/stats.js#L165)) | `(none)` ×4 |
| Route | `COALESCE(path, '-')` ([`db/stats.js:168`](../src/db/stats.js#L168)) | `–` ×4 |

And a seventh field the query pays to group by — `COALESCE(upstream_model, model, '-') AS model`
([`db/stats.js:167`](../src/db/stats.js#L167)) — is **never rendered and never passed to the
drill-down** ([`overview.js:127-133`](../src/admin/public/js/overview.js#L127)). Which model failed
is the column an operator would want, and it is the one that was fetched and dropped.

**Correction.** Promote on severity, not on presence: `errorRows.some(r => r.status >= 500)`, or a
4xx rate crossing a threshold the page can state. A period with only 4xx keeps Errors where it was
— below Capacity — and the top of the page goes to **Now**, which is the only section reporting the
present tense. Swap `Route` for `Model`; keep `Error` and let it collapse when every row is
`(none)`.

**D13 resolved the order. It did not resolve the criterion, and the criterion was already in the
file.**

### D32 · `vice` · The Logs summary band never joined the system

D3 brought the Logs *table* onto the shipped config. The two summary cards below it were not part
of that fix and are still built from the mockup's vocabulary. Counted across the five pages:

| Card recipe | Uses | Where |
|---|---|---|
| `bg-surface-container p-5` | **19** | overview ×14, system ×3, playground ×2 |
| `bg-surface-container-low p-6` | **2** | **logs only** ([`:228`](../src/admin/views/pages/logs.html#L228), [`:246`](../src/admin/views/pages/logs.html#L246)) |
| `bg-surface-container-low p-4` | 1 | logs ([`:226`](../src/admin/views/pages/logs.html#L226)) |

A different surface step and a different padding step, on the one page an operator lives in. Two
more things came with them:

- **`border-l-4 border-primary-container`** ([`logs.html:228`](../src/admin/views/pages/logs.html#L228))
  is the **navigation selected-state** rail — the same 4 px cyan border the sidebar uses for "you
  are here" ([`index.html:98`](../src/admin/views/index.html#L98)) and the keys page uses for "this
  was just created" ([`keys.html:9`](../src/admin/views/pages/keys.html#L9)). Three meanings, one
  signal. The 2 px red rail is the counter-example and is coherent: degraded banner
  ([`index.html:141`](../src/admin/views/index.html#L141)) and `USAGE LIMIT HIT`
  ([`overview.html:72`](../src/admin/views/pages/overview.html#L72)), both "something is wrong".
- **`text-4xl` on the metric values** — 36 px, the largest type in the admin, against a page title
  of `text-xl`. Every other screen's biggest number is `text-2xl` at most. The product's loudest
  type is on a retrospective percentage, sitting under a 25-row table.

The `<h2>` used for those values is a correctness matter and is **B7**.

**Correction.** `bg-surface-container p-5`, drop the rail, `text-2xl` to match Overview's latency
cards. The band's *position* is D40.

### D33 · `drift` · The kit export is three versions at once

[`ui-kit-tokens-0.2.0.png`](exports/ui-kit-tokens-0.2.0.png) contains, on its own canvas:

- a header reading **`kit-version 0.1.0`**;
- a closing note describing **0.1.1**'s rgba fix and nothing after it;
- a **filename** asserting **0.2.0**.

The content is 0.1.1's. All seven tokens [`ui-kit.CHANGELOG.md`](ui-kit.CHANGELOG.md) records for
0.2.0 are absent — the Surfaces row has six steps with no `surface-shell`, and there is no
`nav-selected`, `error-container`, `danger-surface`, `danger-surface-hover`, `white` or
`primary-container-hover`. The Brand row still shows **`brand-hover`**, the name the changelog says
0.2.0 replaced:

> *"`primary-container-hover` replaces the kit-local `brand-hover` now that the code declares it
> under that name."* — `ui-kit.CHANGELOG.md`, 0.2.0

`README.md` says exports are *"committed — they must travel"* for PR review. This one travels a
version that does not exist. Whether the `.pen` is current or only the PNG is stale could not be
checked — the `.pen` was not opened this session.

**Correction.** Re-export, and put the version in one place on the canvas so the header, the note
and the filename cannot disagree. If the `.pen` is also behind, that is a re-vendor, not a
re-export.

### D34 · `drift` · The Playground artboard draws a card the CSS stretches

```html
<!-- playground.html:8 — no items-start, so grid items stretch -->
<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
```

CSS grid defaults to `align-items: stretch`. In the shipped app the Response card is therefore
**the same height as the form card** — roughly 750 px — holding about 200 px of content. The export
draws it at content height, with the emptiness *beside* it as page background.

Both read as "too much space" and they are different defects. The real one is a
`bg-surface-container` panel with ~550 px of empty card below a two-line answer and a `show raw
response` link. The drawn one is not what ships.

The same card also holds the least legible text in the product — `catalogNotes` at
`text-outline/50`, 10 px ([`playground.html:51`](../src/admin/views/pages/playground.html#L51)),
**2.3 : 1**. That is the provenance line whose own code comment argues it must not go quiet (D16),
rendered at half the contrast the README promises. Measured numbers are in **B6**.

**Correction.** Re-mirror the card at the stretched height. Then the design question is a real one:
give the panel a floor (`min-h`, and the `<pre>` growing to fill) or let it hug its content with
`items-start`. Either is defensible; drawing neither is not.

### D35 · `vice` · Fifteen type sizes, three spellings of one step

Across `src/admin/views/`, text sizes only (icon glyph sizes excluded):

| Size | Uses | | Size | Uses |
|---|---|---|---|---|
| `text-[10px]` | **119** | | `text-lg` | 8 |
| `text-xs` | 61 | | `text-xl` | 9 |
| `text-sm` | 39 | | `text-2xl` | 9 |
| `text-[11px]` | 12 | | `text-4xl` | 2 |
| `text-[0.7rem]` | 9 | | `text-base` | 1 |
| `text-[0.6875rem]` | 2 | | `text-[9px]` | 1 |

`text-[11px]` and `text-[0.6875rem]` are **the same size written two ways**. `text-[0.7rem]` is
11.2 px — a third spelling that differs by 0.2 px, which is a rounding artifact, not a step. Three
notations, 23 elements, one intended size.

The kit has **no type scale at all**. `ui-kit.lib.pen` at 0.2.0 carries 20 colours, 3 font families,
2 radius steps and 5 canvas constants — and zero sizes. Colour is tokenised so thoroughly that *a
test fails on any retyped hex* (D19); type is not tokenised at all, and type is where the drift is.

**Correction.** Name the scale in `tailwind.config` — six or seven steps is enough for 119 + 61 + 39
uses — and put it in the kit. Collapse the three 11 px spellings to one. This is the same class of
work D19 did for colour, and the same test can pin it.

### D36 · `drift` · `Last 7d` over eighteen hours of data

The file states the rule in a comment, and breaks it thirty lines below:

```js
// src/admin/stats.js:47-48
// Burn rate divides by the time actually observed. Dividing by the retention limit would report a
// quiet month for a service that has been running two hours.
```
```js
// src/db/stats.js:74 — divides by the nominal window, not the observed one
cost_per_hour: Math.round((row.cost_usd / hours) * 10000) / 10000,
```

The drawn Overview is the comment's own example. Its header reads `107 requests over 18 h`; the
`Last 7d` card reads `$0.02/hr` from the **same 107 requests**, because $3.9107 was divided by 168
hours of which 150 never happened. The honest figure is $0.2173/hr — a **9.3×** understatement. The
`Last 5h` card, whose window the data does fill, reads `$0.31/hr`.

Logs was fixed for exactly this, and the fix is in the Log frame:

> *"Mirrored after the Logs panels stopped claiming 'Last 60m' and 'Today' for a figure that covers
> the whole retained window."* — `flows/admin.pen`, Log

So the product's two aggregate surfaces now use **opposite denominator policies**, and
`burnVerdict()` ([`overview.js:301-310`](../src/admin/public/js/overview.js#L301)) divides one by
the other. The mechanism is correctness and is **B5**; the design half is that a card may not name
a window its data does not fill, and one page was taught that and the other was not.

**Second, smaller:** at the drawn numbers `burnVerdict()` returns `"15.5× the weekly pace"` and the
artboard renders no verdict span. Verified on a native-resolution crop — the rate sits flush at the
card's right edge with nothing after it. The Log frame claims otherwise:

> *"the quota window gained a burn verdict read against the week"* — `flows/admin.pen`, Log

The Log and the artboard disagree. Fixing B5 changes which of the two is right, so re-mirror after
the fix, not before.

---

## Pass 2 — what is missing

| # | Tag | Section | Finding |
|---|---|---|---|
| **D37** | `gap` | flow | The fold is not drawn anywhere, on a flow whose last two findings were about the fold |
| **D38** | `gap` | shell | The freshness stamp is 9 px, 3.1 : 1, and 1261 px below the fold on the one auto-refreshing page |
| **D39** | `gap` | kit | 20 colour tokens, 0 spacing tokens — which is why D32 happened |
| **D40** | `gap` | logs | The aggregate sits under 25 rows of table, inverted from the same fact on Overview |
| **D41** | `lift` | overview | `84.6% ok` twice on one page, from the same expression, and never with a verdict |
| **D42** | `lift` | kit | The card is the product's most repeated object and is not a component |

### D37 · `gap` · The fold is not drawn

`README.md` declares it: *"Base frame: 1440×900 (desktop web)."* The five frames, from the 2×
exports:

| Screen | Frame | vs 900 |
|---|---|---|
| Overview | 1440 × **2201** | +145 % |
| System | 1440 × 800 | −11 % |
| Request Logs | 1440 × 701 | −22 % |
| Playground | 1440 × 695 | −23 % |
| API Keys | 1440 × 600 | −33 % |

**Zero of five are 900.** Full-page frames are the right choice for mirroring — a viewport-cropped
artboard hides half a screen. But nothing on the canvas marks where 900 falls, so the flow that D8
and D13 were *about* cannot represent the thing they were about, and the inversion in **The
verdict** above was invisible until it was measured off the PNG.

It also means the five screens vary 3.7× in height with nothing saying so. Read left to right as a
band, Overview is a wall and API Keys is a strip, and the band gives no sense that four of them fit
on one screen and one does not.

**Correction.** One `grid-fold-y = 900` constant beside the five existing `grid-*` variables, drawn
as a hairline across every screen frame at y = 900. Cheap, computed like the rest of the grid, and
it makes "what does the operator see first" answerable on the canvas instead of with a cropping
script.

### D38 · `gap` · The freshness stamp is the least visible thing on the page

`Read 07:14:52` — D12's fix, the line that makes a silently-failed refresh legible — lives in the
page footer ([`index.html:165-166`](../src/admin/views/index.html#L165)) at `text-[9px]
text-outline/60`. The footer is in normal flow after `<main class="flex-1">`, not sticky.

| | |
|---|---|
| Size | 9 px — the only `text-[9px]` in the admin |
| Contrast | **3.1 : 1** on `--surface` (**B6**) |
| Position on Overview | footer top at y 2161 — **1261 px below the fold** |
| Position on the other four | on screen without scrolling |

The Overview is the **only** page that auto-refreshes (`setInterval(… , 30000)`,
[`overview.js:71`](../src/admin/public/js/overview.js#L71)) and the only page where you cannot see
how fresh the numbers are without scrolling past everything.

The degraded banner does carry `last read` at the top
([`index.html:144-145`](../src/admin/views/index.html#L144)), and the Log frame records the
reasoning that put it there:

> *"'last read' had been put in the sidebar, where it does not live — it belongs to the degraded
> banner in main, which is conditional and not drawn."* — `flows/admin.pen`, Log

That is right for the **failed** read. It leaves the **healthy** read — the normal case, every 30
seconds, all day — with only the 9 px copy. A refresh that succeeded five seconds ago and one that
succeeded forty minutes ago look the same above the fold.

**Correction.** Move the healthy `read hh:mm:ss` into the Overview's existing meta row
([`overview.html:15-23`](../src/admin/views/pages/overview.html#L15)), beside `107 requests over
18 h` — the row that already exists to give the numbers a denominator. The footer copy can stay or
go; it is not what anyone reads.

### D39 · `gap` · No spacing scale in the kit

The kit carries 20 colours, 3 families, 2 radius steps. It carries **no spacing token**, and the
five `grid-*` variables are canvas layout, not UI spacing. So the single most repeated measurement
in the product is unnamed:

| Padding | Uses |
|---|---|
| `p-5` | 19 |
| `p-4` | 4 |
| `p-6` | 2 |
| `p-3` | 1 |

D32 is what that costs. There was nothing to check `p-6` against, so it shipped and survived a
whole-file code audit. The same is true of the section rhythm — `mb-8` between sections, `mb-6`,
`mb-4`, `mb-3` within them — which is consistent in practice and unnamed in principle.

The ≥2× rule from the layout numbers is honoured almost everywhere already (`gap-4` within a card
against `mb-8` between sections is 4×), so this is not a request to change spacing. It is a request
to **name what is already true** before the next page drifts.

**Correction.** Four or five named steps (`space-card`, `space-section`, `space-field`, …) in the
kit and in `tailwind.config`, mirrored from the current values. Same shape as D19's colour work.

### D40 · `gap` · Logs buries the aggregate the Overview promotes

The same fact, two pages, opposite treatment:

| | Overview | Request Logs |
|---|---|---|
| The fact | `84.6% ok` | `15.4%` error rate |
| Polarity | success | failure |
| Position | top of page (D13) and again at the bottom | **below 25 rows of table** |
| Source | `stats.error_rate.success_pct` ([`overview.html:31`](../src/admin/views/pages/overview.html#L31)) | `client_error_pct + server_error_pct` ([`logs.html:233`](../src/admin/views/pages/logs.html#L233)) |

To learn the error rate on the page dedicated to errors, you scroll past the whole table. Then the
number you find is the complement of the one the Overview gave you, computed by a different
expression, framed in the opposite direction.

The tokens card beside it makes the density point separately: `md:col-span-3` with `flex
justify-between` and two children, so `512.9K` and `$3.91` sit at opposite ends of a ~1050 px card
with roughly 500 px of nothing between two numbers that belong together.

**Correction.** Move the two summary cards above the filter row, where the filters' result count
(`107 total logs found`) already lives — one band that says what this filtered set contains, then
the table. Group the tokens card's two figures instead of spreading them. Pick one polarity for the
error rate across both pages; `15.4% err` is the honest one on a page named Request **Logs**.

### D41 · `lift` · The page's headline number never gets a verdict

`stats.error_rate.success_pct + '% ok'` renders **twice on the Overview** from the identical
expression, 288 lines apart, both top-right of a card:
[`:31`](../src/admin/views/pages/overview.html#L31) (Errors) and
[`:319`](../src/admin/views/pages/overview.html#L319) (Traffic). Same string, same weight, same
grey, two screens apart vertically.

Neither says whether 84.6 % is good. The product knows how to do this and does it three times
elsewhere — `lagVerdict()` (`"the CLI, not the queue"`), `burnVerdict()` (`"in line with the
week"`), and the circuit line (`"routing normally — 2 more failures would stop it"`), each reading a
fact the server already had rather than a threshold someone picked. The comment on `burnVerdict`
states the principle:

```js
// overview.js:299-300
// A rate with nothing to compare it against is a number, not a reading.
```

`84.6% ok` is a rate with nothing to compare it against, in the most prominent position on the
dashboard, printed twice.

**The comparison already exists in the payload.** `by_client` carries per-client error counts, and
`error_breakdown` carries the 4xx/5xx split — so the page can say *"84.6 % ok — all 16 failures are
4xx from two clients"* without inventing a threshold. That sentence also resolves **D31**: it makes
the block's own irrelevance legible instead of leaving it to the reader.

A `lift`, not a `gap` — the panels are correct without it. But it is the product's strongest move
and it is used on the circuit and not on the headline.

### D42 · `lift` · The card is not a component

Twenty-four instances of the same object across five screens, every one a hand-written `div` with a
surface class, a padding class, and a title paragraph. The README already names the sidebar and the
footer as the first promotion candidates. The card is the third and the one that is actually
drifting: D30 (its title), D32 (its surface and padding), D35 (its title's size), D39 (its padding
step) are four findings about one unbuilt component.

Defining it once — surface, padding step, a title slot at the section-junior level, an optional
right-aligned verdict slot (which seven cards already improvise) — closes all four structurally
instead of page by page, and gives D41's verdict a place to live by default rather than by memory.

Per the README's second rule this is **a note, not a task**: promoting costs manual work across
every consumer and happens when asked.

---

## Bug ledger — continued

Correctness. These do not wait for a kit batch. **B1–B4** are pass 1's.

| # | Where | Bug |
|---|---|---|
| **B5** | `src/db/stats.js:74-75` + `src/admin/stats.js:47-48` | Quota burn rate divides by the nominal window, not the observed one — the exact failure the file's own comment rejects |
| **B6** | `src/admin/views/` ×11 + `index.html:162` | Eleven opacity-dimmed text elements fail WCAG AA, on 9–10 px type, against a README that promises AA |
| **B7** | `src/admin/views/pages/logs.html:233, 251, 255` | Three metric values are `<h2>`, so the Logs heading outline reads "Request Logs / 15.4% / 512.9K / $3.91" |

**B5.** `usageWindow(hours)` computes `cost_usd / hours` and `requests / (hours * 60)` against the
**nominal** window. For `SHELLM_QUOTA_WEEK_HOURS = 168` on a gateway with 18 h of logs, both are
understated ~9.3×. `src/admin/stats.js:47-48` states the rule being broken, and `describeWindow()`
twelve lines below it does the right thing for the page header — so the two figures the Overview
shows side by side are computed under opposite policies.

`burnVerdict()` then divides one by the other and reports `"15.5× the weekly pace"` — an alarm
produced entirely by the denominator gap, on a gateway whose spend is flat.

**The honest denominator is already in the query and thrown away**: `MIN(created_at) AS
first_request_at` ([`db/stats.js:66`](../src/db/stats.js#L66)) is selected, returned in the spread,
and never read. Fix: divide by `min(hours, observed_hours)`, and let the label say `last 18 h` when
the window is not full — which is what the Logs panels already do.

**B6.** Measured against the surface each sits on, sRGB, WCAG 2.1. `--outline` `#849397` itself
passes at **5.2 : 1**; the opacity modifiers are what break it, and they are applied to the smallest
type in the product.

| Class | Size | On | Ratio | AA (4.5:1) |
|---|---|---|---|---|
| `text-outline/50` | 10 px | `--surface-container` | **2.3 : 1** | ✗ |
| `text-outline/60` | 9 px | `--surface` | **3.1 : 1** | ✗ |
| `text-outline/70` | 10 px | `--surface-container` | **3.2 : 1** | ✗ |
| `text-outline` | 10 px | `--surface-container` | 5.2 : 1 | ✓ |

Counted: `/30` ×5, `/40` ×3, `/50` ×2, `/60` ×5, `/70` ×4, plus `text-error/70` ×1. `/30` and `/40`
are on icons and disabled pagination controls, where AA's text rule does not apply and the 3:1
non-text rule does — they are not claimed here. The eleven `/50`, `/60`, `/70` uses on real text
are.

`README.md` says *"AA contrast through tokens"* — and that is true of every token. The guarantee is
written at the token level and the violations are all one level below it, which is why a token audit
(D19, with a test) did not catch them. The two that matter most are the Playground catalog note
(D34) and the footer's `Read` stamp (D38): the two places the product chose to explain itself.

**B7.** `<h2>` is the page-title element on every other screen and is used for three metric values
on Logs. It is also why those values render at 36 px. Fix is `<p>` plus the size class; the visual
change is D32's.

---

## The three questions

**1 · Do the sections have hierarchy between them, or only within each one?**

**Only within.** Between sections there is none, and the mechanism is D30: sections and cards share
one typographic treatment, so the only thing distinguishing a section from a card inside it is
whether the label sits on a `bg-surface-container`. That is a background fact standing in for a
hierarchy fact.

Counted on the Overview: four labels are sections (`Capacity`, `Now`, `Latency`, `Usage`) and eleven
are cards, all at the same 10 px / bold / `tracking-[0.2em]` / `text-outline`. Two of the six
top-level blocks — `Errors` and `Traffic` — have no section label at all; they are card titles doing
a section's job, and `Errors` is the block D13 promoted to first position.

**System is the exception and shows what it would cost to fix.** It uses three eyebrows (`Build`,
`Concurrency`, `Providers`) with nothing competing at the same weight inside its cards, and it is
the one screen where you can tell the level at a glance. It is also, not coincidentally, the screen
whose composition needed no findings in this pass.

**2 · Do the five screens read as one product or as five?**

**As three.** They share a real, specific identity — one sidebar built by one function, one title
treatment with the `_` cursor, one footer, one 255 px sidebar and a symmetric 32 px content gutter
on all five, zero radius everywhere, `font-mono` for every figure. That is genuinely one product and
it is not in question.

Below the shell they split three ways, and the split is the card:

| Group | Screens | Card recipe |
|---|---|---|
| **The system** | Overview, System, Playground | `bg-surface-container p-5` ×19 |
| **The holdout** | Request Logs | `bg-surface-container-low p-6` ×2, plus the nav rail as decoration |
| **No cards at all** | API Keys | a bare `bg-surface-container` table and an inline edit row |

API Keys is not a defect — a page that is one table does not need cards, and it is the cleanest
screen in the set. Logs is: it is the only screen that answers "how do I draw a panel" differently
from the other four, and it is the screen an operator spends the most time on. **D3 fixed the Logs
table and the Logs summary band was not in scope**; that is the whole of the remaining divergence.

Contrasted against each other rather than each against its code, the five also disagree about what
belongs above the fold. Four open with a control or a constant — filters, a create button, a form, a
build card. Only Overview opens with a reading, and it opens with the wrong one (D31).

**3 · Does Errors deserve the top, or did D13 resolve the order without resolving the criterion?**

**The second, and the criterion was already in the file.** Full argument in D31. In short:

- The promotion condition is `errorRows.length > 0`
  ([`overview.html:27`](../src/admin/views/pages/overview.html#L27)).
- The severity criterion is `row.status < 500 ? warn : fail`, 24 lines below
  ([`:51`](../src/admin/views/pages/overview.html#L51)), and the condition does not read it.
- In the drawn state the block leads with four rows of `400 / 401 / 404 / 404` — a load-test key and
  unauthenticated probes — while two of its six columns show `(none)` ×4 and `–` ×4, and the one
  field that would identify the failing model is fetched and discarded.
- 84 px below the fold sits the one sentence in the product that reports a live failure.

D13's *conditional* rendering was right — a clean period costs nothing. The condition it chose is
"any error at all", which on a gateway that correctly rejects unauthenticated traffic is
approximately always. **Promote on severity and the same design becomes correct.**

---

## What I left alone

Considered and deliberately not reported:

- **The terminal thesis** — zero radius, `font-mono` on every figure, `>_ ` in the logo, the `_`
  cursor in each page title. Specific, cheap, would not survive transplant. `keep`, and D30's
  correction does not touch it.
- **`CHART INTERIOR NOT MIRRORED`** on both plot areas, with the real card chrome around them and
  the reason written on the canvas. Refusing to approximate a scatter is the right call and the
  reason it is right is stated in place. `keep` — and it is why 23.4 % of the Overview is not judged
  above.
- **The `CAPACITY` note** — *"Derived from observed usage. Neither CLI reports remaining quota or a
  reset time."* A panel that declares the limit of its own measurement. `keep`. D36 is not an
  argument against it; it is an argument that `Last 7d` should be as honest as this sentence is.
- **The scatter's refusal to average** and the timeline's `tension: 0`, both with the comment saying
  what smoothing invented. `keep`.
- **`queueVerdict()` and the red stall line.** D11 landed and it is the best sentence in the
  product. The finding is where it sits, never that it exists.
- **API Keys having no cards.** One table, one create button, one inline edit row. The right amount
  of structure for what the page is; not reported as divergence.
- **The `v1.5.0 · 6cfefe0 →` deep link** in the Overview header landing on System's `Build` card.
  Deliberate, and the two agree.
- **`logs are kept 30 days`** in the Overview meta row. Retention on a page that is not Logs looks
  misplaced and is not: it explains why the window starts where it does.
- **Cyan carrying six jobs** (brand, nav selection, link, primary action, toggle-on, data series).
  It is a lot for one accent and the product is legible with it; calling it a finding would be taste
  without a failure behind it. The one place it misfires is the nav rail used as decoration, which
  is D32.
- **The mono stand-in (D18) and the login page's palette copy (D20).** Open by decision, not by
  oversight; not re-litigated.
- **Dark-only and desktop-only.** Out of scope per `DECISIONS.md`.
- **A stray rule through the `1` in `ACTIVE 1 / 2`.** Suspected from the downsampled view,
  **disproved** on a native crop — Space Grotesk's flag. Recorded so the next pass does not re-find
  it.
- **Correctness, security and performance** beyond B5–B7. Someone else's review.

---

## Notes for the next `.pen` session

No `.pen` was written this pass, by instruction. What is queued:

| # | Change | File |
|---|---|---|
| D37 | Add `grid-fold-y = 900` and draw a hairline at y 900 on all five screen frames | `flows/admin.pen` |
| D33 | Re-export the kit; put the version string in one place on the canvas | `ui-kit.lib.pen` → `exports/` |
| D33 | Verify whether the `.pen` itself is at 0.1.1 — if so, re-vendor, not re-export | `ui-kit.lib.pen` |
| D34 | Re-mirror the Playground Response card at its **stretched** height | `flows/admin.pen` |
| D36 | Re-mirror the `Last 5h` card **after B5 lands** — the verdict span depends on the fix | `flows/admin.pen` |
| D35 / D39 | Install type and spacing tokens once they are named in the code | `ui-kit.lib.pen`, then re-vendor |
| brief | *States not drawn* needs the stretched Response card and the healthy-read line | `flows/admin.pen` brief |

Order matters in one place: **B5 before the D36 re-mirror**, or the canvas gets re-drawn to match a
number that is about to change.

---

## Disposition

| # | Tag | Disposition |
|---|---|---|
| **D30** | `vice` | **Fix in code now.** One class edit per card title; nothing structural. Highest leverage in the pass. |
| **D31** | `vice` | **Decide, then fix.** The threshold ("any 5xx", or a 4xx rate) is Adrian's call — the mechanism is one condition. |
| **D32** | `vice` | **Fix in code now.** Surface, padding, rail, size. Rides with D30. |
| **D33** | `drift` | **Queued for the `.pen` session.** Blocked only on a session that may write. |
| **D34** | `drift` | **Queued** (re-mirror) + **decide** (floor vs hug). Two halves, different owners. |
| **D35** | `vice` | **Decide the scale, then fix.** Naming the steps is a design call; collapsing the three 11 px spellings is not and can go now. |
| **D36** | `drift` | **Blocked on B5.** Design half lands with the fix. |
| **D37** | `gap` | **Queued for the `.pen` session.** Cheapest item here; one constant. |
| **D38** | `gap` | **Fix in code now.** One line into an existing meta row. |
| **D39** | `gap` | **Decide.** Mirrors current values, so no visual change — but it is a kit batch, done when asked. |
| **D40** | `gap` | **Fix in code now.** A move, not a redesign. |
| **D41** | `lift` | **Decide.** The data is in the payload; the sentence is Adrian's to write. |
| **D42** | `lift` | **Note, not a task** — per `README.md` rule 2. Revisit when three of D30/D32/D35/D39 have landed. |
| **B5** | `bug` | **File it.** Wrong numbers on the dashboard; blocks D36. |
| **B6** | `bug` | **File it.** Eleven text elements below AA; the two that matter are D34's and D38's. |
| **B7** | `bug` | **Fix with D32.** Same lines. |

Suggested order: **B5** · **D30 + D32 + B7** (one commit, one system) · **D38 + D40** · **D31**
(after the threshold call) · the `.pen` batch **D33 + D34 + D37** · **B6** · the kit batch
**D35 + D39** when asked · **D41**, **D42** last.
