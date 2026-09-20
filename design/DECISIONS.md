# Design decisions — open questions & findings (D1–D29)

> **This is the registry the `.pen` files point at.** Briefs in `flows/*.pen` and warning
> notes in `ui-kit.lib.pen` cite these by number. Keep entries after resolution — record the
> outcome instead of deleting; the reasoning is the useful part.

**Status:** 9 entries · 5 resolved · 4 open · 0 🔴 high-impact · 0 🐞 unfiled bugs.

**D14 resolved 2026-09-20** — it was a design-audit card, not a `D<n>` here; the verdict pattern now covers the circuit state, provider sign-in and the burn rate. Each reads a fact the server already had rather than a threshold someone picked: `retry_at` comes from the breaker's own RESET_MS, the sign-in command from the provider module, and the burn rate is judged against the weekly window beside it.

**D2–D14 are spent.** The 2026-09-20 design audit claimed that range and most of it landed; two
entries survive as drafts on the project board, cited there by number. New findings start at
**D15** — reusing a number would collide with a card that still says "Design audit D11".

**D21–D29 are spent too.** The 2026-09-20 motion audit claimed that range the same way —
seven findings and two 🐞 bugs, all of them held in [MOTION-AUDIT.md](MOTION-AUDIT.md) rather than
copied here. New findings start at **D30**. Two of them, D22 and D28, are the mobile drawer, which
*Out of scope (confirmed)* below already rules out; they are recorded so the next pass does not
re-find them, not proposed.

**How entries work.** A `D<n>` is a *finding*: logged when the design and the code disagree
and the call isn't the designer's to make. The design is always built to match the **code**
(source-of-truth rule) — the entry records what the code does, what it probably should do,
and who decides.

---

## Decisions to make (design calls — not mechanical)

| # | Decision | Values in play (usage count) | Recommendation |
|---|---|---|---|
| **D1** ✅ | *Resolved 2026-09-20 by kit 0.1.0.* Where the tokens live. The palette is hardcoded per surface instead of defined once. | `#101417` in 7 code files · `#03e3ff` in 11 · `#e0e3e7` in 6 (measured 2026-09-16 across `src/`, `site/`, `docs/`) | ⏳ Mirror the kit from the admin's Tailwind config, the most complete set. Whether the other surfaces should consume one shared source is a code call; measure again when the kit lands. **Outcome:** the kit mirrors [`views/index.html:23`](../src/admin/views/index.html#L23) plus `custom.css`, 34 variables, names taken from the code. `site/` no longer exists, so the original measurement covered two surfaces, not three. Whether the other surfaces should consume one shared source stays a code call — five literals escaped the config and are listed as open kit gaps in [ui-kit.CHANGELOG.md](ui-kit.CHANGELOG.md), tracked as D19. |
| **D15** ✅ | The System page renders a failed provider read as nothing at all. Overview got the three states a panel must tell apart (loading · unreachable · genuinely empty); System kept only the first. | Overview: 3 states ([`overview.html:182-185`](../src/admin/views/pages/overview.html#L182)) · System: 1 state ([`system.html:222`](../src/admin/views/pages/system.html#L222)), and [`system.js:56`](../src/admin/public/js/system.js#L56) discards the failure | ✅ **Done.** System now renders loading, unreachable and genuinely empty as three distinct lines, and a refused provider toggle says which provider did not change (that was D17, fixed in the same commit). Originally: The audit that fixed this everywhere else recorded it as done; it survived here, so the design should draw all three and the code should follow. Whether System *also* needs the per-panel banner is the open half. |
| **D16** | The Playground's catalog notes disappear on a failed read, saying nothing where they exist to say where the model names came from. | The code states the rule it breaks, in its own comment at [`playground.js:45`](../src/admin/public/js/playground.js#L45): *"A list that cannot say it is stale is the same defect as a table that renders a failed read as an empty one."* `catalogs` stays `[]` on failure, so `catalogNotes` renders nothing | ⏳ A failed catalog read and "no provider is enabled" are different facts and currently look identical. The global banner does fire (`apiFetch` reports), so this is narrower than D15 — but the panel that exists to explain provenance is the one that goes quiet. Draw the unreadable state. |

## Changes to make in code (once decisions land)

Execution lives in [CODE_CHANGES.md](CODE_CHANGES.md) — the work order with measured usage,
per-section status, and accumulated sites. This registry keeps the findings and decisions;
that doc tracks landing them.

| **D18** | The mono family cannot be mirrored. The code's `font-mono` is a **system stack** (`ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace`) — it resolves to a different face on every machine, and the canvas needs one renderable family. | Code: 1 stack, 0 named faces. Canvas: needs exactly 1. D4 already decided the stack over a webfont, deliberately, so this is not a request to reopen it | ⏳ The kit stores both: `font-mono-code` keeps the stack verbatim for codegen, `font-mono-render` is the canvas stand-in, currently **Roboto Mono**. That pick is mine and it is a guess — the operator reads SF Mono or Liberation Mono in practice. Adrian picks the stand-in, or confirms the drift is acceptable and it is recorded as such. Nothing in the app changes either way. |
| **D19** ✅ | Five colours in the shipped UI have no name in the design system, and `#1a1e21` — the sidebar, mobile bar and PWA theme colour — is a whole surface step the six-step scale does not contain. | Measured under `src/`, 2026-09-20: `#1a1e21` ×5 · `#2e3b44` ×2 · `#3a1d1d` ×1 · `#3b1a1a` ×1 · `#4a2020` ×1, plus **`#ffffff`** — the logo's two white spans and every `text-white` in the markup, where the palette's lightest content colour is `on-surface` `#e0e3e7`. Full table in [ui-kit.CHANGELOG.md](ui-kit.CHANGELOG.md) | ✅ **Done, and the cause went with it.** The five became `surface-shell`, `nav-selected`, `error-container`, `danger-surface`, `danger-surface-hover` — named by role, with the six-step scale left unrenumbered. The palette is now declared once as custom properties in `custom.css`; the Tailwind config reads them, stylesheet rules read them, and Chart.js reads them, so no consumer retypes a value. A test fails on any retyped hex or arbitrary `bg-[#…]`. Originally: `#1a1e21` should become a named surface — it is the chrome the whole app sits in and it leaks into the installed PWA. The other four are one-off state backgrounds and may stay literals. Naming them is a design call; the kit mirrors current code until it lands, so **it does not carry them today**. |

| **D20** | The sign-in page keeps its own copy of nine palette colours, under its own alias names (`--bg`, `--panel`, `--accent`…). | [`src/admin/login.js:18`](../src/admin/login.js#L18). The dashboard's stylesheet **is** reachable without a session — `express.static` for `/admin/dashboard` sits ahead of `adminAuth` — so sharing it is technically possible | ⏳ Not taken. That page ships one self-contained `<style>` on purpose: it has to render when the rest of the admin cannot, and linking it to the dashboard's stylesheet trades that for one less duplicate. A test now pins each alias to the canonical value, so the copy cannot drift even while it exists. Whether to consolidate is Adrian's call, and nothing breaks if the answer is never. |

| **D30** | The sign-in page is not in `admin.pen`. It is a real screen of this app — the one an installed dashboard shows every time the 12-hour session ends — and the flow calls itself *5 of 5*. Worse, the CRT treatment it now carries was **written in code before it was drawn**, which inverts the source-of-truth rule on purpose because Pencil was unavailable in that session. | Code: 1 undrawn screen ([`src/admin/login.js:11`](../src/admin/login.js#L11)), 5 drawn. Its four decorative layers, the `prefers-reduced-motion` branch and the safe-area insets exist only as CSS | ⏳ Mirror it, and record in the `Log` frame that the code led for once. The band becomes *6 of 6*. The open half is whether a screen that is mostly decoration is worth a full artboard or belongs as a state on the Overview brief — that is Adrian's call, and the notes for the edit are in [PEN-TODO.md](PEN-TODO.md). |
| **D31** ✅ | `manifest.webmanifest` re-types two palette colours, and a JSON file cannot read a custom property. One of them is also the wrong colour: `background_color` is `#1a1e21` (`surface-shell`, the sidebar) while the body the splash screen resolves into is `surface` `#101417`. | [`manifest.webmanifest:9-10`](../src/admin/public/manifest.webmanifest#L9). `theme_color` matches `index.html`'s meta and is correct; `background_color` matches nothing the user sees full-bleed | ✅ **Done 2026-09-20**, in the same session it was logged — this entry stood as an open question for two commits and should not have. `background_color` is `#101417` and the guard is a test, not a comment: [`palette.test.js`](../test/admin/palette.test.js) pins `background_color` to `--surface` and `theme_color` to `--surface-shell`, and fails if the page's `<meta>` and the manifest disagree. The exemption in `LITERAL_IS_THE_ONLY_OPTION` says the manifest may carry the literal; it never said it may carry the wrong one. Was: D19 removed every retyped literal it could reach and this is the one it structurally cannot. |

## Real app bugs — logged here until filed on the board

| # | Bug | Evidence | Where it goes |
|---|---|---|---|
| **D17** ✅ 🐞 | Disabling or enabling a provider fails silently. `toggleProvider` clears the spinner and returns; the switch snaps back to its old position with no message, so the operator believes the provider is in a state it is not. | [`system.js:195-205`](../src/admin/public/js/system.js#L195) — `if (res.ok) await this.fetchProviders();` then `catch { /* ignore */ }`. A 403, a 500 and a dropped connection are all indistinguishable from "nothing happened". | ✅ **Fixed 2026-09-20** without ever being filed — it lived in the same panel as D15 and leaving it would have been half a fix. A refused write now names the provider that did not change and why. Was: a silently-failed **write** on the page whose job is controlling providers is worse than a silently-failed read: the operator acts on a belief the UI gave them. |

## Out of scope (confirmed)

- A light theme. The code ships one dark palette; the kit does not invent another.
- A mobile layout for the dashboard. It is an operator tool used from a desktop browser.
