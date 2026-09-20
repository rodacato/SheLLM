# Design decisions — open questions & findings

> **This is the registry the `.pen` files point at.** Briefs in `flows/*.pen` and warning
> notes in `ui-kit.lib.pen` cite these by number. Keep entries after resolution — record the
> outcome instead of deleting; the reasoning is the useful part.

**Status:** 10 entries · 8 resolved · 2 open · 0 🔴 high-impact · 0 🐞 unfiled bugs.

**The registry collided with itself on 2026-09-20, and this is the repair.** Two documents
claimed `D30` and `D31` the same day for different findings: the design audit's second pass took
**D30–D42** ([DESIGN-AUDIT.md](DESIGN-AUDIT.md), commits `617bd30` and `f7efc6a`), and this file
then assigned the same two numbers to the undrawn sign-in screen and the manifest literals
(commit `c528f97`). The audit's range wins, because thirteen entries, two tables and several
commits already cite it. **This file's two are renumbered: old D30 → `D43`, old D31 → `D44`.**
Read `c528f97`'s message with that mapping. The next free number is **D46**.

**D14 resolved 2026-09-20** — it was a design-audit card, not a `D<n>` here; the verdict pattern now covers the circuit state, provider sign-in and the burn rate. Each reads a fact the server already had rather than a threshold someone picked: `retry_at` comes from the breaker's own RESET_MS, the sign-in command from the provider module, and the burn rate is judged against the weekly window beside it.

**D2–D14 are spent.** The 2026-09-20 design audit claimed that range and most of it landed; two
entries survive as drafts on the project board, cited there by number. New findings start at
**D15** — reusing a number would collide with a card that still says "Design audit D11".

**D21–D29 are spent too.** The 2026-09-20 motion audit claimed that range the same way —
seven findings and two 🐞 bugs, all of them held in [MOTION-AUDIT.md](MOTION-AUDIT.md) rather than
copied here. Two of them, D22 and D28, are the mobile drawer, which
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
| **D16** ✅ | The Playground's catalog notes disappear on a failed read, saying nothing where they exist to say where the model names came from. | The code states the rule it breaks, in its own comment at [`playground.js:45`](../src/admin/public/js/playground.js#L45): *"A list that cannot say it is stale is the same defect as a table that renders a failed read as an empty one."* `catalogs` stays `[]` on failure, so `catalogNotes` renders nothing | ✅ **Done 2026-09-20.** `fetchModels` no longer returns silently on a refused read: it names the status the gateway gave, or *the gateway did not answer* when nothing landed — the same sentence every other read on the dashboard uses. The panel renders three states now, like Overview and System: the provenance line per provider, *Could not read the model list — … The field still accepts any name*, and *No provider is enabled, so there are no model names to list*. The last clause is the one that matters to an operator mid-task: the catalog is a convenience and the field was never blocked. Five tests pin it, including the one this entry is really about — that an empty answer and no answer cannot collapse into the same screen again. Was: a failed catalog read and "no provider is enabled" look identical, in the one panel whose job is provenance. |

## Changes to make in code (once decisions land)

Execution lives in [CODE_CHANGES.md](CODE_CHANGES.md) — the work order with measured usage,
per-section status, and accumulated sites. This registry keeps the findings and decisions;
that doc tracks landing them.

| **D18** ✅ | The mono family cannot be mirrored. The code's `font-mono` is a **system stack** (`ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace`) — it resolves to a different face on every machine, and the canvas needs one renderable family. | Code: 1 stack, 0 named faces. Canvas: needs exactly 1. D4 already decided the stack over a webfont, deliberately, so this is not a request to reopen it | ✅ **Accepted 2026-09-20, as drift rather than as a match.** Adrian confirmed the stand-in stays **Roboto Mono**. The kit keeps both: `font-mono-code` holds the stack verbatim for codegen, `font-mono-render` is what the canvas draws. The two are not the same face and the entry stays here saying so — the operator reads SF Mono or Liberation Mono in practice, so a canvas measurement of mono text is close, not exact. Nothing in the app changes, and nothing should be re-derived from the canvas that depends on the glyph width. |
| **D19** ✅ | Five colours in the shipped UI have no name in the design system, and `#1a1e21` — the sidebar, mobile bar and PWA theme colour — is a whole surface step the six-step scale does not contain. | Measured under `src/`, 2026-09-20: `#1a1e21` ×5 · `#2e3b44` ×2 · `#3a1d1d` ×1 · `#3b1a1a` ×1 · `#4a2020` ×1, plus **`#ffffff`** — the logo's two white spans and every `text-white` in the markup, where the palette's lightest content colour is `on-surface` `#e0e3e7`. Full table in [ui-kit.CHANGELOG.md](ui-kit.CHANGELOG.md) | ✅ **Done, and the cause went with it.** The five became `surface-shell`, `nav-selected`, `error-container`, `danger-surface`, `danger-surface-hover` — named by role, with the six-step scale left unrenumbered. The palette is now declared once as custom properties in `custom.css`; the Tailwind config reads them, stylesheet rules read them, and Chart.js reads them, so no consumer retypes a value. A test fails on any retyped hex or arbitrary `bg-[#…]`. Originally: `#1a1e21` should become a named surface — it is the chrome the whole app sits in and it leaks into the installed PWA. The other four are one-off state backgrounds and may stay literals. Naming them is a design call; the kit mirrors current code until it lands, so **it does not carry them today**. |

| **D20** | The sign-in page keeps its own copy of nine palette colours, under its own alias names (`--bg`, `--panel`, `--accent`…). | [`src/admin/login.js:18`](../src/admin/login.js#L18). The dashboard's stylesheet **is** reachable without a session — `express.static` for `/admin/dashboard` sits ahead of `adminAuth` — so sharing it is technically possible | ⏳ Not taken. That page ships one self-contained `<style>` on purpose: it has to render when the rest of the admin cannot, and linking it to the dashboard's stylesheet trades that for one less duplicate. A test now pins each alias to the canonical value, so the copy cannot drift even while it exists. Whether to consolidate is Adrian's call, and nothing breaks if the answer is never. The kit carries a note citing this entry since 0.2.1, and the flow draws the sign-in screen from those aliases rather than pretending they are these tokens. |

| **D43** ✅ <br>*(was D30)* | The sign-in page is not in `admin.pen`. It is a real screen of this app — the one an installed dashboard shows every time the 12-hour session ends — and the flow calls itself *5 of 5*. Worse, the CRT treatment it now carries was **written in code before it was drawn**, which inverts the source-of-truth rule on purpose because Pencil was unavailable in that session. | Code: 1 undrawn screen ([`src/admin/login.js:11`](../src/admin/login.js#L11)), 5 drawn. Its four decorative layers, the `prefers-reduced-motion` branch and the safe-area insets exist only as CSS | ✅ **Drawn 2026-09-20.** *Admin / Sign in / Default* opens the band at x 760 and the band is *6 of 6*; the `Log` frame records that the code led. It got a full artboard, not a state on another brief — the decoration is most of what the screen is, so a state note would have described nothing. Two of the four CRT layers are drawn (the glow as a blurred ellipse at 6%, the sweep as a 1px gradient at 18%); the other two are repeating patterns the canvas cannot tile — a 40px dot grid and a 1px/3px line texture — and carry a `CRT TEXTURE NOT MIRRORED` note with their values and timings, the same convention the chart interiors use. The 401 and 429 states are **not** drawn: they are one panel appended to the same form and belong to the error band this flow still does not have. Was: ⏳ mirror it, and record in the `Log` frame that the code led for once. |
| **D44** ✅ <br>*(was D31)* | `manifest.webmanifest` re-types two palette colours, and a JSON file cannot read a custom property. One of them is also the wrong colour: `background_color` is `#1a1e21` (`surface-shell`, the sidebar) while the body the splash screen resolves into is `surface` `#101417`. | [`manifest.webmanifest:9-10`](../src/admin/public/manifest.webmanifest#L9). `theme_color` matches `index.html`'s meta and is correct; `background_color` matches nothing the user sees full-bleed | ✅ **Done 2026-09-20**, in the same session it was logged — this entry stood as an open question for two commits and should not have. `background_color` is `#101417` and the guard is a test, not a comment: [`palette.test.js`](../test/admin/palette.test.js) pins `background_color` to `--surface` and `theme_color` to `--surface-shell`, and fails if the page's `<meta>` and the manifest disagree. The exemption in `LITERAL_IS_THE_ONLY_OPTION` says the manifest may carry the literal; it never said it may carry the wrong one. Was: D19 removed every retyped literal it could reach and this is the one it structurally cannot. |

| **D45** | The canvas draws two type steps a pixel off the code, in 40 places. `text-sm` is 13px on the canvas against 14 in the code (36 nodes, 25 of them Logs table cells), and `text-lg` is 17 against 18 (4 nodes on System). | Measured 2026-09-20 across the flow: canvas sizes are 9·10·11·12·13·17·18·20·23·24·26, the code's scale is 10·11·12·14·18·20·24 plus icons at 16·18·20 (the 23 is the logo's SVG text and the 13s on Sign in are correct — `login.js` sets `.8rem`) | ⏳ Two of the five were fixed in the same pass because they were safe: 26 → `$text-2xl` on seven figures, and 9 → `$text-label` on five footers after the code collapsed that step. These 40 were not. Every one of them sits in a fixed-width table cell or a tight row, and growing text by a pixel without being able to look at the result is how a mirror pass introduces the overflow it exists to catch. Do it in a session that can screenshot, and check bounds on Logs first. |

## Real app bugs — logged here until filed on the board

| # | Bug | Evidence | Where it goes |
|---|---|---|---|
| **D17** ✅ 🐞 | Disabling or enabling a provider fails silently. `toggleProvider` clears the spinner and returns; the switch snaps back to its old position with no message, so the operator believes the provider is in a state it is not. | [`system.js:195-205`](../src/admin/public/js/system.js#L195) — `if (res.ok) await this.fetchProviders();` then `catch { /* ignore */ }`. A 403, a 500 and a dropped connection are all indistinguishable from "nothing happened". | ✅ **Fixed 2026-09-20** without ever being filed — it lived in the same panel as D15 and leaving it would have been half a fix. A refused write now names the provider that did not change and why. Was: a silently-failed **write** on the page whose job is controlling providers is worse than a silently-failed read: the operator acts on a belief the UI gave them. |

## Out of scope (confirmed)

- A light theme. The code ships one dark palette; the kit does not invent another.
- A mobile layout for the dashboard. It is an operator tool used from a desktop browser.
