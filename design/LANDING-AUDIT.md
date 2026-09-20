# Landing page audit — `site/index.html`

> **Subject:** the page deployed at <https://rodacato.github.io/SheLLM/>, its source
> [`site/index.html`](../site/index.html) (284 lines, zero JavaScript), the build that assembles it
> in [`.github/workflows/pages.yml`](../.github/workflows/pages.yml), and the 19 PNGs in
> [`design/exports/`](exports/). Compared against the page it replaced —
> `git show 6925878:site/index.html`, 417 lines, deleted in `7cc9c45` and rebuilt in `b8e1e9e`.
>
> **Date:** 2026-09-20 · **Verified at** `0a1f28e` (v1.6.1). `site/` is byte-identical on `master`
> and on `design/admin-error-band`, and the deployed page was fetched to confirm it matches the
> repo. · **Scope:** the public landing page only.
>
> **Why now:** the maintainer prefers the page that was removed — *"menos texto pero más
> importante y más visual, con más screenshots"* — and asked for brand and positioning advice
> without losing the sense that the site is alive.

The admin dashboard is [`DESIGN-AUDIT.md`](DESIGN-AUDIT.md)'s and [`MOTION-AUDIT.md`](MOTION-AUDIT.md)'s.
Neither of them looked at `site/`; this is the first pass over the public surface.

Findings continue the shared ledger in [`DECISIONS.md`](DECISIONS.md), which ends at **D49**, so
this one starts at **D50**. Nothing here is implemented — this document is the analysis the
maintainer asked for before any change.

## Method

- The source was read, not inferred. Word counts come from parsing the rendered body of
  `site/index.html` and stripping tags; motion was counted from the `@keyframes` rules and the
  absence of any `<script>` element.
- The deployed page was fetched and its section order confirmed against the repo. What ships is
  what is in `site/`.
- The removed page was recovered from git and read in full, rather than remembered.
- Every export in `design/exports/` was measured for weight and pixel size; three were opened.

---

## What is on the page today — measured

| # | Section | Words | Visual |
|---|---|---|---|
| — | Hero | 15 | logo SVG, animated CRT backdrop |
| 1 | What it is | 60 | — |
| 2 | What it is not | 74 | — |
| 3 | What you'd build with it | 233 | a flow diagram built from `<div>`s |
| 4 | Get started | 56 | a `<pre>` block |
| 5 | The dashboard | 31 | **one screenshot** |
| 6 | Fair use and provider terms | 119 | a 3-row table |
| | **Total body** | **573** | **1 photograph of the product** |

**Motion:** four `@keyframes` — `drift`, `breathe`, `sweep`, `blink` — and every one of them is
scoped to `<header>` or to the fixed scan-line overlay. There is no `<script>` tag. Below the hero
the page does not move.

---

## Findings

### D50 — The landing page is the README with a stylesheet on it

This is the finding the other nine are downstream of.

Four of the six sections are the README's prose, in the README's order, and two of them are
**verbatim**:

| Page section | `README.md` | Relationship |
|---|---|---|
| What it is not | L28–35 | all four bullets identical, word for word |
| What you'd build with it | L61–66 | opening paragraph identical, word for word |
| Fair use and provider terms | L40–52 | trimmed copy, same provider table |
| The dashboard | L133–140 | same screenshot, near-identical alt text |

The section headings match the README's headings almost one to one. A landing page and a README
have different jobs — the README is read by someone who already decided to look, the page is read
by someone deciding whether to. Writing one from the other produces a document that renders in a
browser, and that is exactly what is deployed.

It also means the page inherits documentation register: complete, qualified, ordered by
correctness rather than by what makes someone lean in.

### D51 — 573 words of prose against one image

The ratio is the complaint, stated numerically. Sections 1, 2 and 6 carry no visual at all;
section 3 carries 233 words — 41% of the page — and the only thing it shows is a diagram of
labelled boxes drawn in CSS.

### D52 — Everything below the fold is motionless

The page it replaced ran an `IntersectionObserver` that faded sections up as they entered the
viewport, staggered 100 ms within groups (`old:L399–414`). That is gone, along with all JavaScript.
What survives is ambient hero motion that plays whether or not anyone is there.

Ambient motion says *the machine is on*. Reveal motion says *you are moving through something*.
The second one is what "se siente vivo" describes, and it is the one that was deleted.

### D53 — The second thing a visitor reads is four things the product is not

Section order is: what it is (60 words) → **what it is not** (74 words) → what you'd build. A
reader who has spent eleven seconds on the page has been told more about what they cannot do than
about what they can.

The section is not wrong and it should not be removed — see D59 and the panel below. It is
misplaced.

### D54 — The page has no scannable structure

`section h2` renders at `.75rem`, uppercase, `letter-spacing:.18em`, in `--muted` (#849397) on
#101417 — a 12px grey label. Deliberately recessive, and the consequence is that a skimmer's eye
finds no anchors: the page is six undifferentiated paragraphs of body text at one size. There is
no second typographic level between the hero wordmark and 16px Inter.

### D55 — No navigation

There is no nav. Once you scroll past the hero, the only links are the two in the footer. The
removed page had a sticky bar with API Docs, Providers, Versions, Contributing and a GitHub
button — five ways out, always reachable.

### D56 — Eighteen of nineteen exports are unused, and the build only knows about one

`pages.yml:42` copies exactly one file:

```
cp design/exports/admin-request-logs-default.png site/img/request-logs.png
```

`master` carries eight real product screenshots — overview, request logs, API keys, playground,
system, sign-in, plus the two brief canvases and the UI-kit sheet. The branch in flight adds nine
more, mostly error and empty states. The single most persuasive asset in the repo,
`admin-overview-default.png` — cost per hour, tokens, p50/p95/p99, per-client attribution, a
traffic chart — has never appeared on the site.

### D57 — The exports cannot be shipped as they are

Three separate blockers, all mechanical:

- **`admin-overview-default.png` has a design marker burned into the pixels** — a cyan
  `FOLD · 1440×900` label with a rule across the image, at roughly y=1780 of 4374. It is a
  reviewing aid. It cannot go on a public page.
- **Aspect ratio.** The overview is 2880×4374 and the usage-limit variant 2880×4522 — a 1:1.5
  portrait strip. Dropped into a 64rem column it renders as a thin vertical ribbon. Landing pages
  need above-the-fold crops, not whole-page captures.
- **`admin-brief-*.png` and `admin-log.png` are not screenshots.** They are 1280px-wide Pencil
  canvas exports, 2868–4068px tall, 0.9–1.7 MB. They are design briefs and belong in `design/`.

The four 2880×~1400 captures — request logs, playground, API keys, system — are usable roughly as
they are, at 150–210 KB each.

### D58 — The one screenshot that does ship leads with a 15.4% error rate

`admin-request-logs-default.png` shows `ERROR RATE 15.4%` beside a sparkline with two red bars, and
three of the four visible rows are a `401 auth_required` and two `404`s. Those came from the
maintainer's own auth tests on a dev box.

This is not an argument for faking it. It is an argument that the capture state is a design
decision nobody made: what a visitor reads is "one request in six fails", which is *less* accurate
about normal operation than a representative capture would be. Honesty is served by a real run
that is typical, not by whichever run happened to be in the database.

### D59 — `design/README.md` says this surface does not exist

[`design/README.md:62–63`](README.md#L62):

> *"There is no public flow: the landing page and the hosted API reference were removed, so
> `site/` and `docs/index.html` do not exist."*

`site/` exists, is deployed on every push to `master`, and is the subject of this document. The
design method doc governs design work in this repo per [`AGENTS.md`](../AGENTS.md), so it being
wrong about its own scope is load-bearing, not cosmetic. Whatever is decided about the page, that
paragraph needs rewriting in the same change.

---

## The page that was removed — what it actually did

Worth being precise, because the instinct to bring it back is half right and half nostalgia.

**What it did better, and what the current page lost with it:**

- A sticky nav with five destinations (D55).
- A hero at `text-8xl` — a genuine typographic scale, where the current page has one level (D54).
- Scroll-reveal with stagger (D52).
- **A four-card grid.** Cards gave the page a rhythm — image, grid, terminal, table — instead of
  six stacked prose blocks. The cards hover-glowed, which is small and effective.
- **Terminal chrome on the code block**: traffic lights, `$` prompts in accent, comments dimmed. It
  read as a product screenshot rather than as a fenced code block.
- **A comparison table** against LiteLLM, OpenRouter and Portkey — instant positioning, understood
  in three seconds without a sentence of prose.
- Roughly half the prose weight of the current page.

**What it did worse, and must not come back:**

- **It is factually wrong now.** It advertises a Gemini CLI card and a Cerebras card, neither of
  which exists; "Claude Max, Gemini AI Plus, OpenAI Enterprise"; `bash scripts/setup/dev.sh` and
  `npm run check:env`, neither of which is the install path. Gemini being dropped is a decision on
  the record, and the old page contradicts it on screen.
- **The copy is exactly the register the maintainer rejects.** *"Extreme throughput for large-scale
  inference tasks."* *"Start your gateway in seconds. SheLLM handles the routing, you handle the
  queries."* *"Seamless integration with Google's command line suite."* That is generated-marketing
  voice, and the current page's honesty is the correction to it — a correction worth keeping.
- **It had no screenshots either.** The thing being asked for was not in the old page. It is newly
  possible because `design/exports/` now exists.
- Tailwind from a CDN — a third-party runtime dependency and a flash of unstyled content, against a
  repo whose stated convention is no build step and no framework.

**So the honest reading of the request:** it is not *bring back the old page*. It is *the old
page's form — rhythm, motion, image over prose — carrying the current page's honesty, plus the
screenshots that did not exist when either was written.*

---

## Panel

Consulted per [`EXPERTS.md`](../docs/EXPERTS.md). **One voice below is not on the panel.**

> **Proposal — a new situational seat, `S8` · brand and positioning for developer tools.** The
> maintainer asked for marketing and branding advice and there is no seat that holds it. C8
> `priya` owns developer experience and public docs, which is adjacent and not the same lens: she
> judges whether a stranger can succeed, not whether a stranger stops. S5 `sofia` is scoped to the
> admin and the design system. S8 is voiced below as a candidate; adding it to `EXPERTS.md` is the
> maintainer's call, and nothing here depends on the seat being permanent.

**S8 · brand and positioning (candidate) —** The page loses on its first screen. A hero that says
"Your LLM subscription — as a REST API for your own apps" is a *category* statement; the visitor
still has to construct the product in their head. Show it instead: the Overview panel, with
`$0.3096/hr` and `p50 1.4s` legible, does more positioning work than the 573 words under it. My
concern is the opposite failure — this is a tool with a real ban-risk story, and a page that sells
harder than the product warrants attracts exactly the readers it says it does not want.

**C8 `priya` · developer experience —** D50 is the one I would fix first, and not by rewriting the
page. Two surfaces that say the same words in the same order means one of them is unnecessary;
decide which sentence lives where. The page should answer *"is this for me"* in one screen and
hand off to the README for *"how"*. Today `Get started` on the page and `Getting started` in the
README are the same four commands, so the page is carrying weight it does not need to.

**C9 `el-integrador` · the actual user —** I arrive from a link at 11 PM. I want to know in ten
seconds whether I can point the OpenAI SDK at this and go. The two export lines in `Get started`
are the most valuable thing on the page and they are four sections down, below 367 words. Put the
base URL and the key swap where I can see them without scrolling, and put the dashboard picture
next to them so I know what I get for the trouble.

**C5 `helena` · provider terms and ban risk —** `Fair use and provider terms` stays on the page,
and it stays as plain a statement as it is now. It is not a disclaimer; it is the reason the
project is defensible. I will accept it moving later in the order — I will not accept it becoming
a badge, a footnote, or three words in a footer. The Gemini row in particular is a decision on the
record and the page is where it is visible.

**C6 `dhh` · pragmatic simplicity —** I would take the reveal animation. Fifteen lines of
`IntersectionObserver` and a class toggle, no dependency, no build — that is a fair price for the
thing he is actually missing. What I would not take back is Tailwind from a CDN to get it. And
before adding a single section, delete one: the page gets better by losing 250 words faster than
by gaining anything.

**Conflict to surface:** S8 wants the page to persuade; [`AUDIENCE.md`](../docs/AUDIENCE.md) lists
❌ *"The general public arriving via Google. No funnel, no SEO, no hosted version."* as an explicit
non-user. These are reconcilable but only if the distinction is named and held, and it is the one
decision this audit cannot make for the maintainer:

> The landing page's job is **qualification, not acquisition**. It exists so that a self-hoster
> arriving from a GitHub link decides correctly, and quickly, whether this is for them — which is
> why `What it is not` belongs on it at all. Craft in service of that is welcome. Anything whose
> purpose is to increase the number of arrivals — SEO copy, a newsletter, social proof, a
> comparison table written to win — is out of scope by the project's own audience doc.

---

## Recommendation

One option, as the panel protocol requires. **Rebuild the page around the screenshots, cut the
prose by half, and restore reveal motion — in hand-written CSS and ~15 lines of JavaScript, with
no framework and no build step.**

Proposed order, each section earning its place with an image or a number rather than a paragraph:

1. **Hero** — keep the CRT backdrop exactly as it is. Add the two `export` lines under the
   buttons: the product's whole promise is that they are all you change (C9).
2. **The product, one image** — `admin-overview-default.png`, cropped above the fold, full width.
   No section heading. This is the page's argument.
3. **What it is** — two sentences, ≤40 words. Everything else moves to the README.
4. **Three panels, each anchored by a screenshot** — request logs and cost · playground · provider
   health. ≤35 words each. This replaces the 233-word section 3 and the `<div>` flow diagram.
5. **Get started** — the terminal chrome from the old page, keeping the current page's accurate
   commands.
6. **What it is not** — the same four statements, compressed into a dense grid. Moved here, where
   a reader who is still going deserves the honest disqualification (D53, `helena`).
7. **Fair use and provider terms** — unchanged (`helena`).

Plus a sticky nav (D55), and a real second typographic level so the page can be skimmed (D54).

**Rough target:** ≤300 body words, ≥5 screenshots, motion below the fold.

**Key risks:**

- *Weight.* Five 2880px screenshots is 0.9–1.5 MB. Needs `loading="lazy"`, explicit dimensions to
  stop layout shift, and either crops or a 1440px variant alongside. This is the main thing that
  can make the new page worse than the current one.
- *Screenshot pipeline.* D57 is the real work item. `pages.yml` copies one hardcoded file; it needs
  a set, and the exports need above-fold crops produced deliberately rather than reused. Decide
  whether crops are committed or generated in the build before writing the page.
- *Drift.* Screenshots go stale silently. Five of them is five things that can quietly start
  showing a version of the admin that no longer exists.
- *Slop.* Every sentence cut is a chance to replace it with the register the old page had. The
  current page's voice is the thing worth protecting.

**Fallback:** the change is one file plus a workflow step, on its own branch, revertible in one
commit. If the rebuilt page does not read better than what is deployed, `git revert` is the whole
rollback and nothing else in the repo depends on it.

## What this audit does not do

- It does not judge the admin dashboard. That is `DESIGN-AUDIT.md` and `MOTION-AUDIT.md`.
- It does not specify motion in exact durations and curves. If the direction is accepted, the
  reveal is worth running past the motion method the way the admin's was.
- It does not write copy. Every replacement sentence is a decision the maintainer makes, because
  the voice is the asset.
- It changes nothing. No file outside this one has been touched.
