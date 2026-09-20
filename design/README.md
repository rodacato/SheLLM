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
| `admin.pen` | 1 of 5 drawn — Overview. Request Logs, API Keys, Playground, System pending | **0.1.1** | `/admin/dashboard/`, sidebar in [`src/admin/public/js/app.js:209`](../src/admin/public/js/app.js#L209) |

`ui-kit.lib.pen` carries tokens as of **0.1.1** and no components yet — the shared components come
out of the real markup as the remaining screens are drawn, not from guessing which ones are shared.

**Chart interiors are not mirrored.** Chart.js draws a scatter and a line; the `.pen` layout cannot
position individual points, and an approximation would look plausible and misrepresent what ships.
Both plot areas carry the real card chrome and say so on the canvas.

The admin is the only surface with a flow. There is no public flow: the landing page and the
hosted API reference were removed, so `site/` and `docs/index.html` do not exist. The Stitch
exports kept locally under `docs/screens/` are legacy references, below code and production
captures in the source-of-truth order — and two of them (`models_…`, `…_landing_page_…`) describe
screens the product no longer has.

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
