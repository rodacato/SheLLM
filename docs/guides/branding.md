# SheLLM identity

The terminal prompt connects SheLLM's identity to what it does: translate a personal app's HTTP
request into an official CLI invocation. The cyan cursor repeats in the wordmark's two Ls. The
public [brand guide](https://rodacato.github.io/SheLLM/brand/) explains usage and offers downloads.

## Sources and exports

- [Mark](../../assets/logo/mark.svg) and [wordmark outlines](../../assets/logo/wordmark.svg) are the
  editable geometry. The wordmark uses Space Grotesk Bold outlines; it has no font dependency.
- [Social source](../../assets/brand/social-source.svg) holds the editable card composition and
  outlined lettering. Its empty wordmark group is filled by the generator.
- [Dashboard CSS](../../src/admin/public/css/custom.css) owns color roles. The generator reads
  them for every export and for the brand guide's generated stylesheet.
- [Generator](../../scripts/build-brand-assets.js) owns output dimensions, icon composition and
  copies served by the dashboard and API reference. Never hand-edit its outputs.

After changing geometry or tokens:

```bash
npm ci
npm run brand:build
npm run brand:check
```

Generation runs locally without network access, fonts, or a runtime build. `@resvg/resvg-js` is
a development dependency used only to export PNGs from SVG paths. CI checks the committed bytes.
The maskable composition keeps the mark inside the circular safe area and uses an opaque background.

## Preview and publication

The Pages workflow copies `assets/` into the site's relative base path. To preview without
publishing, assemble those copies as the workflow does, then serve `site/` under `/SheLLM/`.
The guide is `brand/`; it does not change the application entry point or the admin worker scope.

The landing's metadata references the generated social PNG. GitHub repository links use a
separate setting: upload `assets/brand/social.png` under **Settings → Social preview** after
reviewing the image. Generating or committing it does not publish that setting.

Space Grotesk is by Florian Karsten and distributed under the SIL Open Font License. The
[upstream font](https://github.com/google/fonts/tree/main/ofl/spacegrotesk) is not bundled; exported
lettering is editable path geometry. Preserve those paths when adjusting positioning and spacing.
