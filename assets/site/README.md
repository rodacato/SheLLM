# Landing page images

What `.github/workflows/pages.yml` copies into `site/img/`. They are **crops of the committed
admin captures in [`design/exports/`](../../design/exports/)**, not separate screenshots — so when
a capture is retaken, the crop is recut from it rather than captured again.

Every export is a 2× capture of a 1440 px-wide UI. The crops below drop the admin sidebar at
`x = 511`, because it repeats in each one and says nothing to someone who has not installed
anything yet.

| Crop | Cut from | Region `x, y, w, h` | Shows |
|---|---|---|---|
| `overview.png` | `admin-overview-default.png` | `0, 0, 2880, 1440` | The whole top band, sidebar included. Exactly 2:1, which is also why it is the OG card. |
| `request-logs.png` | `admin-request-logs-default.png` | `511, 300, 2369, 845` | Error rate, tokens and cost, then three rows and one expanded detail row. |
| `api-keys.png` | `admin-api-keys-default.png` | `511, 270, 2369, 420` | The three keys with limits, usage and expiry. |
| `playground.png` | `admin-playground-answered.png` | `511, 150, 2369, 480` | The client key, format and model beside an answered response. |
| `system.png` | `admin-system-default.png` | `511, 880, 2369, 700` | Both provider cards: CLI version, circuit state, last status, models. |

**Why crops and not the whole capture.** A full admin capture is 1,440 logical px wide. Rendered
in the page's 1,040 px measure it lands at 72%, and in a two-column grid at 17% — which is what
shipped once, and nothing in it was readable. A crop 1,185 logical px wide renders at 88% full
width, so the numbers can actually be read. The page's own check asserts this: no image may render
below 60% of the UI it depicts.

**The fold marker.** `admin-overview-default.png` carries a burned-in `FOLD · 1440×900` review rule
at `y ≈ 1780`. The `h = 1440` crop is above it. Anything recut taller has to deal with it.
