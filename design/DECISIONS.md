# Design decisions — open questions & findings (D1–D19)

> **This is the registry the `.pen` files point at.** Briefs in `flows/*.pen` and warning
> notes in `ui-kit.lib.pen` cite these by number. Keep entries after resolution — record the
> outcome instead of deleting; the reasoning is the useful part.

**Status:** 6 entries · 1 resolved · 5 open · 1 🔴 high-impact · 1 🐞 real app bug
(belongs on the project board, not here — logged until filed).

**D2–D14 are spent.** The 2026-09-20 design audit claimed that range and most of it landed; two
entries survive as drafts on the project board, cited there by number. New findings start at
**D15** — reusing a number would collide with a card that still says "Design audit D11".

**How entries work.** A `D<n>` is a *finding*: logged when the design and the code disagree
and the call isn't the designer's to make. The design is always built to match the **code**
(source-of-truth rule) — the entry records what the code does, what it probably should do,
and who decides.

---

## Decisions to make (design calls — not mechanical)

| # | Decision | Values in play (usage count) | Recommendation |
|---|---|---|---|
| **D1** ✅ | *Resolved 2026-09-20 by kit 0.1.0.* Where the tokens live. The palette is hardcoded per surface instead of defined once. | `#101417` in 7 code files · `#03e3ff` in 11 · `#e0e3e7` in 6 (measured 2026-09-16 across `src/`, `site/`, `docs/`) | ⏳ Mirror the kit from the admin's Tailwind config, the most complete set. Whether the other surfaces should consume one shared source is a code call; measure again when the kit lands. **Outcome:** the kit mirrors [`views/index.html:23`](../src/admin/views/index.html#L23) plus `custom.css`, 34 variables, names taken from the code. `site/` no longer exists, so the original measurement covered two surfaces, not three. Whether the other surfaces should consume one shared source stays a code call — five literals escaped the config and are listed as open kit gaps in [ui-kit.CHANGELOG.md](ui-kit.CHANGELOG.md), tracked as D19. |
| **D15** 🔴 | The System page renders a failed provider read as nothing at all. Overview got the three states a panel must tell apart (loading · unreachable · genuinely empty); System kept only the first. | Overview: 3 states ([`overview.html:182-185`](../src/admin/views/pages/overview.html#L182)) · System: 1 state ([`system.html:222`](../src/admin/views/pages/system.html#L222)), and [`system.js:56`](../src/admin/public/js/system.js#L56) discards the failure | ⏳ Mirror Overview's three states. The audit that fixed this everywhere else recorded it as done; it survived here, so the design should draw all three and the code should follow. Whether System *also* needs the per-panel banner is the open half. |
| **D16** | The Playground's catalog notes disappear on a failed read, saying nothing where they exist to say where the model names came from. | The code states the rule it breaks, in its own comment at [`playground.js:45`](../src/admin/public/js/playground.js#L45): *"A list that cannot say it is stale is the same defect as a table that renders a failed read as an empty one."* `catalogs` stays `[]` on failure, so `catalogNotes` renders nothing | ⏳ A failed catalog read and "no provider is enabled" are different facts and currently look identical. The global banner does fire (`apiFetch` reports), so this is narrower than D15 — but the panel that exists to explain provenance is the one that goes quiet. Draw the unreadable state. |

## Changes to make in code (once decisions land)

Execution lives in [CODE_CHANGES.md](CODE_CHANGES.md) — the work order with measured usage,
per-section status, and accumulated sites. This registry keeps the findings and decisions;
that doc tracks landing them.

| **D18** | The mono family cannot be mirrored. The code's `font-mono` is a **system stack** (`ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace`) — it resolves to a different face on every machine, and the canvas needs one renderable family. | Code: 1 stack, 0 named faces. Canvas: needs exactly 1. D4 already decided the stack over a webfont, deliberately, so this is not a request to reopen it | ⏳ The kit stores both: `font-mono-code` keeps the stack verbatim for codegen, `font-mono-render` is the canvas stand-in, currently **Roboto Mono**. That pick is mine and it is a guess — the operator reads SF Mono or Liberation Mono in practice. Adrian picks the stand-in, or confirms the drift is acceptable and it is recorded as such. Nothing in the app changes either way. |
| **D19** | Five colours in the shipped UI have no name in the design system, and `#1a1e21` — the sidebar, mobile bar and PWA theme colour — is a whole surface step the six-step scale does not contain. | Measured under `src/`, 2026-09-20: `#1a1e21` ×5 · `#2e3b44` ×2 · `#3a1d1d` ×1 · `#3b1a1a` ×1 · `#4a2020` ×1. Full table in [ui-kit.CHANGELOG.md](ui-kit.CHANGELOG.md) | ⏳ `#1a1e21` should almost certainly become a named surface — it is the chrome the whole app sits in and it leaks into the installed PWA. The other four are one-off state backgrounds and may stay literals. Naming them is a design call; the kit mirrors current code until it lands, so **it does not carry them today**. |

## Real app bugs — logged here until filed on the board

| # | Bug | Evidence | Where it goes |
|---|---|---|---|
| **D17** 🐞 | Disabling or enabling a provider fails silently. `toggleProvider` clears the spinner and returns; the switch snaps back to its old position with no message, so the operator believes the provider is in a state it is not. | [`system.js:195-205`](../src/admin/public/js/system.js#L195) — `if (res.ok) await this.fetchProviders();` then `catch { /* ignore */ }`. A 403, a 500 and a dropped connection are all indistinguishable from "nothing happened". | ⏳ Not filed. A silently-failed **write** on the page whose job is controlling providers is worse than a silently-failed read: the operator acts on a belief the UI gave them. |

## Out of scope (confirmed)

- A light theme. The code ships one dark palette; the kit does not invent another.
- A mobile layout for the dashboard. It is an operator tool used from a desktop browser.
