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

## Unreleased — blank starter

`ui-kit.lib.pen` is an empty canvas. **0.1.0** is cut when the first Pencil session lifts the
tokens (surface scale, primary cyan, on-surface text, outline, error; Space Grotesk + Inter; 0px
radius) and the core components from `src/admin/public/index.html`, and vendors them into
`flows/admin.pen`.
