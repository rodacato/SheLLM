# SheLLM — Branding & Design System Guide

> Consolidated visual identity, assets, and design system reference.
> Replaces the legacy `branding/` folder (PNG-based, lower quality).
> Single source of truth for visual identity, tokens, and implementation rules.

---

## 1. Brand Identity

### Name

**SheLLM** — with the double L highlighted in the accent color. Wordplay: **Shell + LLM**.

### Logo Concept

```
  ───┐
  ───┤──◆──►>_
  ───┘
```

- **3 left lines:** Multiple LLM providers (Claude, Gemini, OpenAI/Cerebras)
- **Center node (`◆`):** SheLLM routing/unification layer
- **Chevron (`►`):** Output — single unified API
- **Prompt (`>_`):** Terminal/shell identity

### Wordmark

- `>_` as icon-to-text transition
- `She` in base color (white on dark, dark slate on light)
- `LLM` with both Ls in **Electric Cyan** (`#03E3FF`)

---

## 2. Color Palette

### Primary Colors

| Token | Hex | RGB | Usage |
|-------|-----|-----|-------|
| `primary-container` | `#03E3FF` | `3, 227, 255` | Electric Cyan — primary accent, CTAs, `LL` in logo, cursors, `>_` prompt |
| `surface` | `#101417` | `16, 20, 23` | Global base background (canvas) |
| `surface-container` | `#1C2023` | `28, 32, 35` | Cards, primary containers |
| `on-surface` | `#E0E3E7` | `224, 227, 231` | Primary text on dark backgrounds |

### Surfaces (Tonal Layering)

| Token | Hex | Level | Usage |
|-------|-----|-------|-------|
| `surface-dim` | `#101417` | Base | Global canvas |
| `surface-container-low` | `#181C1F` | Level 0.5 | Sidebar/main transition |
| `surface-container` | `#1C2023` | Level 1 | Primary content areas |
| `surface-container-high` | `#262A2E` | Level 2 | Active inputs, focused prompts |
| `surface-container-highest` | `#313538` | Level 3 | Modals, elevated elements |
| `surface-container-lowest` | `#0B0F12` | Level -1 | Code blocks, data wells |

### Accents & States

| Token | Hex | Usage |
|-------|-----|-------|
| `primary-container` | `#03E3FF` | Primary accent (Electric Cyan) |
| `primary-fixed-dim` | `#00DAF5` | Dim cyan variant |
| `on-primary` | `#00363E` | Text on cyan |
| `on-primary-fixed` | `#001F25` | Text on cyan (max contrast) |
| `tertiary-fixed-dim` | `#00E639` | Success / Terminal Green |
| `tertiary-container` | `#FEC730` | Warning / Amber |
| `error` | `#FFB4AB` | Error states |
| `error-container` | `#93000A` | Error container |
| `outline-variant` | `#3B494C` | Ghost borders (at 20-40% opacity) |
| `outline` | `#849397` | Secondary borders, disabled text |

### External Context Backgrounds

| Name | Hex | Usage |
|------|-----|-------|
| Dark BG | `#1A1E21` | Background for dark logo variants |
| Light BG | `#F0F4F7` | Background for light/mono logo variants |
| GitHub Dark | `#0D1117` | GitHub README dark mode match |
| GitHub Light | `#FFFFFF` | GitHub README light mode match |

---

## 3. Typography

| Family | Role | Weights | Usage |
|--------|------|---------|-------|
| **Space Grotesk** | Headlines & Labels | 300–700 | Titles, headers, labels. Wide apertures, technical premium feel. |
| **Inter** | Body & UI | 300–700 | Body text, data, interface. Maximum legibility at small scales. |
| **JetBrains Mono** | Code | 400–500 | Code blocks, terminal output, monospaced data. |

### Type Scale

| Level | Token | Size | Usage |
|-------|-------|------|-------|
| Display | `display-lg` | 3.5rem | Page titles — massive and immovable |
| Headline | `headline-md` | 1.5rem | Major sections |
| Title | `title-lg` | 1.375rem | Subsections |
| Body | `body-lg` | 1rem | Content text (line-height 1.6) |
| Body Small | `body-sm` | 0.75rem | Secondary data, terminal output |
| Label | `label-sm` | 0.6875rem | Metadata — ALWAYS `uppercase` + `letter-spacing: 0.15em` |

---

## 4. Design Principles

### Creative North Star: "The Architectural Terminal"

Architectural brutalism: structural integrity, geometric precision, uncompromising rejection of decorative fluff.

### Core Rules

1. **No gradients** — The UI should look like it was rendered on a high-end CRT monitor
2. **No shadows** — Hierarchy through background color shifts (tonal layering), never shadows
3. **No rounded border-radius** — Sharp edges (0px) to communicate professional-grade precision
4. **No 1px solid borders for sectioning** — Use background color shifts ("No-Line Rule")
5. **Ghost Borders** — Only where contrast is insufficient: `outline-variant` (#3B494C) at 20% opacity
6. **Linear, fast transitions** — Maximum 150ms, no bounce/spring animations
7. **Intentional asymmetry** — Don't center everything; use 5-column grid (1.5 sidebar + 3.5 content)

### Tonal Layering (Elevation Replacement)

To "lift" an element, change its background token — DO NOT add a shadow:
- Modal: `surface-container-highest` cutting against `surface`
- Card: `surface-container` over `surface`
- Code block: `surface-container-lowest` inside `surface-container`

---

## 5. Components

### Buttons

| Type | Background | Text | Border | Radius |
|------|-----------|------|--------|--------|
| Primary | `#03E3FF` | `#001F25` | None | 0px |
| Secondary | Transparent | `on-surface` | 1px `outline` | 0px |
| Tertiary | Transparent | `on-surface` | None, underline on hover | 0px |

- No smooth hover transitions — instantaneous on/off state change

### Cards

- Background: `surface-container` (`#1C2023`)
- Radius: 0px
- No internal dividers — use `2rem` vertical whitespace
- Hover: shift to `surface-container-low`

### Code Blocks

- Background: `surface-container-lowest` (`#0B0F12`)
- Border: ghost border (`outline-variant` at 20%)
- Include `>_` prompt as decorative brand mark in top-left

### Tags & Badges

- Typography: `label-sm`, uppercase, tracking-widest
- Radius: maximum 4px (the sharpest in the system)
- Success: `tertiary-fixed-dim` (`#00E639`)
- Error: `error` (`#FFB4AB`)
- Warning: `tertiary-container` (`#FEC730`)

### Terminal Input

- No container box — leading `>` prompt in cyan
- Blinking block cursor (not line)
- Error: entire text string shifts to `error`

### Diamond Node (Loading)

The logo's diamond node (`◆`) pulses in `primary-container` when the LLM is processing.

---

## 6. Iconography

- **Family:** Material Symbols Outlined
- **Style:** Line-based, 2px stroke, sharp joins
- **Settings:** `FILL: 0, wght: 400, GRAD: 0, opsz: 24`
- DO NOT use "soft" or humanist iconography

---

## 7. Assets — Inventory & Status

### Logo (requires SVG migration)

| Asset | Current Format | Target Format | Variant | Description |
|-------|---------------|---------------|---------|-------------|
| `logo-color` | PNG (1212×263) | **SVG** | Dark bg | Full logo: icon + `>_SheLLM` |
| `logo-mono` | PNG (1597×354) | **SVG** | Light bg | Full monochrome logo |
| `logo-icon-color` | PNG (196×136) | **SVG** | Dark bg | Icon only `>_` with node |
| `logo-icon-mono` | PNG (522×367) | **SVG** | Light bg | Monochrome icon only |

### Favicons (regenerate from SVG)

| Size | Dark | Light | Usage |
|------|------|-------|-------|
| 16×16 | `favicon-dark-16.png` | `favicon-light-16.png` | Browser tab |
| 32×32 | `favicon-dark-32.png` | `favicon-light-32.png` | Browser tab (retina) |
| 48×48 | `favicon-dark-48.png` | `favicon-light-48.png` | Windows taskbar |
| 64×64 | `favicon-dark-64.png` | `favicon-light-64.png` | Desktop shortcut |
| 128×128 | `favicon-dark-128.png` | `favicon-light-128.png` | Chrome Web Store |
| 180×180 | `favicon-dark-180.png` | `favicon-light-180.png` | Apple Touch Icon |
| 192×192 | `favicon-dark-192.png` | `favicon-light-192.png` | Android PWA |
| 256×256 | `favicon-dark-256.png` | `favicon-light-256.png` | Windows large icon |
| 512×512 | `favicon-dark-512.png` | `favicon-light-512.png` | PWA splash, Open Graph |

### Assets To Create

| Asset | Format | Description | Priority |
|-------|--------|-------------|----------|
| `logo-color.svg` | SVG | Full vector logo, dark bg | High |
| `logo-mono.svg` | SVG | Full vector logo, light bg | High |
| `logo-icon-color.svg` | SVG | Vector icon, dark bg | High |
| `logo-icon-mono.svg` | SVG | Vector icon, light bg | High |
| `logo-icon.svg` | SVG | Icon with transparent background | High |
| `logo-wordmark.svg` | SVG | Text-only `>_SheLLM` without icon | Medium |
| `favicon.svg` | SVG | Vector favicon (modern browsers) | High |
| `favicon.ico` | ICO | Legacy favicon (16+32 combined) | Medium |
| `og-image.png` | PNG 1200×630 | Open Graph / social media share | High |
| `og-image-dark.png` | PNG 1200×630 | OG image dark variant | Medium |
| `apple-touch-icon.png` | PNG 180×180 | iOS home screen (with padding) | High |
| `manifest-icon-192.png` | PNG 192×192 | PWA manifest | High |
| `manifest-icon-512.png` | PNG 512×512 | PWA manifest | High |
| `manifest-icon-512-maskable.png` | PNG 512×512 | PWA maskable with safe zone | Medium |
| `safari-pinned-tab.svg` | SVG monochrome | Safari pinned tab | Low |
| `mstile-150x150.png` | PNG 150×150 | Windows tiles | Low |
| `browserconfig.xml` | XML | Windows tile config | Low |
| `site.webmanifest` | JSON | PWA manifest with icons | High |

---

## 8. Target File Structure

```
assets/
├── logo/
│   ├── logo-color.svg              # Full logo, dark background
│   ├── logo-mono.svg               # Full logo, light background
│   ├── logo-icon-color.svg         # Icon only, dark background
│   ├── logo-icon-mono.svg          # Icon only, light background
│   ├── logo-icon.svg               # Icon only, transparent
│   └── logo-wordmark.svg           # Text only >_SheLLM
├── favicon/
│   ├── favicon.svg                 # Vector favicon
│   ├── favicon.ico                 # Legacy multi-size
│   ├── favicon-dark-{size}.png     # Dark favicons (16–512)
│   ├── favicon-light-{size}.png    # Light favicons (16–512)
│   └── apple-touch-icon.png        # 180×180
├── social/
│   ├── og-image.png                # 1200×630 Open Graph
│   └── og-image-dark.png           # Dark variant
├── pwa/
│   ├── manifest-icon-192.png
│   ├── manifest-icon-512.png
│   ├── manifest-icon-512-maskable.png
│   └── site.webmanifest
└── generate-assets.js              # Script to generate PNGs from SVGs
```

---

## 9. Files Referencing Branding (update on migration)

| File | What it references | Migration action |
|------|--------------------|------------------|
| `README.md` | `branding/assets/logo-color.png`, `logo-mono.png` | Point to `assets/logo/` with SVGs |
| `src/public/index.html` | `img/favicon-dark-*.png`, `img/logo-icon-color.png` | Point to `assets/favicon/` and `assets/logo/` |
| `src/public/img/` | Copies of favicons and logo icon | Replace with assets from `assets/` |
| `site/index.html` | `img/favicon-dark-*.png`, `img/logo-icon-color.png` | Point to `assets/favicon/` and `assets/logo/` |
| `docs/template.html` | `../img/favicon-dark-*.png` | Point to centralized assets |
| `.github/workflows/pages.yml` | `cp -r src/public/img site/` | Copy from `assets/` |
| `branding/` | Entire folder (legacy) | Delete after full migration |

---

## 10. HTML Reference Snippet

```html
<!-- Vector favicon (modern browsers) -->
<link rel="icon" type="image/svg+xml" href="/assets/favicon/favicon.svg">

<!-- Legacy favicon -->
<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon/favicon-dark-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/assets/favicon/favicon-dark-16.png">
<link rel="alternate icon" href="/assets/favicon/favicon.ico">

<!-- Apple Touch Icon -->
<link rel="apple-touch-icon" sizes="180x180" href="/assets/favicon/apple-touch-icon.png">

<!-- PWA -->
<link rel="manifest" href="/assets/pwa/site.webmanifest">
<meta name="theme-color" content="#101417">

<!-- Open Graph -->
<meta property="og:image" content="/assets/social/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">

<!-- Safari Pinned Tab -->
<link rel="mask-icon" href="/assets/favicon/safari-pinned-tab.svg" color="#03E3FF">

<!-- Microsoft -->
<meta name="msapplication-TileColor" content="#101417">
```

---

## 11. Do's & Don'ts

### Do

- Use the **color** variant on dark backgrounds for maximum impact
- Use the **mono** variant on light backgrounds and in print
- Use favicon/icon at sizes < 48px
- Maintain minimum clear space of 1× icon height on all sides
- Use SVG whenever the context allows
- Integrate the `>_` glyph into UI headers and empty states to reinforce terminal personality
- Use intentional asymmetry in layouts

### Don't

- Stretch, rotate, or skew the logo
- Change the cyan accent to another color
- Remove the `>_` prompt from the icon
- Use the full logotype below 48px — use favicon instead
- Add effects (shadows, glows, outlines, borders)
- Place color variant on light backgrounds or vice versa
- Use rounded border-radius (not even 2px)
- Use "soft" or humanist iconography
- Use gradients or shadows on any component
