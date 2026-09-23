# Design — Pencil workflow

Everything about SheLLM's visual design — the admin dashboard — lives here. Read this before touching a `.pen`. It doubles
as context for AI agents (`AGENTS.md` points them here).

**Two rules that matter most:**

1. The **code is the source of truth** for design and layout — not old designs, not stale
   screenshots.
2. **Don't dedupe or promote things into the kit unless you were asked.** Spotting a
   resemblance is a note, not a task — there's no live propagation, so every kit change is
   manual work across every consumer.

## What's here

| Path | What it is |
|---|---|
| `ui-kit.lib.pen` | **The design library** — tokens + components, mirrored 1:1 from the code |
| `ui-kit.CHANGELOG.md` | Kit versions and what each bump changed |
| `flows/*.pen` | **One file per domain** (a user journey with enough weight to justify one) |
| `_playground.pen` | Experiments — **inside the system** (vendors the kit like any flow) |
| `DECISIONS.md` | The numbered findings registry the `.pen` briefs cite |
| `CODE_CHANGES.md` | Work order for design-decided consolidations pending in code |
| `exports/` | Canvas PNGs for PR review — **committed** (they must travel) |
| `references/` | Local-only device captures — **never commit: real user data** (gitignored) |

### The flows

| File | Screens | Kit | Domain entry point |
|---|---|---|---|
| `admin.pen` | 18 of 18 — **six route columns, one per URL**, each stacked in flow order rather than alphabetically. `/admin/login` carries Sign in and its two failures; `#overview`, `#logs`, `#keys`, `#playground` and `#system` each carry their page and every state it can show. The briefs and the Log are the documentation column at x=0. | **0.3.0** | `/admin/login` and `/admin/dashboard/`, sidebar in [`src/admin/public/js/app.js:209`](../src/admin/public/js/app.js#L209) |

**A proposal column is allowed here, and it is expected to be temporary.** The auto-refresh control
was drawn before it was built, in a column of its own whose brief said in its first line that it was not a
mirror, so the shape could be argued over on a real screen instead of in the abstract. It earned
its keep — the held state and the width it needs were both settled on canvas — and it was deleted
the day the code shipped, once the five artboards that share the header and the filter row had been
re-drawn to what actually landed. That is the whole lifecycle: label it, use it, delete it. A
proposal band still here after its feature ships is a defect.

`ui-kit.lib.pen` carries tokens as of **0.3.0** and no components yet: colour, family and radius, plus the type, icon and spacing scales 0.3.0 added. The sidebar and the page
footer are now known to be shared — they are rebuilt per screen from one function in the flow, and
that is the promotion candidate for the first kit component. Promoting is a batch, done when asked.

The error band is drawn since 2026-09-20. Both conditional banners (`Not updating`,
`USAGE LIMIT HIT`), the sign-in 401 and 429 panels, the Playground's waiting clock and its three
catalog states, and the unreachable or genuinely-empty states on Overview, Logs, Keys and System
are artboards now rather than entries in *states not drawn*. What stayed in that section is what a
second artboard would not have added: a pure string swap into a slot the band already draws, kept
there with its copy. Read band 2's brief for the list.

The flow and the kit are both at **0.3.0**, and the flow now draws the type scale it mirrors:
**D45 is closed**, so no node is a pixel off the code except the 13s on Sign in, which are correct
because that page sets its own `.8rem`.

Drawing the band opened **D46** and the same day closed it, which is the clearest argument this
folder has for the method: System's Concurrency card rendered a health read that never happened as
`0 / 0` — indistinguishable from an idle gateway — while the sidebar beside it said `UNREACHABLE`.
Reading the file had not caught it in two audits; putting the card and the sidebar on one artboard
did. The code now guards the figure, and the artboard was re-drawn to the fix.

**Chart interiors are drawn since 2026-09-20, and the reason they were not is worth keeping.** The
refusal was never "the canvas cannot draw a chart" — it was that nobody had seen the shipped one,
so any drawing would have been invention that reads as evidence. Production captures exist now, and
a capture outranks a guess ([Source of truth](#source-of-truth)), so the charts are mirrored from
the captures **plus** the Chart.js config in `js/overview.js`: grid, axes, tick format, point
radius, the per-status colours and the dashed `now` marker all come from the code. Two rules hold
when they are re-drawn:

- **The marks plot this flow's illustrative dataset, not the capture's.** A capture showing seven
  requests at 100% ok next to a table reporting 107 at 84.6% would be the misrepresentation the
  refusal existed to prevent.
- **Never copy a capture's chrome over the code's.** The captures label their axes `02:33 PM`; the
  shipped formatter is `hourCycle: 'h23'`, so the canvas reads `13:02`. Captures go stale; the
  config does not.

Points are absolutely positioned inside the plot frame and the lines are `path` nodes — the
"layout cannot position individual points" limit applies to Pencil's flexbox, not to the file.

The admin is the only surface with a `.pen` flow. The public surface is not drawn in Pencil but it
does exist: the landing page (`site/index.html`) and the hosted API reference
(`site/api/index.html`) are hand-written and deployed by `.github/workflows/pages.yml`. They are
reviewed as code, and the findings that pass produced are in the ledger in
[`DECISIONS.md`](DECISIONS.md). `docs/index.html` is
the one that was removed and never came back.

The Stitch exports kept locally under `docs/screens/` are legacy references, below code and
production captures in the source-of-truth order. `models_…` describes a screen the product no
longer has; `…_landing_page_…` describes a landing page the product replaced, so read it for
intent and never as a target.

**This table is present tense — it never carries history.** "Migrated on <date>, six
components consolidated" belongs in that flow's `Log` frame, not here.

Every flow opens each row band with a **brief** frame (at the left of the band): purpose,
entry points, screens, business rules, copy source, states not drawn, open findings (`D<n>`
numbers only), history pointer — the same eight sections in every flow. **Read the brief
before editing a flow.** Each file also carries one **`Log`** frame below its bands: one
dated line per change, newest first.

| Where | Owns |
|---|---|
| **Brief frame** (`.pen`) | the flow's **present state** |
| **Log frame** (`.pen`) | **what changed and when** — one line each |
| `DECISIONS.md` | the **why** — findings, open questions, who decides |
| `CODE_CHANGES.md` | landing decided changes in code |
| `ui-kit.CHANGELOG.md` | kit versions and open kit gaps |
| this `README.md` | the method + the inventory — **no history** |

A fact written in two of them belongs in one; the others cite it.

## Source of truth

**code > production capture > legacy.** In that order, every time.

- Derive the **domain list** from the dashboard sidebar ([`src/admin/public/js/app.js:209`](../src/admin/public/js/app.js#L209)), never from an old design. The audit's own mockups list a Models page that `252cd12` removed — that is what reading a domain list off a legacy file costs.
- **Never invent copy** — every string must exist in the code.
- Build states by finding their owner in the code; hunt the states a normal session never
  reaches (no data, no permission, failed request) — that's where design gaps AND code bugs
  live.

## Canvas conventions

- Base frame: 1440×900 (desktop web). `clip: true` on every screen frame.
- Naming: `[Flow] / [Screen] / [State]` — **no numeric prefix; order is position, not name.**
- **Tokens only** — zero hex in a flow. A value the kit lacks is a kit gap: log it.
- AA contrast through tokens; the dark terminal palette is the only theme the code ships.
- Modals center on the frame; the dashboard has no bottom sheets.

### Layout — a docs column plus row bands

One **row band per journey variant** (happy path · error/alternate paths · desktop), read
left → right, each opening with its brief. One `Log` frame per file below every band.
Positions are **computed, never picked**, from five variables declared in the `.pen`:

| Variable | This project | What it is |
|---|---|---|
| `grid-x0` | `0` | Left edge of the docs column (briefs + Log) |
| `grid-brief-w` | `640` | Width of every brief and of the Log |
| `grid-gutter` | `120` | Horizontal gap between artboards |
| `grid-y0` | `0` | Top of the first band |
| `grid-row-gap` | `260` | Vertical gap between bands |
| `grid-fold-y` | `900` | Where the declared frame ends. Marked on the one screen taller than it |

Inserting a screen mid-journey: drop it at the `x` it belongs to (overlap is fine), then
**reflow the band** — one call sorts by current `x` and re-snaps to the grid. It never
reorders, so drift is always cheap to fix.

## The kit + vendoring

Core/shared components → the kit. Feature-local components → the flow. Flows **vendor** the
kit at a pinned `kit-version-source` (Pencil can't cross-reference files); bumps follow the
CHANGELOG rules. Being behind is fine; **diverging is not** — install every token in every
flow even when nothing renders differently.

## Team workflow

1. Design changes go through PRs, like code — atomic with the implementing code when possible.
2. One person per `.pen` at a time. Kit changes get review.
3. No auto-save: **save often, commit often**.
4. Nothing moves from `_playground.pen` to `flows/` without cleanup + approval.
5. Export PNGs of changed flows to `exports/` for review.

## Fidelity loop (design ↔ code)

1. Open the flow, read its brief. 2. Design with the vendored components. 3. Implement:
the `.pen` components map 1:1 to the Tailwind config in [`src/admin/views/index.html:23`](../src/admin/views/index.html#L23), the custom properties in `src/admin/public/css/custom.css`, and the markup in `src/admin/views/pages/*.html`. 4. Screenshot the rendered app,
overlay at 50% opacity on the design, fix drift in the design first, then the code.
