# Landing page images

What `.github/workflows/pages.yml` copies into `site/img/`. The admin images are **crops of the
committed admin captures in [`design/exports/`](../../design/exports/)**, not separate screenshots —
so when a capture is retaken, the crop is recut from it rather than captured again. The two
`example-*.jpg` are the exception, below.

Every export is a 2× capture of a 1440 px-wide UI. The crops below drop the admin sidebar at
`x = 511`, because it repeats in each one and says nothing to someone who has not installed
anything yet.

| Crop | Cut from | Region `x, y, w, h` | Shows |
|---|---|---|---|
| `overview.png` | `admin-overview-default.png` | `0, 0, 2880, 1440` | The whole top band, sidebar included. Exactly 2:1, which is also why it is the OG card. |
| `request-logs.png` | `admin-request-logs-default.png` | `511, 354, 2369, 845` | Error rate, tokens and cost, then three rows and one expanded detail row. |
| `api-keys.png` | `admin-api-keys-default.png` | `511, 236, 2369, 904` | The connection row with the base URL, then the three keys with limits, usage and expiry — and the browser origin the middle one is scoped to. |
| `playground.png` | `admin-playground-answered.png` | `511, 140, 2369, 1384` | The whole exchange: key, format and model across one row, the prompt and its IMAGES line, and the answer below it with its status, round trip, tokens and request id. |
| `system.png` | `admin-system-default.png` | `511, 900, 2369, 660` | Both provider cards: CLI version, circuit state, last status, models. |

**Why crops and not the whole capture.** A full admin capture is 1,440 logical px wide. Rendered
in the page's 1,040 px measure it lands at 72%, and in a two-column grid at 17% — which is what
shipped once, and nothing in it was readable. A crop 1,185 logical px wide renders at 88% full
width, so the numbers can actually be read. Keep every admin image above 60% of the UI it depicts;
nothing checks it, so it holds only as long as a recut respects it.

**How a crop is cut.** There is no image tool in this repo and none is needed: a crop is a clipped
frame in `admin.pen` sized to the region, holding a copy of the artboard offset by the region's
origin, exported at the same 2x. The crop is then *derived* from the artboard by construction
rather than measured off a picture, which is what the paragraph below asks for. The frame is
temporary and is deleted once the PNG is written.

**A region here is a measurement, not a setting.** It tracks content that moves when the artboard
above it grows: adding the usage card to API Keys pushed the table down 668 device px, splitting
the Logs filter bar pushed its panels down 88, and putting the actions back on that filter row
pulled them up 34 again, and the Playground's IMAGES block grew its region by 104 — every one re-derived from the artboard's own bounds rather than nudged
until the picture looked right. Recut a crop whenever its source
artboard changes height, and update the row in the same commit — a stale region silently publishes
the wrong part of the screen.

**The fold marker.** `admin-overview-default.png` carries a burned-in `FOLD · 1440×900` review rule
at `y ≈ 1780`. The `h = 1440` crop is above it. Anything recut taller has to deal with it.

## The examples

`example-knotty.jpg` and `example-ai-town.jpg` are **live captures of the published apps**, not
crops: those apps have no artboards here. Both are 1280×800 viewports at 2×, JPEG quality 82,
taken with headless Chromium — Knotty after opening its *Librero* example, so the picture shows a
design and the chat rather than its landing hero; AI Town as it loads. They sit two across and
render near 40% of the UI, which is the point: they show what an app looks like, and nobody has to
read a number in them.

Retake one when its app changes enough that the picture lies about it. AI Town is light, so the
page's scanline overlay (`.crt-lines`) shows on it and on nothing else.
