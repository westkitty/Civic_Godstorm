# Operational state (restart pointer)

| Field | Value |
|---|---|
| Current milestone | **M03 - First complete God: BLOCKED** on missing human approval of Arena batches B00 (art direction) and B01 (first Q body) |
| Last accepted milestones | M02 ([evidence](evidence/M02.md)), M01 ([evidence](evidence/M01.md)), M00 ([evidence](evidence/M00.md)) |
| Branches | `m00-architecture-foundation` → `m01-simulation-kernel` → `m02-god-control` (stacked, all pushed). None is merged to `main` |
| Toolchain | Node 24.21.0 LTS / npm 11.19.0; Chrome 153 channel plus Playwright Firefox 155.0 and WebKit 26.6 |
| Known-good journeys | Boot and error paths; browser determinism self-check; God control by pointer, keyboard and touch emulation (select, route around a city, feed, rest, cancel, consent override) with headless replay equality |
| Asset status | 285/285 IDs unresolved. Arena branch `arena/01a0d03e-civic-godstorm` at `580610d` (fetched 2026-09-23): all 121 receipts are still `SPECIFIED`; nothing is approved and no file sits at a canonical source path. B00 `CG-S-ART-DIRECTION` BLOCKED (tool below the 1536 px floor). B01 provisional candidates awaiting the human gate: LOCO-PILLAR r002, FEED-BROWSE r001, SENSE-EYE-RING r002, TAIL-BALANCE r002, TORSO-Q r003. FORM-Q rejected this pass (rear-view tail droop); LIFE-Q not generated. Nothing is integrated here |

## Why work stops here

The build prompt's milestone order is binding: "do not skip an earlier gate because a later task looks easier".

- **M03 needs sources.** The master (§19, M03) requires "B00+B01 approval" and forbids any primitive-stack or static-hierarchy substitute.
- **M04 comes after M03.** It also needs B02 for the first civic appearance.
- **Placeholders ended at M02.** The Arena production boundary allows development placeholders only through M02.

## Decisions required from you or the Arena workflow

1. **B00.** The Arena agent reports its image tool cannot produce `CG-S-ART-DIRECTION` at the 1536 px native floor for REF-DIRECTION. Options are to supply a capable image tool, approve a specific amendment to the §17.2 normalisation rule, or have the art produced another approved way. Changing the contract requires a master-plan amendment.
2. **B01.** Human review of the five provisional Q-module candidates (including TORSO-Q r003), a conforming `CG-S-GOD-FORM-Q` (rejected so far: rear-view tail droop), then `CG-S-GOD-LIFE-Q`, then the first-God identity approval.
3. **Integration of branches.** Whether to open PRs or merge `m00` → `m01` → `m02` into `main`.

## Next bounded action once unblocked (M03)

1. Intake the approved B00/B01 sources into `assets/source/god/` with provenance records.
2. Run the §18.1 feasibility probe with the local Blender 5.2.2 LTS.
3. Build the continuous Q mesh: identity anchors, real skin, seven poses, LODs, the glTF validator and reimport, and the offline inspector with a 144-frame turntable.
