# Operational state (restart pointer)

| Field | Value |
|---|---|
| Current milestone | **M03 - First complete God: CANDIDATE awaiting human review** ([evidence](evidence/M03.md)). B00/B01 approved by ruling HR-2026-09-23-01. All technical gates pass except FORM-Q top/left silhouette IoU, which is limited by two recorded non-orthographic references |
| Last accepted milestones | M02 ([evidence](evidence/M02.md)), M01 ([evidence](evidence/M01.md)), M00 ([evidence](evidence/M00.md)) |
| Branches | `m00-architecture-foundation` → `m01-simulation-kernel` → `m02-god-control` (stacked, all pushed). `claude/kind-cori-3sxtdg` fast-forwards `m02` and adds the re-verification record; it is proposed to `main` as a draft PR. Nothing is merged to `main` |
| Toolchain | Node 24.21.0 LTS / npm 11.19.0; Chrome 153 channel plus Playwright Firefox 155.0 and WebKit 26.6 (macOS host). Re-verified on Linux x86_64 with Playwright Chromium 141 only ([record](evidence/M02-reverification.md)) |
| Known-good journeys | Boot and error paths; browser determinism self-check; God control by pointer, keyboard and touch emulation (select, route around a city, feed, rest, cancel, consent override) with headless replay equality |
| Asset status | 285/285 IDs unresolved; no file sits at a canonical source path. Arena branch `arena/01a0d03e-civic-godstorm` at `6f07fd4` (checked 2026-09-23). B00 `CG-S-ART-DIRECTION`: human ruling `NO_AMENDMENT_RUN_STOPPED`. It stays BLOCKED because the available tool cannot meet the 1536×1024 floor, and r001/r002 must never be promoted. B01: TORSO-Q r003 and FORM-Q r004 are human-accepted as *provisional*. LOCO-PILLAR, FEED-BROWSE, SENSE-EYE-RING and TAIL-BALANCE are provisional batch-local references that are explicitly not approved sources. LIFE-Q is `REJECTED_THIS_PASS` (r001/r002 used a 3×3 layout, not the required 3×2), and a new pass needs authorization. The first-God identity gate and the 2048 px canonical resolution ruling are still open. Nothing is integrated here |

## Why work stops here (history: M03 was blocked before HR-2026-09-23-01)

The build prompt's milestone order is binding: "do not skip an earlier gate because a later task looks easier".

- **M03 needs sources.** The master (§19, M03) requires "B00+B01 approval" and forbids any primitive-stack or static-hierarchy substitute.
- **M04 comes after M03.** It also needs B02 for the first civic appearance.
- **Placeholders ended at M02.** The Arena production boundary allows development placeholders only through M02.

## Decisions required from you or the Arena workflow

1. **B00.** The human ruled out any amendment, so B00 stays BLOCKED in the Arena environment. M03 needs B00 approval, so M03 cannot start until `CG-S-ART-DIRECTION` is produced another approved way. The Arena agent reports its image tool cannot produce `CG-S-ART-DIRECTION` at the 1536 px native floor for REF-DIRECTION. Two routes remain: an image tool that can meet the floor, or the art produced another approved way. A contract change would need a master-plan amendment, and the human has already declined one.
2. **B01.** First, authorize a new `CG-S-GOD-LIFE-Q` pass. Then decide the resolution ruling: accept native 1024 px sheets, or hold 2048 px. Then canonical promotion of TORSO-Q r003, FORM-Q r004 and the four module references. Then the first-God identity approval.
3. **Integration of branches.** Whether to merge the draft PR from `claude/kind-cori-3sxtdg`, which carries M00-M02 unchanged plus the re-verification record, into `main`.

## Decisions now required (M03)

1. Art review of the six candidate models (`artifacts/inspection/*/c001/viewer.html`, `turntable.mp4`). Approval promotes them to INTEGRATED_VERIFIED.
2. The two reference conflicts in `docs/evidence/M03.md`: accept the recorded fit, or supply corrected FORM-Q top and side references.
3. Whether to spend the M03 repair pass on the eye-band strap, head length and tail length.

## Superseded plan (kept for history)

1. Intake the approved B00/B01 sources into `assets/source/god/` with provenance records.
2. Run the §18.1 feasibility probe with the local Blender 5.2.2 LTS on the macOS host. The Linux cloud container has no Blender.
3. Build the continuous Q mesh: identity anchors, real skin, seven poses, LODs, the glTF validator and reimport, and the offline inspector with a 144-frame turntable.
