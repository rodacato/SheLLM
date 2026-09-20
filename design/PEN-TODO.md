# Pen edits pending — 2026-09-20

> Disposable. Delete each line as it lands, delete the file when it is empty. The *why* stays in
> [DECISIONS.md](DECISIONS.md); this is only the edit list for the next Pencil session, written
> in a session where the MCP was unavailable.
>
> **The code moved first this time.** That inverts the source-of-truth rule in
> [README.md](README.md) deliberately, not by accident. Everything below is *mirroring what
> shipped*, never proposing something new — the one exception is called out.

## `flows/admin.pen`

- [ ] **Draw the sign-in screen** (D30). Source: [`src/admin/login.js:11`](../src/admin/login.js#L11).
      Band goes from *5 of 5* to *6 of 6*; the brief's entry-points line gains `/admin/login`.
      Three states, all in the code already: default, `Invalid credentials` (401),
      `Too many failed attempts. Try again in Ns.` (429). Copy verbatim, never invented.
- [ ] **The CRT layers.** Four, all `aria-hidden`, all decoration: a 40px dot grid drifting one
      cell over 20s, a breathing radial glow behind the panel, a 1px accent line sweeping top to
      bottom over 6s, and a static 1px/3px dark line texture over the whole frame. Under
      `prefers-reduced-motion` the first two freeze and the sweep is removed outright. The canvas
      cannot animate — draw the static frame and put the timings in the brief.
- [ ] **Re-mirror what the sign-in now shares with the app**: manifest link, `theme-color`,
      the apple meta, and safe-area insets on all four sides.
- [ ] **`Log` frame**: one line recording that the sign-in screen arrived in code first.

## `ui-kit.lib.pen`

- [ ] The sign-in page still declares its own nine aliases (`--bg`, `--panel`, `--accent`, …).
      That is **D20 and it is unresolved** — the kit must keep mirroring the alias set as it is,
      not quietly collapse it into the canonical names. A warning note citing D20.
- [ ] No new tokens. The CRT layers are alpha variants of `primary-container` produced with
      `color-mix`, plus one `rgba(0,0,0,.22)` for the line texture. If any of those earns a name,
      that is a decision, not a mirror — log it rather than adding it.

## Not a `.pen` edit, listed so it is not lost

- [ ] `manifest.webmanifest` `background_color` is the wrong token (D31). One-line code change.
- [ ] The maskable icon is the plain icon (P5 in [`docs/PWA-AUDIT.md`](../docs/PWA-AUDIT.md)).
      A real maskable 512 is an asset job: the mark inside the middle 60% on `surface-shell`.
      That one **is** new drawing, not mirroring.
