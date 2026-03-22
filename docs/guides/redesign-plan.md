# Redesign Implementation Plan

SheLLM visual identity migration. Each phase is a single atomic commit —
no phase leaves broken asset references or mixed token sets.

---

## Design Decisions (resolved)

| # | Decision | Choice |
|---|---|---|
| D1 | Spec for GitHub Pages (landing + API docs) | `terminal_core` — 0px radius, #101417 base |
| D2 | Spec for Admin Dashboard | `shell_syntax` — 10px radius, #101417 base |
| D3 | Color base | `#101417` everywhere (replaces `#1A1E21`) |
| D4 | Web fonts | Google Fonts CDN (Space Grotesk + Inter) |
| D5 | Missing admin features | Documented in `BACKLOG.md` |
| D6 | Asset migration | Atomic per-phase — no broken refs between commits |

---

## Token Reference

### terminal_core (GitHub Pages)

| Token | Hex | Usage |
|---|---|---|
| `surface` | `#101417` | Page background |
| `surface-container` | `#1C2023` | Primary content areas |
| `surface-container-high` | `#262A2E` | Focused inputs |
| `surface-container-lowest` | `#0B0F12` | Code blocks |
| `surface-container-highest` | `#313538` | Modals |
| `primary-container` | `#03E3FF` | Cyan accent |
| `on-primary` | `#00363E` | Text on cyan |
| `on-surface` | `#E0E3E7` | Primary text |
| `outline-variant` | `#3B494C` | Ghost borders (20% opacity) |
| `error` | `#FFB4AB` | Error states |
| `tertiary-fixed-dim` | `#00E639` | Success |
| `tertiary-container` | `#FEC730` | Warning |

### shell_syntax (Admin Dashboard)

| Token | Hex | Usage |
|---|---|---|
| `surface` | `#101417` | Page background |
| `surface-container` | `#1C2023` | Cards (10px radius) |
| `surface-container-low` | `#181C1F` | Sidebar |
| `surface-container-lowest` | `#0B0F12` | Code blocks (10px radius) |
| `surface-container-highest` | `#313538` | Modals |
| `primary-container` | `#03E3FF` | Cyan accent |
| `on-primary-fixed` | `#001F25` | Text on cyan |
| `on-surface` | `#E0E3E7` | Primary text |
| `outline-variant` | `#3B494C` | Ghost borders (40% opacity) |
| `error` | `#FFB4AB` | Error badges |
| `tertiary-fixed-dim` | `#00E639` | Success badges |
| `tertiary-container` | `#FEC730` | Warning badges |

---

## Phase 1 — Asset Migration

**Goal:** Move all static assets to the `assets/` structure. Zero broken references.

### Files to create / move

```
assets/
├── logo/
│   ├── logo-icon-color.png     ← MOVE from src/public/img/logo-icon-color.png
│   ├── logo-icon-mono.png      ← MOVE from branding/assets/logo-icon-mono.png
│   ├── logo-color.png          ← MOVE from branding/assets/logo-color.png
│   └── logo-mono.png           ← MOVE from branding/assets/logo-mono.png
└── favicon/
    ├── favicon-dark-16.png     ← MOVE from src/public/img/favicon-dark-16.png
    ├── favicon-dark-32.png     ← MOVE from src/public/img/favicon-dark-32.png
    ├── favicon-dark-180.png    ← MOVE from src/public/img/favicon-dark-180.png
    └── (all other sizes)       ← MOVE from branding/assets/
```

### Files to CREATE (don't exist yet — manual work required)

| Asset | Format | Tool | Notes |
|---|---|---|---|
| `assets/logo/logo-color.svg` | SVG | Figma / Stitch | Vector version of dark logo |
| `assets/logo/logo-mono.svg` | SVG | Figma / Stitch | Vector version of light logo |
| `assets/logo/logo-icon-color.svg` | SVG | Figma / Stitch | Icon only, dark |
| `assets/logo/logo-icon-mono.svg` | SVG | Figma / Stitch | Icon only, light |
| `assets/logo/logo-icon.svg` | SVG | Figma / Stitch | Icon, transparent bg |
| `assets/favicon/favicon.svg` | SVG | Figma / Stitch | Vector favicon |
| `assets/social/og-image.png` | PNG 1200×630 | Figma / Stitch | Open Graph image |
| `assets/pwa/site.webmanifest` | JSON | Manual | PWA manifest |

> **Blocker:** SVG logos don't exist yet. Phase 1 moves existing PNGs and updates references.
> SVG migration is a follow-up once the SVGs are created.

### Files to UPDATE (reference changes only)

| File | Change |
|---|---|
| `src/public/index.html` | `img/` → `../../assets/` paths |
| `src/admin/public/index.html` | `img/` → `../../assets/` paths |
| `site/index.html` | `img/` → `assets/` paths |
| `docs/template.html` | `../img/` → `../assets/` paths |
| `.github/workflows/pages.yml` | `cp -r src/public/img site/` → `cp -r assets/favicon assets/logo site/` |
| `README.md` | `branding/assets/` → `assets/logo/` |

### Deliverable

One commit. After it lands: `branding/` folder can be deleted (it becomes dead code).

---

## Phase 2 — GitHub Pages Redesign (`terminal_core`)

**Source:** `docs/screens/shellm_landing_page_unified_rest_api_for_cli_llms/code.html`
**Target:** `site/index.html`

### Rules (terminal_core)
- Border radius: **0px** everywhere
- No shadows, no gradients
- No 1px dividers — tonal layering only
- Ghost borders: `#3B494C` at 20% opacity only where tonal contrast is insufficient
- Fonts: Space Grotesk (headers) + Inter (body) from Google Fonts
- Base surface: `#101417`

### Steps

1. Replace `site/index.html` content with adapted version of Stitch landing HTML
   - Keep all existing sections: hero, value prop, providers, quick start, comparison table, footer
   - Apply `terminal_core` tokens (replace old `#1A1E21` / `#2E3B44` with new palette)
   - Remove any rounded corners
   - Add Google Fonts `<link>` tags (Space Grotesk + Inter)
2. Update `redocly.yaml` theme tokens to `terminal_core` palette
3. Update `docs/template.html` background and scrollbar colors

### Deliverable

One commit. GitHub Pages auto-deploys on push to master.

---

## Phase 3 — Admin Dashboard Redesign (`shell_syntax`)

**Sources:**
- Layout reference: `docs/screens/shellm_admin_dashboard_shell/code.html`
- Logs table: `docs/screens/shellm_admin_request_logs/code.html`
- API Keys + modal: `docs/screens/shellm_admin_api_keys_management/code.html`
- Models page: `docs/screens/models_shellm_admin_dashboard/code.html` *(strip Mistral/Ollama)*

**Target:** `src/admin/public/index.html` + `src/admin/public/css/custom.css`

### Rules (shell_syntax)
- Border radius: **10px** on cards and code blocks, **8px** on buttons and inputs, **4px** on badges
- No shadows, no gradients
- Ghost borders: `#3B494C` at 40% opacity on inputs and code blocks
- Fonts: Space Grotesk + Inter from Google Fonts
- Base surface: `#101417`
- Sidebar: `surface-container-low` (`#181C1F`) — NOT the same as the page bg

### Critical constraint

**The Alpine.js logic must not change.** The files `js/app.js`, `js/overview.js`, `js/logs.js`,
`js/keys.js`, `js/models.js` are not touched. Only `index.html` markup and `css/custom.css`
change. Any `x-data`, `x-model`, `@click`, `:class` bindings must be preserved exactly.

### Steps

1. Update `tailwind.config` block in `<script>` with `shell_syntax` tokens
2. Add Google Fonts `<link>` tags (Space Grotesk + Inter)
3. Rebuild sidebar: `surface-container-low` bg, active item `surface-container` + left border cyan
4. Rebuild provider cards: `surface-container` bg, 10px radius, toggle preserved, tonal hover
5. Rebuild queue card: same token treatment
6. Rebuild stats/metrics cards: same
7. Rebuild all tables (logs, keys, models): header row `surface-container-low`, row hover subtle tonal shift
8. Rebuild modals: `surface-container-highest` bg, inputs with ghost borders
9. Update `custom.css`: replace all color hardcodes with new tokens, update dot colors, badge colors
10. Add `SYSTEM_STATUS: READY` footer line to sidebar (static text — cosmetic, no backend)

### What NOT to implement (see BACKLOG.md)
- Mistral AI / Ollama cards → use real providers only
- "Setup" / "Configure" buttons for unconnected providers
- Context window column in models table
- Real-time terminal log feed
- Quick Operations panel (Export Logs → BACKLOG, New Deployment → out of scope)
- Security alert widget

### Deliverable

One commit. Admin dashboard at `/admin/dashboard/` uses new visual design,
all existing functionality preserved.

---

## Phase 4 — Landing page runtime (`src/public/index.html`)

The runtime landing (served by the running SheLLM instance at `/`) is separate from
the GitHub Pages landing. Apply `terminal_core` tokens here too for visual consistency,
but keep it minimal — it only needs hero + two CTAs (API Docs + Admin Dashboard).

### Steps

1. Update background and text colors to `terminal_core` tokens
2. Add Google Fonts (same as Pages landing for consistency)
3. Remove border radius from buttons

### Deliverable

One commit. Small change — this page is already minimal.

---

## Execution order

```
Phase 1 → Phase 2 → Phase 3 → Phase 4
```

Phase 1 is the prerequisite for all others (asset paths). Each phase is independently
testable — preview locally before pushing.

---

## Testing each phase

```bash
# Phase 1 — verify no broken img references
grep -r "branding/assets\|src/public/img" site/ src/ docs/

# Phase 2 — preview GitHub Pages landing
open site/index.html
npm run docs:preview    # verify Redocly theme

# Phase 3 — preview admin dashboard
open src/admin/public/index.html    # open directly in browser with mock data
shellm start && open http://localhost:6100/admin/dashboard/   # with real data

# Phase 4 — preview runtime landing
shellm start && open http://localhost:6100/
```
