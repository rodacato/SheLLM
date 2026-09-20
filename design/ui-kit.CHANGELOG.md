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
