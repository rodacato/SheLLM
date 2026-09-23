# Design decisions — open questions & findings

> **This is the registry the `.pen` files point at.** Briefs in `flows/*.pen` and warning
> notes in `ui-kit.lib.pen` cite these by number. Keep entries after resolution — record the
> outcome instead of deleting; the reasoning is the useful part.

**Status:** 14 entries · 13 resolved · 1 open · 0 🔴 high-impact · 0 🐞 unfiled bugs.

**The registry collided with itself on 2026-09-20, and this is the repair.** Two documents
claimed `D30` and `D31` the same day for different findings: the design audit's second pass took
**D30–D42** (the design audit's third pass, commits `617bd30` and `f7efc6a`), and this file
then assigned the same two numbers to the undrawn sign-in screen and the manifest literals
(commit `c528f97`). The audit's range wins, because thirteen entries, two tables and several
commits already cite it. **This file's two are renumbered: old D30 → `D43`, old D31 → `D44`.**
Read `c528f97`'s message with that mapping. The next free number is **D49**.

**D14 resolved 2026-09-20** — it was a design-audit card, not a `D<n>` here; the verdict pattern now covers the circuit state, provider sign-in and the burn rate. Each reads a fact the server already had rather than a threshold someone picked: `retry_at` comes from the breaker's own RESET_MS, the sign-in command from the provider module, and the burn rate is judged against the weekly window beside it.

**D2–D14 are spent.** The 2026-09-20 design audit claimed that range and most of it landed; two
entries survive as drafts on the project board, cited there by number. New findings start at
**D15** — reusing a number would collide with a card that still says "Design audit D11".

**D21–D29 are spent too.** The 2026-09-20 motion audit claimed that range the same way —
seven findings and two 🐞 bugs, now carried in the ledger at the end of this file. Two of them, D22 and D28, are the mobile drawer, which
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

| **D45** ✅ | The canvas drew two type steps a pixel off the code, in 40 places. `text-sm` was 13px on the canvas against 14 in the code (36 nodes, 25 of them Logs table cells), and `text-lg` was 17 against 18 (4 nodes on System). | Measured 2026-09-20 across the flow: canvas sizes were 9·10·11·12·13·17·18·20·23·24·26, the code's scale is 10·11·12·14·18·20·24 plus icons at 16·18·20 (the 23 is the logo's SVG text and the 13s on Sign in are correct — `login.js` sets `.8rem`) | ✅ **Closed 2026-09-20**, in the first session that could render an image — which is the whole point of the entry, not an aside. 52 nodes moved to `$text-sm` and 8 to `$text-lg`: the original 40, plus the 16 the error band inherited by being copied from band 1 before the fix. Order mattered and was followed — the Logs table's 25 fixed-width cells went first and alone, with `ctx.bounds` read before and after; no cell wrapped to a second line and both Logs artboards kept their exact height. `ctx.problems` is empty across every artboard in the file. The 17 thirteens on the three Sign in artboards were deliberately left: that page sets `.8rem` and they were never wrong. What remains numeric in the flow is 10·11·12·18·20·24 plus the logo's 23 and those Sign in 13s. Was: ⏳ do it in a session that can screenshot, and check bounds on Logs first. |
| **D46** ✅ 🐞 | System's Concurrency card reports a health read that never happened as data. When the gateway does not answer, it renders `0 / 0`, `0`, `0 / 0` and `none` — which is exactly what an idle, healthy gateway looks like — while the sidebar a few inches to its left says `UNREACHABLE`. Two elements on one screen answer the same question differently, and the more prominent one is wrong. | [`system.html:148`](../src/admin/views/pages/system.html#L148) reads `(health?.queue?.active ?? 0) + ' / ' + (health?.queue?.max_concurrent ?? 0)` with no guard. Overview asks the same store for the same four figures and guards every one with `healthRead === 'ok' ? … : '—'` ([`overview.html:152`](../src/admin/views/pages/overview.html#L152)). `healthRead` lives on the root component ([`app.js:207`](../src/admin/public/js/app.js#L207)) and reaches System through the same scope inheritance Overview uses, so the guard is available and simply not applied. The sidebar already branches on it ([`index.html:123`](../src/admin/views/index.html#L123)) | ✅ **Fixed 2026-09-20**, the same day the drawing opened it, and like D17 it was fixed without ever being filed. Running, Waiting and Streams now guard on `healthRead === 'ok'` and render the em dash Overview always used. **Open circuits guards on `providersLoaded && !providersError` instead**, and that correction came out of the fix rather than out of this entry: `openCircuits` filters `this.providers` ([`system.js:31`](../src/admin/public/js/system.js#L31)), not `health`, so guarding it on the health read would have lied in the opposite direction and hidden a genuinely open circuit while the providers read was fine. Four tests pin it in [`system-states.test.js`](../../test/admin/system-states.test.js); the load-bearing one pulls each figure's real `x-text` out of the composed markup and asserts that a never-answered read and a genuine zero cannot render alike — no sentinel colliding with a real zero can satisfy it, and a fifth unguarded figure fails it. `Admin / System / Unreachable` was re-drawn to the fix, which is the point of having drawn the defect at all. Was: ⏳ found by **drawing** the state, not by reading the file — the canvas put the card and the sidebar side by side and the contradiction was the picture. This is D15's shape a third time: Overview got the fix, System kept the defect. |
| **D61** ✅ | The saturation bar under Overview's queue panel was never derived from the figure it sits under. Both copies — `Overview / Default` and `Overview / Usage limit` — drew a fill 558 px wide in a 644 px track, 87%, beneath a caption reading `50% of concurrency in use`. | [`overview.html:170`](../src/admin/views/pages/overview.html#L170) sizes the fill with `:style="'width:' + queueSaturation() + '%'"`, and `queueSaturation()` is `round(active / max_concurrent * 100)` ([`overview.js:98`](../src/admin/public/js/overview.js#L98)). With `ACTIVE 1` against a cap of 2 the fill owed 322 px and drew 558 — it was never wrong by a rounding, it was never computed. | ✅ **Closed 2026-09-23**, found while re-mirroring the new `MAX_CONCURRENT=4`. Both fills are 161 px now, the 25% that one active call under a cap of four actually is. It survived every screenshot review this flow has had, including the fidelity loop D45's entry celebrates, because a bar of the wrong length still reads as a bar and no visual pass measures it against the number printed above it. That is the argument for computing geometry from the figure it encodes rather than drawing it to look right. |
| **D48** ✅ | Should the degraded banner animate in or out, and does that finally give `--ease-exit` a user? the motion audit predicted it would: *"exit lands with the error band — the first thing that will actually need it"*. Drawing the band is what made the question askable. | Measured in Chromium at 1440×900 against the running admin, 2026-09-20. The band is 48px + 24px margin = **72px of displacement**, inserted in one frame. Mid-page, `overflow-anchor` absorbs it completely — `scrollY` 500→572 with the tracked element unmoved at 390. At `scrollY` 0 it is one discrete 72px jump, and **every navigation lands there**, because `show()` calls `window.scrollTo(0, 0)` ([`app.js:224`](../src/admin/public/js/app.js#L224)) | ❌ **Rejected, both directions.** A prototyped 200ms height entrance was watched at `scrollY` 0: **three different table rows pass under one fixed screen point during the run** — motion may not move a target the operator is aiming at, and this is the surface whose job is reading numbers. The cheaper forms do not survive either: opacity or transform alone leaves the 72px reflow instant, so nothing is prevented and only decoration is left. Exit fails earlier, on purpose rather than on function: it would hold *"Nothing below is being updated"* on screen for 150–200ms **after it stopped being true**, which on this product is a small lie with a curve on it. Two independent secondary kills: the band is already present at first render when the page cold-loads with the gateway down, so an entrance would ramp a state that predates the page — D21's exact defect; and a measured 151ms on/off flash (two 30s pollers feeding a last-write-wins `reportRead`) becomes a visible stutter instead of a blink. **Cost of rejecting: nothing measurable.** `--ease-exit` stays undeclared, and the audit's prediction is corrected in place rather than deleted — the band is removed from flow, which is a reflow, not a departure. **Left open deliberately, and it is a layout question, not a motion one:** the 72px snap at `scrollY` 0 is a genuine defect. Reserve the slot, take the band out of flow the way the sidebar health readout already is, or accept it as one frame once per incident. Flagged for a `ui-review` pass, not decided here. |

## Real app bugs — logged here until filed on the board

| # | Bug | Evidence | Where it goes |
|---|---|---|---|
| **D17** ✅ 🐞 | Disabling or enabling a provider fails silently. `toggleProvider` clears the spinner and returns; the switch snaps back to its old position with no message, so the operator believes the provider is in a state it is not. | [`system.js:195-205`](../src/admin/public/js/system.js#L195) — `if (res.ok) await this.fetchProviders();` then `catch { /* ignore */ }`. A 403, a 500 and a dropped connection are all indistinguishable from "nothing happened". | ✅ **Fixed 2026-09-20** without ever being filed — it lived in the same panel as D15 and leaving it would have been half a fix. A refused write now names the provider that did not change and why. Was: a silently-failed **write** on the page whose job is controlling providers is worse than a silently-failed read: the operator acts on a belief the UI gave them. |
| **D47** ✅ 🐞 | The installed dashboard shows a broken image where its own wordmark should be. The service worker precaches the SVG favicon and the three PWA icons but not `logo-dark.svg` — which the sidebar, the mobile bar and the sign-in page all render — so once the shell is served from cache the wordmark 404s. The one screen whose whole job is to stay readable when the backend is gone had a broken asset in its chrome. | [`sw.js:5-17`](../src/admin/public/sw.js#L5) listed 13 URLs; the chrome references 4 more. `logo-dark.svg` is used at [`index.html:85`](../src/admin/views/index.html#L85) and `:96`, and at [`login.js:80`](../src/admin/login.js#L80). The three PNG favicons were missing too — same defect, milder symptom | ✅ **Fixed 2026-09-20.** Found by the fidelity pass, in the capture rather than in the code: the drawn artboards show the wordmark, which is right for the online app, and the real cached-shell render showed a broken-image glyph beside it. All four assets added. **The cache version was deliberately NOT bumped**, and that is the interesting half: `install` re-runs on any byte change to `sw.js` (served `no-cache`, [`app.js:96`](../src/app.js#L96)) and `addAll` re-fetches every URL, so existing installs pick the additions up anyway — while `activate` deletes every cache key that is not the current one, which would discard the opportunistically-cached `/admin/dashboard/` page and leave a client that updated and then went offline with no shell at all. The version earns a bump when an entry must be evicted, not when one is added. The existing test was generalised rather than duplicated: it now derives every local `js/`, `css/` and `img/` reference from the composed dashboard **and** the login page and requires each to be in the cache list, with a per-kind guard so a regex that stops matching fails instead of passing vacuously. No design change — the artboards were already right. |

## Out of scope (confirmed)

- A light theme. The code ships one dark palette; the kit does not invent another.
- A mobile layout for the dashboard. It is an operator tool used from a desktop browser.

---

## Retired audits — the finding ledger

Three audit documents produced 46 numbered findings between 2026-09-19 and 2026-09-21 and were
**deleted on 2026-09-21** once every one of them had landed, been carded, or been ruled out. This
table replaces them: it is the record a later pass reads so it does not re-find what was already
decided.

**What was deliberately not kept:** the evidence prose — the quoted markup, the measured pixel
positions, the before/after counts. That material is *how* each finding was established, and it is
recoverable from git history (`design/DESIGN-AUDIT.md`, `design/MOTION-AUDIT.md`,
`design/LANDING-AUDIT.md` before their deletion commit). What survives here is the outcome, which
is what the next decision needs.

### Design audit — first pass

| # | Tag | Finding | Outcome |
|---|---|---|---|
| D2 | drift | Four status palettes, zero tokens | Landed |
| D3 | vice | The Logs page is a different design system | Landed |
| D4 | drift | 103 mono elements, no mono typeface | Landed — the stand-in is recorded as D18 above |
| D5 | vice | "By Model" conflates free with not-priced | Landed |
| D6 | drift | "Live Feed" on a table that never refreshes | Landed |
| D7 | vice | The front door shares nothing with the dashboard | Landed |
| D8 | slop | Landing-page headers on an operator tool | Landed |

### Design audit — second pass

| # | Tag | Finding | Outcome |
|---|---|---|---|
| D9 | gap | Down, empty and idle render identically | Landed |
| D10 | gap | A PWA with no offline state | Landed |
| D11 | gap | The hung request has no home | **Open** — on the project board |
| D12 | gap | Auto-refreshing data with no "as of" | Landed — the stamp's prominence became D38 |
| D13 | gap | The Errors table is last | Landed |
| D14 | lift | The product wrote one verdict and stopped | Resolved 2026-09-20 — see the note above |

### Design audit — third pass, with the exports in hand

| # | Tag | Finding | Outcome |
|---|---|---|---|
| D30 | vice | One label treatment, five jobs | Landed |
| D31 | vice | Errors leads on `length > 0` | Landed |
| D32 | vice | The Logs summary band never joined the system | **Open** — carded 2026-09-21 |
| D33 | drift | The kit export is three versions at once | **Open** — on the project board |
| D34 | drift | The Playground artboard draws a card the CSS stretches | **Open** — carded 2026-09-21 |
| D35 | vice | Fifteen type sizes, three spellings of one step | Landed — kit 0.3.0 |
| D36 | drift | `Last 7d` over eighteen hours of data | **Open** — on the project board |
| D37 | gap | The fold is not drawn | **Open** — on the project board |
| D38 | gap | The freshness stamp is the least visible thing on the page | **Open** — carded 2026-09-21. Its premise changed: `text-outline/60` emitted no CSS until the alpha-modifier fix |
| D39 | gap | No spacing scale in the kit | Landed — kit 0.3.0 |
| D40 | gap | Logs buries the aggregate the Overview promotes | **Open, half landed** — carded 2026-09-21. The stats band moved above the table; the `% ok` vs `% error` polarity did not |
| D41 | lift | The page's headline number never gets a verdict | **Open** — on the project board |
| D42 | lift | The card is not a component | Recorded above |

### Motion audit

| # | Finding | Outcome |
|---|---|---|
| D21 | The queue saturation bar animates a measurement | Landed |
| D22 | The drawer and its backdrop disagree on the way out | Out of scope — the mobile drawer, ruled out below |
| D23 | Everything opens on `ease-in-out` | Landed |
| D24 | The toggle is on a curve nothing else uses | Landed |
| D25 | `prefers-reduced-motion` is ignored | Landed |
| D26 | 35 hover targets, zero press states | Landed |
| D27 | The Logs spinner runs on a hidden page | Landed |
| D28 | 🐞 mobile drawer | Out of scope — ruled out below |
| D29 | 🐞 | Landed |

### Landing page audit

| # | Finding | Outcome |
|---|---|---|
| D50 | The landing page is the README with a stylesheet on it | Landed |
| D51 | 573 words of prose against one image | Landed — 299 words, five screenshots |
| D52 | Everything below the fold is motionless | Landed |
| D53 | The second thing a visitor reads is four things the product is not | Landed |
| D54 | The page has no scannable structure | Landed |
| D55 | No navigation | Landed |
| D56 | Eighteen of nineteen exports are unused, and the build knows one | Landed |
| D57 | The exports cannot be shipped as they are | Landed — crops in `assets/site/`, cut from the exports |
| D58 | The one screenshot that ships leads with a 15.4% error rate | Landed 2026-09-21. **The finding was wrong about the artefact**: the export is this flow's Pencil export, not a screenshot, so the fix was to redraw the artboard's dataset. Two code defects had to land first — alpha-modified colours emitted no CSS, and the expanded detail row rendered after the whole table |
| D59 | `design/README.md` says this surface does not exist | Landed |
| D60 | The API reference's logo fills the sidebar and lands on the home link | Landed in two parts — geometry, then the duplicate mark it left behind |

**Next free number: D62.** D15–D20, D43–D49 and D61 are this file's own and are above; D50–D60 are
spent by the landing audit.
