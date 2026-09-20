# ui-kit.lib.pen — Changelog

Pencil can't reference components across `.pen` files, so each `flows/*.pen` **vendors** the
kit at a pinned version via the install script — it does NOT link live. Bumping here means
flows on an older version may need a re-sync.

**Version markers:** `kit-version` variable lives in `ui-kit.lib.pen`; each flow records the
version it vendored in `kit-version-source`.

**Bump rules:** patch = token value tweak · minor = new/changed token or component ·
major = breaking rename/removal. Additive bumps don't force re-syncs — being behind is fine,
diverging is not. A changed token VALUE forces every consumer.

---

## 0.3.0 — 2026-09-20 · size and space finally have names

Twenty-one tokens, and not one of them changes a pixel: seven type steps, three icon sizes and
the eleven spacing steps the dashboard actually spends. D35 and D39 closed together, because they
are the same gap seen from two sides — the kit could say what colour a card is and not how big its
title is or how far it sits from the next one.

**What the code decided first.** The scale was collapsed in code before it was named here
(`fa9a87d`): a 9px footer and an icon written `text-base` while its four siblings were
`text-[16px]` were the last two sizes used exactly once. Naming a scale that still had them would
have blessed them. A test now fails on an eighth text step, and on an icon size used on something
that is not an icon.

**Names follow the code where the code has one** — `text-xs`, `text-sm`, `text-lg`, `text-xl`,
`text-2xl` are Tailwind's own. The two the code can only write as bracket values get a role name
instead of a px name: `text-label` is the 120-use eyebrow and card title, `text-meta` the mono
metadata line. Spacing is named in px (`space-20`, not `space-5`) because that is the unit the
canvas takes, and the class each one comes from is drawn next to it.

`icon-18` and `text-lg` are both 18, and both stay: an icon at 18 is not a heading at 18, and the
test keeps the bracket forms on `material-symbols` spans so the two cannot quietly merge.

Forced on consumers: nothing renders differently, so `flows/admin.pen` may install these when it
next needs them rather than immediately.

## 0.2.1 — 2026-09-20 · the canvas caught up with 0.2.0's own changelog

`brand-hover` was gone from the flow and still on the kit — as a variable **and** as a swatch
labelled *"brand-hover (renamed → primary-container-hover)"*, beside the token that replaced it.
0.2.0 said the rename happened; only the consumer's half of it did. Removed here, which is a
removal in name only: `flows/admin.pen` never carried it after the 0.2.0 re-vendor (verified —
zero nodes reference `$brand-hover`, and the variable is absent from the flow), so nothing is
forced on anyone and the bump stays a patch. The Brand section's note now names
`primary-container-hover`, which is still the truth it was telling: `custom.css` declares it and
the Tailwind config does not.

Also here, from D33 (the export named `0.2.0` was the `0.1.1` canvas and its header said `0.1.0`):
**the version string lives in exactly one place on the canvas**, the Provenance line under the
title, and `exports/ui-kit-tokens-0.2.1.png` is cut from this canvas. The stale
`ui-kit-tokens-0.2.0.png` is deleted rather than kept — an export that names a version it is not
is worse than no export. The `0.1.1` and *Named in 0.2.0* notes stay: they date specific tokens,
they do not claim to be the kit's version.

Added: a note citing **D20** — the sign-in page ships nine aliases of its own instead of reading
this palette, a test pins each one to the canonical value, and the kit mirrors that rather than
collapsing them.

### Open kit gap logged here

`flows/admin.pen` carries exactly one hex **value**, `#03e3ff00`, in the sign-in sweep — on all
three Sign in artboards since the error band copied that screen twice (2026-09-20), which is the
same gap three times over, not three gaps. A gradient needs a fully transparent stop and the kit
has no token for one — the code does not name it either
(`color-mix(in srgb, var(--accent) 18%, transparent)`), so naming it would be a decision, not a
mirror. Logged, not fixed.

## 0.2.0 — 2026-09-20 · the colours that had no name

Seven tokens added, six of them because the code finally names them. D19 closed by declaring
`surface-shell`, `nav-selected`, `error-container`, `danger-surface` and `danger-surface-hover`
in `custom.css` and having the Tailwind config read them; `white` mirrors Tailwind's own built-in,
which the markup uses 38 times, and `primary-container-hover` replaces the kit-local `brand-hover`
now that the code declares it under that name.

The kit stops being ahead of the code here. Every colour on the five drawn screens resolves to a
declaration in `:root`, so a re-vendor can diff against the code rather than against memory.

Forced on consumers (new tokens, and one rename): `flows/admin.pen` re-vendored at 0.2.0. Its four
`*-UNTOKENISED` locals are gone — 58 nodes repointed, then read back for dangling references. The
suffix earned its keep: it made this re-vendor surface them instead of letting them pass as though
the kit had always carried them.

## 0.1.1 — 2026-09-20 · two token values were not valid

`status-ok-fill` and `overlay-scrim` were stored as `rgba(34,197,94,0.12)` and
`rgba(0,0,0,0.6)`. `SetVariables` accepted them, and the swatches rendered dark enough that
nothing looked wrong — but the `.pen` schema takes hex only (`#RGB`, `#RRGGBB`, `#RRGGBBAA`), so
neither was a colour. Corrected to `#22c55e1f` and `#00000099`.

The code is not wrong: `rgba()` is correct in CSS. The same colour has two notations, one per
medium, and only the kit has to carry the `.pen` one. Found by reading the schema after an
unrelated validation error — not by looking at the canvas, where it was invisible.

Forced on consumers (a changed value): `flows/admin.pen` re-pinned to 0.1.1.

## 0.1.0 — 2026-09-20 · tokens

Every token mirrored from the code, measured rather than eyeballed. No components yet: the
kit carries the palette, the type and the radius scale, and nothing that was not in the code.

**Sources.** `src/admin/views/index.html` (`tailwind.config`, line 23) and
`src/admin/public/css/custom.css`. The path in the old note (`src/admin/public/index.html`) no
longer exists — the SPA was split into `views/`.

**Installed.** 6 surface steps · 5 content · 3 brand · 4 status · 4 badge/scrim · 3 font
families · 2 radius steps · the 5 `grid-*` canvas constants. 34 variables.

**Names follow the code.** `surface-container-high`, not `surface-3`. Where the code names a
value only through a CSS class, the class named the token: `.badge-2xx` → `badge-2xx-bg`,
`.btn-brand:hover` → `brand-hover`, `.modal-overlay` → `overlay-scrim`.

**Status colours are aliased twice in the code** — declared as CSS custom properties in
`custom.css` and re-exported through the Tailwind config as `var(--status-ok)`. The kit mirrors
the CSS declaration, which is the one Chart.js reads.

### Open kit gaps — measured, not impressions

Five hex literals in `src/` have no name in the Tailwind config. Counts are every occurrence
under `src/` on 2026-09-20, `.webmanifest` included:

| Value | Uses | Where | What it is |
|---|---|---|---|
| `#1a1e21` | 5 | `views/index.html` ×3 (meta theme-color, mobile bar, sidebar) · `public/manifest.webmanifest` ×2 | **The shell surface** — sidebar, mobile top bar, PWA theme colour. A distinct surface step the six-step scale does not contain, and the only gap that also escapes the app into the installed-PWA chrome. The largest one. |
| `#2e3b44` | 2 | `views/index.html` | Active and hover background of a nav item |
| `#3a1d1d` | 1 | `pages/overview.html` | `USAGE LIMIT HIT` banner background |
| `#3b1a1a` / `#4a2020` | 1 each | `pages/logs.html` | `Clear All` background and its hover |

Not tokenised yet: naming them is a design call, logged as **D19**. The kit mirrors current
code, so it stays without them until that lands.

**Resolved by cutting this version:** `D1` (where the tokens live) now has a measured answer.
**Logged while cutting it:** `D18` (the mono family has no renderable equivalent), `D19` (the
five unnamed literals above).

**Fixed in code, not in the kit:** `--outline` was read by `overview.js` and never declared, so
the charts always fell through to a retyped `#849397`. Declared in `custom.css` on branch
`chart-outline-token`.
