# B02 Checkpoint — First civic appearance (initial pass complete)

**Date:** 2026-09-23 · Mode: provisional candidates for the human civic/scale gate; nothing canonical.

| ID | Verdict | Note |
|---|---|---|
| `CG-S-MOT-BASALT` r001 | **Conforming candidate** | Four motif panels exemplary; flat elevations = the projection standard |
| `CG-S-INF-FARM` r001 | **Conforming candidate** | Six panels, three modes × two cameras correct |
| `CG-S-INF-ROAD` r001 | **Conforming candidate** | Track/Paved/Godway widths read clearly |
| `CG-S-BLD-DWELLING` | **Rejected this pass** | 3/4 drift in elevation cells (r001, r002) |
| `CG-S-BLD-HALL` | **Rejected this pass** | same (r001, r002) |
| `CG-S-UNT-CIVILIAN` | **Rejected this pass** | duplicated six-figure layout + portrait face (r001, r002) |

**Sharpened tool finding (TB-03):** template scaffolds fix layout; defective anchors dominate content. Retry strategy for the three rejected IDs: fresh generation (no r001 anchor) with blank 2×2 scaffold + conforming MOT-BASALT r001 as the elevation-projection exemplar, text carrying the design.

Counts: 9 candidates (6 initial + 3 repairs), 6 rejected, 3 awaiting approval, 0 approved. All hashes in `assets/arena_receipts.json`.

## Retry pass result (TB-03 strategy validated)

| ID | Retry | Verdict |
|---|---|---|
| `CG-S-BLD-DWELLING` | r003 (fresh, scaffold + BASALT exemplar) | **Conforming** — flat elevations fixed; minor flag: cluster slightly vertical vs 6×4×6 low ideal |
| `CG-S-BLD-HALL` | r003 (same strategy) | **Conforming** — all views flat; ridge/terraces/court correct |
| `CG-S-UNT-CIVILIAN` | r003 (fresh, scaffold only) | **Conforming with flag** — one figure per cell; face now only softly suggested (not strictly featureless) — gate to rule |

TB-03 confirmed: defective anchors were the sole cause of the earlier failures; fresh generation with conforming anchors + scaffold fixes both layout and projection. Six of six B02 IDs now have candidates awaiting the civic/scale gate. The face-suggestion question is a human call recorded in the ledger.
