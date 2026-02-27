# SheLLM — Branding Guide

> Generated with [Nano Banana](https://nanobanana.ai) — February 2026

---

## Logo Concept

The SheLLM logo combines two core ideas:

1. **Multi-input routing** — Multiple lines (representing LLM providers) converge through a neural node into a single chevron arrow, symbolizing unification
2. **Terminal prompt** — The `>_` cursor reinforces the shell/CLI identity

The name **SheLLM** is typeset with the double-L visually distinct (highlighted in the accent color), emphasizing the **Shell + LLM** wordplay.

---

## Color Palette

### Primary Colors

| Name          | Hex       | RGB              | Usage                                   |
|---------------|-----------|------------------|-----------------------------------------|
| Cyan Accent   | `#03E3FF` | `3, 227, 255`   | Icon lines, `>_` prompt, highlighted LL |
| Dark BG       | `#1A1E21` | `26, 30, 33`    | Background for color/dark variants      |
| Light BG      | `#F0F4F7` | `240, 244, 247` | Background for mono/light variants      |

### Text & Content

| Name          | Hex       | RGB              | Usage                                   |
|---------------|-----------|------------------|-----------------------------------------|
| White         | `#FFFFFF` | `255, 255, 255` | Logotype text on dark background        |
| Dark Slate    | `#2E3B44` | `46, 59, 68`    | Icon and text on light background       |
| Black         | `#000000` | `0, 0, 0`       | Darkest content strokes                 |

### Extended Palette

| Name          | Hex       | Usage                                    |
|---------------|-----------|------------------------------------------|
| GitHub Dark   | `#0D1117` | README dark mode background match        |
| GitHub Light  | `#FFFFFF` | README light mode background match       |
| Terminal Green| `#00FF41` | Alternative accent (terminal aesthetic)   |
| Amber         | `#FFB800` | Warning/status indicators                |

---

## Logo Versions

### Color (Dark Background)

| Asset | Description | Dimensions | File |
|-------|-------------|------------|------|
| Full Logo | Icon + `>_SheLLM` text, dark bg | 1212 × 263 | `logo-color.png` |
| Icon Only | `>_` prompt symbol, dark bg | 196 × 136 | `logo-icon-color.png` |

- Cyan accent on icon and `LL`
- White logotype text
- Dark charcoal background (`#1A1E21`)

### Mono (Light Background)

| Asset | Description | Dimensions | File |
|-------|-------------|------------|------|
| Full Logo | Icon + `>_SheLLM` text, light bg | 1597 × 354 | `logo-mono.png` |
| Icon Only | `>_` prompt symbol, light bg | 522 × 367 | `logo-icon-mono.png` |

- Dark slate icon and text (`#2E3B44`)
- Light gray background (`#F0F4F7`)

### Favicons (Generated)

Pre-rendered at standard sizes for web, PWA, and platform icons.

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

---

## Icon Anatomy

```
  ───┐
  ───┤──◆──►>_
  ───┘
```

- **Left lines (3):** Multiple LLM providers (Claude, Gemini, OpenAI/Cerebras)
- **Center node (`◆`):** SheLLM routing/unification layer
- **Right chevron (`►`):** Output — single unified API
- **Prompt (`>_`):** Terminal/shell identity

---

## Typography

- **Logotype:** Sans-serif, geometric, medium weight
- **Double-L (`LL`):** Same font, accent color — visual signature
- **Underscore (`_`):** Terminal cursor, icon-to-text transition

---

## Usage Guidelines

### Do
- Use **color** variant on dark backgrounds for maximum impact
- Use **mono** variant on light backgrounds and in print
- Use favicon/icon at sizes < 48px
- Use full logotype when space allows
- Maintain clear space (min 1× icon height on all sides)

### Don't
- Stretch, rotate, or skew the logo
- Change the cyan accent to another color
- Remove the `>_` prompt from the icon
- Use the full logotype below 48px — use favicon instead
- Add effects (shadows, glows, outlines, borders)
- Place color variant on light backgrounds or vice versa

---

## File Structure

```
branding/
├── BRANDING.md                    # This file
├── crop-assets.js                 # Favicon generation script (requires sharp)
└── assets/
    ├── logo-color.png             # Full logo, dark bg     (1212×263)
    ├── logo-mono.png              # Full logo, light bg    (1597×354)
    ├── logo-icon-color.png        # Icon only, dark bg     (196×136)
    ├── logo-icon-mono.png         # Icon only, light bg    (522×367)
    ├── favicon-dark-{size}.png    # Dark favicons (16–512)
    └── favicon-light-{size}.png   # Light favicons (16–512)
```

---

## Quick Reference — HTML

```html
<!-- Favicon -->
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-dark-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-dark-16.png">

<!-- Apple Touch Icon -->
<link rel="apple-touch-icon" sizes="180x180" href="/favicon-dark-180.png">

<!-- PWA Manifest icons -->
<!-- { "src": "/favicon-dark-192.png", "sizes": "192x192", "type": "image/png" } -->
<!-- { "src": "/favicon-dark-512.png", "sizes": "512x512", "type": "image/png" } -->

<!-- Open Graph -->
<meta property="og:image" content="/favicon-dark-512.png">
```

---

## Generation Prompt

The logo was generated using this prompt (for reference/regeneration):

> Design a minimal, modern logo for **"SheLLM"** — an open-source developer tool that unifies multiple LLM providers (Claude, Gemini, OpenAI, Cerebras) behind a single REST API. It acts as a smart shell/proxy that routes AI requests.
>
> **Concept keywords:** terminal/shell, API gateway, unification, routing, proxy
>
> **Visual direction:**
> - Combine a terminal/shell prompt (`>_`) with a neural/routing element (converging lines, node)
> - "A shell that speaks LLM" — multiple inputs converging into one clean output
>
> **Style:**
> - Clean, geometric, minimal — works at 16px favicon and on dark terminal backgrounds
> - Monochrome base + electric cyan accent (`#03E3FF`)
> - Developer/hacker aesthetic, not corporate
> - "SheLLM" with visually distinct double-L (accent color)
>
> **Deliverables:** Color (dark bg) + mono (light bg), full logo + icon only
>
> **Avoid:** chatbot bubbles, robot faces, complex gradients, clip-art
