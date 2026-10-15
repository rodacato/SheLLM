# SheLLM brand

This folder is the source of SheLLM's identity: the editable geometry, the committed exports, and
this guide. Everything the dashboard, the API reference and the Pages site serve is a copy made
from here by [the generator](../../scripts/build-brand-assets.js). The public
[brand guide](https://rodacato.github.io/SheLLM/brand/) shows the same rules with downloads.

## Identity

The terminal prompt connects SheLLM's identity to what it does: translate a personal app's HTTP
request into an official CLI invocation. The shape follows that work: the prompt `>_`, straight
lines and a cyan accent. SheLLM is a tool, and it should look like one.

## Logo

- The chevron opens the prompt; the cyan line is the cursor and repeats in the wordmark's two Ls.
  Keep the cursor and the two Ls together.
- Keep the SVG geometry and proportions. Lettering is outlined Space Grotesk Bold: the logo needs
  no installed font.
- Leave clear space at least as high as the cursor around the logo.
- Use the mark alone only for the favicon and installed shortcuts. The maskable icon keeps an
  opaque background and the mark inside the circular safe area; use that file for Android.
- Primary use is the color logo on a dark surface. `logo-light.svg` uses the contrast cyan for
  light surfaces; `logo-mono.svg` is single ink.

## Color

Color is assigned by role, never by taste. The canonical values live in
[`custom.css`](../../src/admin/public/css/custom.css); [`tokens.css`](tokens.css) is a generated copy.

| Role | Token |
| --- | --- |
| Identity and actions | `primary-container` (cyan) |
| Cyan on a light background | `primary-on-light` |
| Background | `surface` |
| Grouped content | `surface-container` |
| OK · attention | `status-ok` · `status-warn` |
| Readable error text | `error` (keep `status-fail` for chart marks and indicators) |

Green, amber and red communicate state; they never replace text.

## Type and shape

Space Grotesk carries the name and the hierarchy; Inter carries the explanation; the system
monospace stack shows requests, commands and data. Square corners and space between groups keep
the character of a tool. Space Grotesk is by Florian Karsten under the SIL Open Font License; the
[upstream font](https://github.com/google/fonts/tree/main/ofl/spacegrotesk) is not bundled.

## Voice

Describe the result, the value and its limit, with concrete verbs. Explain what connects to what:
one owner's apps, their own subscriptions, the official CLIs and the two API formats. The API
equivalent is an estimate, not a charge or remaining quota; installing the dashboard is a
shortcut, not a promise of offline work. Never add endorsements, adoption figures or guarantees
the product cannot prove. All product copy is English.

## Marketing messaging

| Where | Message |
| --- | --- |
| Tagline | Your LLM subscription — as a REST API for your own apps |
| Social card | Your LLM subscriptions. One API for your own apps. Your apps → SheLLM → official CLI. |
| One-line description | SheLLM runs the official Claude Code or Codex CLI you already pay for behind one HTTP endpoint that speaks both the OpenAI and the Anthropic formats. |
| Framing | A personal project for experimenting on the subscriptions you already pay for, through the official, unmodified CLIs. |

The [landing page](../../site/index.html) is the long form. Keep its provider-risk and fair-use
qualifications whenever its copy is reused.

## Asset map

### Sources (edit these)

| File | What it is |
| --- | --- |
| [`logo/mark.svg`](logo/mark.svg) | The mark's editable geometry |
| [`logo/wordmark.svg`](logo/wordmark.svg) | Wordmark outlines (Space Grotesk Bold) |
| [`social/social-source.svg`](social/social-source.svg) | Social card composition; the generator fills its empty wordmark group |
| [`custom.css`](../../src/admin/public/css/custom.css) | Color roles, read for every export |
| [`kit/README.md`](kit/README.md) | README of the portable kit |

### Exports (generated, committed, never hand-edited)

| File | Use |
| --- | --- |
| `logo/logo-{dark,light,mono}.svg` | Lockups. `logo-dark.svg` is also the repository README's logo |
| `logo/icon-{color,dark,light,maskable}.svg` | Mark-only icons |
| `favicon/favicon.svg`, `favicon/favicon-{16…512}.png` | Favicons and PWA sizes |
| `social/social.{svg,png}` | Open Graph card and GitHub Social preview |
| `tokens.css` | Color tokens for the public brand guide |

### Runtime copies

| Copy | Made by |
| --- | --- |
| `src/admin/public/img/{logo-dark.svg,favicon.svg,favicon-{16,32,180}.png,icon-{192,512}.png,icon-512-maskable.png}` | Generator |
| `docs/api/logo.svg` | Generator (copied to `site/api/` by the Pages workflow) |
| `site/assets/{logo,favicon,brand}/` | [Pages workflow](../../.github/workflows/site-pages.yml), at deploy time (gitignored). Published URLs keep the `assets/brand/` path |
| `design/brand/dist/brand-kit/` and `brand-kit.zip` | `npm run brand:pack`, on demand (gitignored) |

Landing screenshots are not identity: they are crops of the admin captures and live in
[`assets/site/`](../../assets/site/README.md) with their provenance.

## Regenerate

After changing geometry or tokens:

```bash
npm ci
npm run brand:build
npm run brand:check
```

Generation runs locally without network access, fonts, or a runtime build. `@resvg/resvg-js` is
a development dependency used only to export PNGs from SVG paths. CI checks the committed bytes.

## Portable kit

`npm run brand:pack` checks the exports, then writes a self-contained kit (exports, editable
sources, the guide and the landing page with relative links, screenshots and the license) to
`design/brand/dist/brand-kit/` and zips it as `design/brand/dist/brand-kit.zip`. It packs the
working tree, needs the `zip` command, and is never committed. Recipients need no Node.js.

## Preview and publication

The Pages workflow copies these exports into the site's `assets/` and serves `site/` under
`/SheLLM/`. To preview without publishing, assemble those copies as the workflow does. The guide
is `brand/`; it does not change the application entry point or the admin worker scope.

The landing's metadata references the generated social PNG. GitHub repository links use a
separate setting: upload `social/social.png` under **Settings → Social preview** after reviewing
the image. Generating or committing it does not publish that setting.
