# Design decisions — open questions & findings (D1–D1)

> **This is the registry the `.pen` files point at.** Briefs in `flows/*.pen` and warning
> notes in `ui-kit.lib.pen` cite these by number. Keep entries after resolution — record the
> outcome instead of deleting; the reasoning is the useful part.

**Status:** 1 entry · 0 resolved · 1 open · 0 🔴 high-impact · 0 🐞 real app bugs
(belong on the project board, not here — logged until filed).

**How entries work.** A `D<n>` is a *finding*: logged when the design and the code disagree
and the call isn't the designer's to make. The design is always built to match the **code**
(source-of-truth rule) — the entry records what the code does, what it probably should do,
and who decides.

---

## Decisions to make (design calls — not mechanical)

| # | Decision | Values in play (usage count) | Recommendation |
|---|---|---|---|
| **D1** | Where the tokens live. The palette is hardcoded per surface instead of defined once. | `#101417` in 7 code files · `#03e3ff` in 11 · `#e0e3e7` in 6 (measured 2026-09-16 across `src/`, `site/`, `docs/`) | ⏳ Mirror the kit from `src/admin/public/index.html`'s Tailwind config, the most complete set. Whether the other surfaces should consume one shared source is a code call; measure again when the kit lands. |

## Changes to make in code (once decisions land)

Execution lives in [CODE_CHANGES.md](CODE_CHANGES.md) — the work order with measured usage,
per-section status, and accumulated sites. This registry keeps the findings and decisions;
that doc tracks landing them.

## Out of scope (confirmed)

- A light theme. The code ships one dark palette; the kit does not invent another.
- A mobile layout for the dashboard. It is an operator tool used from a desktop browser.
