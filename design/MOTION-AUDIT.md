# Motion audit — admin dashboard

> **Subject:** the admin running at `http://127.0.0.1:6100`, driven in a real browser
> (Chromium 1440×900 and 390×844), plus `css/custom.css`, `views/index.html`,
> `views/pages/*.html` and `public/js/*.js`.
>
> **Date:** 2026-09-20 · **Driven at** `6da0a56`, **re-checked at** `ed653f5` — every count below
> is identical at both, and the line numbers are the later one's. · **Scope:** motion only. Layout, hierarchy and colour are
> [`DESIGN-AUDIT.md`](DESIGN-AUDIT.md)'s, which closed with motion explicitly **not judged**.
> This pass is the one it deferred.

## Method — what was actually observed

Every timing below was **read from the browser**, not from a class name. The pass logged in,
navigated all five pages, opened and closed the mobile drawer, opened the create-key modal,
toggled a key, expanded a log row, and sent a real request through the Playground against a real
client key — `200`, a real CLI answer, and the queue counter moving `0 → 1 → 0` underneath it.

Two things that a code read cannot produce, and that this pass turns on:

- **Computed styles**, so `transition-colors` is reported as its resolved property list, duration
  and cubic-bezier rather than as a utility name.
- **Frame sampling** during each transition (~25ms intervals) to see the curve's actual shape.
  Sampling carries its own overhead, so a quoted `t=` is wall time and drifts a few ms; the
  *shape* is corroboration, and the timing function is read directly and is exact.

The inventory from `DESIGN-AUDIT.md` was re-counted once against the post-split tree and holds
exactly — `animate-pulse` ×1, `transition-colors` ×20, `transition-all` ×1, `transition-transform`
×1, `x-transition.opacity` ×1, `duration-100` ×15, `duration-150` ×1, `duration-200` ×1,
`duration-300` ×1. It missed one: **`animate-spin` ×1**, on the Logs refresh button added after
the audit was written.

Findings take **D21–D27** and the two bugs **D28–D29**, continuing the shared registry in
[`DECISIONS.md`](DECISIONS.md), which stands at D20 and states that new findings take the next
free number. Bugs are numbered in the same space and marked 🐞, the way `D17` is — the `B1–B4`
ledger in `DESIGN-AUDIT.md` is that document's own and is not extended here.

**One scope note, and it costs this pass two of its findings.** `DECISIONS.md` lists *"a mobile
layout for the dashboard"* under **Out of scope (confirmed)** — it is an operator tool used from a
desktop browser — and `DESIGN-AUDIT.md` deliberately declined to report the mobile sidebar that
exists anyway. **D22** and **D28** are both about that drawer. They are recorded because the pass
found them and hiding a real defect is worse than recording one nobody will fix, but they inherit
that decision: neither is ranked, and both are Adrian's call to reopen or ignore. Nothing else in
this document depends on them.

---

## The question first: vocabulary, or accidents?

**Accidents.** Not a close call, and three measurements settle it.

**No easing is ever chosen.** There is not one `ease-out`, `ease-in`, `ease-linear` or custom
cubic-bezier anywhere in the admin — zero occurrences across every view, script and stylesheet.
What ships is whatever each tool defaults to, and the two tools disagree:

| Where | Computed timing function | Which default |
|---|---|---|
| Every Tailwind `transition-*` utility (23 sites) | `cubic-bezier(0.4, 0, 0.2, 1)` | Tailwind's `ease-in-out` |
| `.toggle-track`, `.toggle-knob` (`custom.css:88, 98`) | `cubic-bezier(0.25, 0.1, 0.25, 1)` | CSS's bare `ease` |

So the product ships **two different easing curves and picked neither.** The toggle is on a
different curve from everything else in the admin because its declaration omits the keyword and
CSS filled it in.

**The durations are not a scale.** `100` fifteen times, then `150`, `200` and `300` once each. The
fifteen are not evidence of a system — they are the four Logs buttons, the five pagination
buttons and the table rows, copy-pasted inside two pages. Every value that appears once was chosen
once, for one element, with nothing to check it against: the drawer got `200` and the bar got `300`
for no reason either can state.

**Two things that a system would have and this has none of:** no `prefers-reduced-motion` anywhere
(D25), and no `:active` press state on any of the 35 hover targets (D26).

The product did make exactly **one** deliberate motion decision, and it made it correctly:
`animation: false` on both Chart.js instances (`overview.js:169, 224`). Left to its defaults
Chart.js redraws over 1000ms, which on a panel that re-reads every 30s would mean a chart
permanently mid-animation. Someone turned that off. It is the only motion decision in the
codebase, and it is a *no* — which is the right instinct for this product.

### What follows from that

The skill's rule applies literally: **do not propose per-screen animation onto a product that has
no vocabulary — propose the vocabulary.** But this is an operator tool, so the vocabulary that
earns its cost here is very small. Three declarations, not a motion system:

```js
// tailwind.config — transitionTimingFunction / transitionDuration
'exit':  'cubic-bezier(0.4, 0, 1, 1)',   // ease-in — leaving
'enter': 'cubic-bezier(0, 0, 0.2, 1)',   // ease-out — arriving, and the default for everything
```

| Token | Value | For |
|---|---|---|
| `fast` | **100ms** | hover, press, focus — already the de-facto value at 15 sites |
| `move` | **200ms** | anything that changes position or size: the drawer, the queue bar |

Two durations and one easing rule — *arriving is `ease-out`, leaving is `ease-in`* — replace four
unrelated numbers and two accidental curves. That is a smaller surface than what ships today, not
a bigger one, which is the only reason it is worth doing at all. Everything in the Before/After
table below is an application of those two tokens.

---

## Pass 1 — motion that exists and is wrong

| # | Where | Finding |
|---|---|---|
| **D21** | overview · queue bar | `transition-all duration-300` — animates a sampled value, and ramps a warning colour |
| **D22** | shell · mobile drawer | The backdrop is gone 100ms before the drawer has left |
| **D23** | all | Every transition is `ease-in-out`, including the ones that open |
| **D24** | keys · toggle | Two hand-written transitions on a curve nothing else in the admin uses |
| **D25** | all | `prefers-reduced-motion` is ignored — verified with the query forced on |
| **D26** | all | 35 hover targets, zero press states |
| **D27** | logs · refresh | `animate-spin` runs while its page is hidden |

### D21 · The queue saturation bar animates a measurement

`views/pages/overview.html:162`. Observed during a live request, sampling the computed width
after a health read returned `active: 1`:

```
t=pre    0px        t=150ms  243.8px  (69%)
t=50ms   11.5px     t=200ms  310.1px  (88%)
t=100ms  107.7px    t=300ms  350.1px  (100% — final 350.656px)
```

Three separate problems in one utility.

**It ramps a value that did not ramp.** The queue went from 0 to 1 instantly, thirty seconds ago
or less; the bar spends 300ms drawing a climb that never happened. The sentence directly beneath
it — `50% of concurrency in use` — snaps to its new value immediately, so for 300ms the number and
the bar disagree about the same fact.

**`transition-all` puts the warning colour on the same ramp.** The bar's class flips between
`bar-brand` and `bg-status-warn` when `pending > 0`. With `all`, that colour change is a 300ms
cross-fade: the one element that turns amber to say the queue is backing up fades amber slowly.
A warning should arrive, not develop.

**300ms is out of budget** for a status readout — that is the modal/drawer tier.

Per the skill, `transition: all` is always a finding regardless of the rest.

### D22 · The drawer and its backdrop disagree on the way out

> **Out of scope** per `DECISIONS.md` — the mobile layout is not a surface this product commits
> to. Recorded, not ranked.

`views/index.html:81` uses Alpine's `x-transition.opacity`, whose defaults are **150ms enter,
75ms leave**. `views/index.html:84` gives the drawer `transition-transform duration-200`. Nothing
reconciles the two. Closing, sampled:

```
t=0      drawer   0px   backdrop opacity 1
t=50ms   drawer  -22px  backdrop opacity 0.82
t=75ms   drawer -117px  backdrop opacity 0.08
t=100ms  drawer -199px  backdrop display:none      ← undimmed, drawer still 22% on screen
t=200ms  drawer -256px
```

The page is fully undimmed while the drawer still has ~125ms of travel left, so the last half of
the exit is a panel sliding across an undimmed page with nothing behind it. This is the
spatial-consistency break the backdrop exists to prevent, and it only shows in motion — the
markup reads as correct.

Entering, the two are accidentally close (backdrop 150ms, drawer 200ms) and it reads fine.

### D23 · Everything opens on `ease-in-out`

Read from the browser: **every** Tailwind transition in the admin computes to
`cubic-bezier(0.4, 0, 0.2, 1)`. That curve starts slow, which is what you want on an exit and
wrong on anything responding to a tap. The drawer, sampled opening:

```
t=25ms  moved 4.4px of 256   (1.7%)
t=50ms  moved 60px           (24%)
t=75ms  moved 165px          (65%)
```

The first ~40ms of a touch drawer is spent almost stationary. `ease-out` puts the movement where
the finger is.

### D24 · The toggle is on a curve nothing else uses

`custom.css:88` and `:98` declare `transition: background-color 150ms` and
`transition: transform 150ms` with no timing function, so both resolve to CSS's bare `ease`
(`cubic-bezier(0.25, 0.1, 0.25, 1)`) — measured on a real toggle click. Every Tailwind transition
in the same interface is on `cubic-bezier(0.4, 0, 0.2, 1)`. Nobody will name the difference, and
that is the point: it is drift, not a choice, in the only two hand-written transitions the
product has.

The 150ms itself is correct for a switch, and the knob's `transform` is the right property.

### D25 · `prefers-reduced-motion` is ignored

Not inferred from a missing grep — **verified in a browser with the query forced on**:

```
matchMedia('(prefers-reduced-motion: reduce)').matches → true
health dot     animation: pulse 2s          (still running)
drawer         transition-duration: 0.2s    (unchanged)
queue bar      transition-duration: 0.3s    (unchanged)
```

The skill treats this as a **requirement, not polish**, and it needs a complete static state
rather than a faster animation. One block covers everything the admin has:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

With one deliberate exception worth arguing about: the health dot's pulse is the only indicator
that the page is live. Under reduced motion it should become a **solid** dot, not a stopped one
mid-fade — the blanket rule above freezes it at whatever opacity the last frame had, which can be
the dim end. Give `.animate-pulse` its own `opacity: 1; animation: none` inside that block.

### D26 · 35 hover targets, zero press states

`:active` appears nowhere in the admin. Every interactive element gets a colour transition on
hover and then nothing at all on press — including `clear logs`, which is destructive, and
`Send`, which spends real subscription quota.

This is the cheapest feedback in the skill's table (100–160ms, purpose: *feedback*) and the one
place where an operator tool wants it as much as a consumer app does: the click either registered
or it did not, and on a dashboard where the result takes seconds to arrive, the press is the only
immediate confirmation available. Note this is **not** a proposal to add a scale transform — on
a square, zero-radius brutalist interface a 60ms background-colour step is more in character and
cannot shift a target.

### D27 · The Logs spinner runs on a hidden page

All five pages live in the DOM simultaneously behind `x-show`. On first load, the Logs page's
refresh icon carries `animate-spin` while `loading` is true, and the computed animation is running
(`spin 1s linear`) inside a `display: none` subtree — observed on the Overview, before Logs had
ever been opened.

Nothing is painted, so the cost is negligible and this is the smallest finding here. It is worth
one line only because it is a symptom of the same shape as **B2** in the design audit: a state
flag driving an animation without anyone asking whether the thing is on screen.

### The Before / After table

| Before | After | Why |
| --- | --- | --- |
| `transition-all duration-300` on the queue bar | `transition: width 200ms cubic-bezier(0, 0, 0.2, 1)` | Names the property, so the warn colour snaps instead of fading in over 300ms; `all` was also animating background-color by accident |
| Backdrop on Alpine's default 75ms leave | `x-transition:leave.opacity.duration.200ms` | The dimming currently lifts 100ms before the drawer is gone |
| `transition-transform duration-200` (ease-in-out) on the drawer | same duration, `cubic-bezier(0, 0, 0.2, 1)` entering / `cubic-bezier(0.4, 0, 1, 1)` leaving | The drawer moves 1.7% in its first 25ms; a panel answering a tap must start at speed |
| `transition: background-color 150ms` (`custom.css:88, 98`) | `transition: background-color 150ms cubic-bezier(0, 0, 0.2, 1)` | Currently resolves to bare `ease` — the only element in the admin on that curve |
| No `@media (prefers-reduced-motion)` | The block in D25, with `.animate-pulse` pinned to `opacity: 1` | A requirement, and the pulse must end solid rather than frozen dim |
| No `:active` anywhere | `:active { background-color: <one step darker>; }`, ~60ms | A destructive button and a quota-spending button both confirm nothing on press |
| `duration-100` ×15, `150`, `200`, `300` | two tokens: `fast` 100ms, `move` 200ms | Four values chosen once each, with nothing to check them against |

---

## Pass 2 — motion that does not exist

One proposal survives the gate. It is listed with all four answers, as are the rejections.

### P1 · The Playground has no sign the CLI is alive — **accept**

The only genuine addition in this audit, and it is the product's defining moment: a request is a
CLI subprocess, `TIMEOUT_MS` is 120000, and a measured cold spawn is 3–4s. Observed during a real
request, the entire visual state of the screen for the whole wait:

- the button text changes `Send` → `Sending…`
- the button drops to `opacity: 0.4` (`disabled:opacity-40`)
- the response panel reads `Waiting for the CLI…` (and, since `ed653f5`, a `stop waiting` link)
- **nothing on the screen moves**, except the health dot in the sidebar, which pulses identically
  whether or not a request is running

A dimmed button and a static sentence are also exactly what a *hung* request looks like, and what
a *finished-but-not-rendered* request looks like. For up to two minutes.

> **Overtaken in part, and re-checked at `ed653f5`.** `D11` landed while this pass was being
> written and it took the harder half: `send()` now runs behind an `AbortController` and the
> waiting state carries a **stop waiting** control
> ([`views/pages/playground.html:74-77`](../src/admin/views/pages/playground.html#L74)), so a hung
> request is no longer a reload. The Overview queue panel gained per-job ages in the same commit.
> **What it did not give the Playground is a clock.** `performance.now()` is read at
> [`playground.js:104`](../src/admin/public/js/playground.js#L104) and again on arrival, so the
> elapsed time exists only *after* the response lands, as `round trip`. During the wait the screen
> still says one static sentence. The finding below stands, narrowed to that.

| Gate | Answer |
|---|---|
| **1 · Frequency** | Occasional. The Playground is a tool reached for deliberately, a handful of times a session — not core navigation. **Eligible.** |
| **2 · Purpose** | **feedback** — the interface heard you and is still working. This is the one screen where the gap between input and response is measured in seconds. |
| **3 · Speed** | Indeterminate, so the budget applies to its period, not a one-shot duration: `1s linear`, matching the `animate-spin` the Logs refresh already uses. |
| **4 · Function** | Nothing is being read during the wait — the response panel is empty by definition. Motion here disturbs no data, which is why this passes where almost nothing else does. |

**But the better answer is still not an animation.** A ticking counter beside the sentence —
`Waiting for the CLI… 4.2s` — beats a spinner on every axis that matters here: it proves liveness,
it distinguishes a normal call from a wedged one, and at 90s against a 120s `TIMEOUT_MS` it tells
the operator what is about to happen. A spinner says only "not frozen". The Overview already got
exactly this treatment for queued jobs in `ed653f5`; the Playground is the one place the same
idea was not applied, and `started` is already sitting in `send()` for it.

**Recommendation: tick the counter the Playground already has the start time for.** The spinner
is optional decoration once it exists — and if it is wanted, reuse `animate-spin` at `text-base`
beside the counter rather than introducing a second idiom.

### P2 · The create-key modal appears instantly — **reject**

Measured: `.modal-overlay` goes `display: none` → `flex` with `transition-duration: 0s` and no
animation. The modal simply exists on the next frame.

| Gate | Answer |
|---|---|
| **1 · Frequency** | Occasional. **Eligible** — this one clears the frequency bar. |
| **2 · Purpose** | *preventing a jarring change* is arguable. |
| **3 · Speed** | 150ms opacity + `scale(0.98)` would be well inside budget. |
| **4 · Function** | Passes — it covers the page rather than moving it. |

It clears the gate on all four and is still a **reject**, on a ground the gate does not cover: the
product's design language is deliberately hard-edged — radius abolished at every scale in the
Tailwind config, a square toggle with a comment saying why, a terminal cursor in the page titles.
An instant modal is *in character*. Adding a fade would be the first decision in the admin taken
because it is conventional rather than because it fits, and the cost of not doing it is zero.

**Cost if rejected:** nothing measurable. Revisit only if the modal ever animates *out*, since a
mismatched in/out is worse than neither.

### Rejected — named, with the gate answer that killed each

| Candidate | Gate that rejects it |
|---|---|
| **Page transitions** between the five pages | **1.** An operator switches Overview↔Logs constantly, and the swap is already instant (measured: rendered within 60ms of the click, no reflow). *"Reject. Always."* |
| **Count-up on the Overview metrics** (`$3.8590`, `74,615`, `187`) | **4.** These are the numbers the page exists to report. Animating them means that for ~1s after every 30s poll the screen shows values that are not true — on the one tool whose job is diagnosis. This is the worst idea available here. |
| **Chart draw-in** on the timeline and scatter | **4**, and it is already correctly off (`animation: false`, `overview.js:169, 224`). A 1000ms redraw every 30s would leave the panel permanently mid-animation. Do not "improve" this. |
| **Row expand/collapse in Logs** | **4.** Measured instant: `+129px`, identical at 25ms and 425ms, and no row moved under the cursor. The operator is reading a log body; animating its arrival delays the read for style. |
| **Skeleton loaders while fetching** | **4**, plus it actively fights `D9`. A shimmering skeleton is a moving claim that data is coming — the exact lie the design audit's central finding is about. A still `—` is honest; a skeleton is not. |
| **Sidebar nav hover** beyond what exists | **1.** Tens of times a day. The existing 150ms colour change is already at the ceiling for this tier. |
| **Toast/slide-in for key creation** | **1** and **2.** The result already renders in place (`views/pages/keys.html:9`), which is better than a toast — it does not time out and it does not move. |
| **Health-dot pulse changes** | Leave it. One `animate-pulse` at 2s, on a 6px dot, in the sidebar's bottom corner, whose job is exactly *state indication*. It is the one ambient animation the product should have. Note `B2` — the state feeding it — was fixed after the design audit; the dot now goes solid `status-fail` when `healthRead === 'failed'` (`views/index.html:113`), so the trap that audit flagged no longer exists. |

---

## Bugs — for the registry's 🐞 section

Found while interacting. Neither is a motion defect; both were only visible because the pass drove
the interface rather than reading it.

| # | Where | Bug |
|---|---|---|
| **D28** 🐞 | `views/index.html:72-84` | The open mobile drawer covers its own close button — **but see the scope note** |
| **D29** 🐞 | `public/js/app.js:215-219` | Page navigation never resets scroll |

**D28** — **out of scope** for the same reason as D22; recorded so it is not re-found.
The mobile top bar is `z-40`; the drawer is `z-50` and 256px wide, so at 390px it covers
the toggle at `x: 16–36`. Verified: `document.elementFromPoint()` at the toggle's own centre
returns the drawer's `<img>` logo, and a synthetic click on the button is intercepted. The button
is still there, still focusable, still swaps its icon to `close`, and `aria-expanded` correctly
reads `true` — it just cannot be reached by a finger. The only way to close the drawer is tapping
the backdrop, which is undiscoverable and not exposed to a keyboard or screen-reader user at all.
Either raise the top bar above the drawer, or put a close control inside the drawer.

**D29** — `navigate()` sets `page`, closes the sidebar and writes the hash. It never scrolls.
Verified: scroll the Logs page to `y=600`, switch to System, and you land at `y=19` — not the top,
just wherever the shorter document clamps to. Between two long pages you land mid-content with no
indication you are not at the top.

**The fix is `window.scrollTo(0, 0)`, instantly — never `behavior: 'smooth'`.** Smooth scrolling
here would fail gate **1** (every navigation, all day) and gate **4** (it delays the first read of
a page the operator opened to read). Recording it in a motion audit specifically so the obvious
wrong fix is ruled out in writing.

---

## What I left alone

- **`animation: false` on both charts.** The only deliberate motion decision in the codebase, and
  it is correct. Flagged against future "improvement".
- **The health dot's 2s pulse.** Right element, right purpose, right tier.
- **`animate-spin` on the Logs refresh button.** Correct: `1s linear`, indeterminate, only while
  `loading`. It is also the closest thing the product has to a reusable motion component, which
  is why P1 should reuse it rather than introduce a second idiom. (Its hidden-page behaviour is
  D27.)
- **The instant page swap** and the instant log-row expand. Both measured, both correct.
- **`duration-100` on the 15 `transition-colors` sites.** Inside budget, and the value the
  proposed `fast` token would standardise on anyway. Nothing to fix; only to name.
- **The 150ms toggle timing.** Correct duration, correct property — only the missing easing
  keyword is a finding (D24).
- **Layout, hierarchy, colour, copy, correctness.** `DESIGN-AUDIT.md`'s, and not re-litigated.

---

## Suggested order

1. **D25** — `prefers-reduced-motion`. One CSS block, it is a requirement rather than a preference,
   and it is the only item here with an accessibility argument behind it.
2. **D21** — the queue bar. One class; removes the product's only `transition: all` and stops a
   warning colour from fading in.
3. **The two tokens + the easing rule** — then D23 and D24 are each a one-line application of them
   rather than two independent judgement calls.
4. **D26** — press states, once `fast` exists to declare them against.
5. **P1** — and as D11's elapsed counter first, not as a spinner.
6. **D29** and **D27** — one line each, whenever.

**D22 and D28 are deliberately absent from this list.** Both are mobile, which
`DECISIONS.md` marks out of scope. If that ever reopens, D28 goes first — a drawer that cannot
be closed is worse than a drawer that closes unevenly.
