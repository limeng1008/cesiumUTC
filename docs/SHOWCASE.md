# Feature gallery: capture notes

The [English README](../README.md#screenshots) and [Chinese README](../README.zh-CN.md#截图) use fresh browser captures from 24 September 2026. All displayed fields are imported **SAMI3 model output**, not observations. No raw dataset or runtime database is distributed with these images.

## Availability

The global overview, altitude slices, vertical sections, and single-time point profiles are in the published source. **Two-time derived comparison and derived temporal series are development previews from the local working version; their implementation is not yet in the published source.** Screenshots demonstrate that running version, not a promise that these two workflows are available after cloning the current repository.

## Reproduction settings

| Image | View and settings |
| --- | --- |
| `global-overview.png` | Global overview; 2019-04-25 12:00 UTC; interval content 90–1000 km; F2 search 200–600 km. Historical Kp is separately attributed to GFZ Potsdam in the interface. |
| `temporal-comparison.png` | Derived temporal preview; A 06:00 UTC, B 12:00 UTC on 2019-04-25; interval content 90–1000 km; full spatial extent; shared A/B scale and zero-centred difference scales. |
| `derived-time-series.png` | Derived temporal preview; 00:00–23:50 UTC on the same day, 144 frames; point 117.5°E / 37.5°N; interval content 90–1000 km; F2 search 200–600 km; maximum adjacent gap 30 minutes. The source-row table is collapsed using its normal control. |
| `vertical-section.png` | 12:00 UTC; fixed latitude 37.5°N; height 200–500 km; drawn region approximately 102.2–132.3°E / 25.6–43.4°N; regional linear scale. Probe approximately 117.481°E / 37.500°N / 316.67 km. |
| `altitude-profile.png` | Single-time analysis at 12:00 UTC; point 117.5°E / 37.5°N; global regional mean; 90–1000 km; log₁₀ electron-density axis. |
| `altitude-slices.png` | Same 12:00 UTC model frame and drawn region; 100/200/300/400 km geodetic slices; shared regional linear scale; scientific slice preset. |

The imported volume uses 72 × 36 × 32 cell-centred samples. Vertical sections use 129 × 128 interpolated samples; that is a display/sampling grid, **not additional source resolution**. Screenshots are cropped to complete application panels so local catalogue identifiers and unrelated controls do not distract from the feature. The scientific values, labels and colour maps are unchanged.

## Interpretation

- Interval electron content covers only the selected height range; it is not automatically full VTEC or GNSS STEC.
- NmF2, hmF2 and foF2 are derived from model Ne under the selected F2 window and quality rules; foF2 is not an ionosonde observation.
- A/B differences describe endpoint changes, not continuous evolution, anomaly detection or warnings. Small non-zero reference values can amplify relative percentages.
- Per-minute derived changes are not GNSS ROT/ROTI. Missing and invalid values are not replaced with zero.
- A redistributable sample dataset is not yet bundled. To reproduce the workflow, import a compatible dataset following [the setup guide](../SETUP.md); different model runs will produce different fields.

The existing GIF and MP4 remain an **earlier 3D workflow recording**; they were not re-recorded for this gallery update.
