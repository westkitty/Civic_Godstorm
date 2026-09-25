# Operational state (restart pointer)

This is the only current-state file. Everything under "Historical" is superseded and is kept for the record only.

| Field | Value (as of 2026-09-25) |
|---|---|
| Current milestone | **M03 - First complete God: CANDIDATE, not accepted; primary pass and the single repair pass are both spent.** Revision c003 (repair) supersedes c002 (primary re-run on current sources). See [evidence](evidence/M03.md) |
| Last accepted milestone | M02 at `c115d7b` (`m02-god-control`); M01 `2106b25`, M00 `e7cb713`/`a22c0c6` ([M02](evidence/M02.md), [M01](evidence/M01.md), [M00](evidence/M00.md)) |
| Implementation branch | `claude/kind-cori-3sxtdg` (lineage `main 5bd357e → M00 → M01 → M02 → claude/kind-cori-3sxtdg`). Draft PR #1 targets `main`; nothing is merged |
| Arena branch / intake pin | `arena/01a0d03e-civic-godstorm` at `15c6f1b232d339e7195d17477737f7183faa06a1`; ledger `assets/arena_receipts.json` SHA-256 `09ff3e26…1739`. Pin lives in `tools/assets/intake.ts` |
| Owner rulings (2026-09-25) | OR-2026-09-25-01..05, recorded verbatim in `assets/provenance.json` (`ownerRulings`). They postdate the Arena pin and are not yet in the Arena ledger |
| Authored sources | **119/121 APPROVED_SOURCE** at canonical paths, each verified against its receipt `canonical_sha256`. `CG-S-ART-DIRECTION` absent: **B00 reopened** by OR-2026-09-25-01, which lifts `B00_BLOCK_FINAL`. A new compliant board is required from Arena (the pinned ledger still reads BLOCKED). `CG-S-GOD-LIFE-S` unresolved (r001-r004 rejected). `CG-S-GOD-LIFE-Q` r005 is canonical in the ledger but ruled **continuity drift to be corrected/replaced** (OR-2026-09-25-02). B02 is present as sources only; M04 not started |
| Derived (M03) | Six Q models, revision c003, all **DERIVED_UNVERIFIED**. Five modules pass every technical gate. FORM-Q: front 0.946, rear 0.927 pass; **top 0.803 fails** (landmark 0.041); identity, deformation, validator, reimport and inspector pass. Human art approval: pending (OR-2026-09-25-04: direction acceptable in principle, final approval conditional on seeing the outputs) |
| Registries | `assets/manifest.json` 119 verified source files; `assets/missing.json` 166 unresolved (2 authored, 112 derived incl. the six candidates, 52 recipes); `assets/provenance.json` records source closure (`sourceSha256`) per derived candidate |
| Toolchain | Node 24.21.0 (`.toolchain/node-v24.21.0-darwin-arm64`); Python 3.11 venv `.toolchain/py` with `tools/models/requirements.txt` (bpy 4.5.14 LTS); Google Chrome for evidence capture; Playwright Chrome/Firefox/WebKit for e2e. macOS arm64 host |

## Commands run for this state (2026-09-25, macOS arm64)

| Command | Result |
|---|---|
| `node tools/assets/intake.ts --check` | 0: 119 canonical sources verified; absent LIFE-S (REJECTED), ART-DIRECTION (BLOCKED in pinned ledger; reopened by owner) |
| `npm run typecheck`, `npm run lint` | 0, 0 |
| `npm run test:unit` | 0: 47/47 |
| `npm run test:sim` | 0: 59/59 (run on c002; no simulation code changed since) |
| `npm run test:assets` | 0: 119/121 authored approved, 0/112 derived verified, 166 unresolved |
| `npm run build` | 0 |
| `npm run test:e2e` | 0: 39 passed, 1 skipped (Firefox has no touch emulation), on the c003 GLBs |
| `tools/models/fit_form.py --passes 8 --write` (repair pass) | coarse top 0.763 → 0.812, front/rear held ≥ 0.90, anchors pass; 4 parameters at identity bounds |
| `tools/models/q-pipeline.sh` (c003) | 1: FORM-Q top silhouette gate FAIL; everything else PASS |
| `npm run validate:release` | 1, expected before M09/M14 — not an M03 regression |
| `npm run test:campaigns`, `npm run bench` | Not run: no simulation code changed; bench is M12 |

## Known-good journeys

Boot and error paths; browser determinism self-check; God control by pointer, keyboard and touch emulation (select, route around a city, feed, rest, cancel, consent override) with headless replay equality; on-map FORM-Q scale, contact, footprint and corrupt-GLB refusal (`tests/e2e/god-model.spec.ts`); offline inspector orbit/zoom/reset/poses/LOD/age-injury for all six c003 models (and the preserved c002 viewers) with 0 network requests.

## Blockers (M03 cannot be accepted until all are cleared)

1. **B00 art-direction board (Arena).** OR-2026-09-25-01 reopens B00. The master's "B00+B01 approval" prerequisite now requires a new compliant `CG-S-ART-DIRECTION` from the Arena workflow, followed by owner approval. The master is unamended and consistent with this ruling.
2. **Corrected LIFE-Q (Arena).** Per OR-2026-09-25-02, LIFE-Q r005's shell is drift; a replacement matching FORM-Q r004 is required. Until then the life-stage proportions in `src/render/god/qLife.ts` are provisional.
3. **FORM-Q top view: repair exhausted.** The one bounded repair pass (OR-2026-09-25-03) reached top 0.803 < 0.90. The remaining gap is limited by recorded identity bounds (`torso_length` at minimum 0.62, `torso_z` at +1.5, `head_z` at 9.5, `leg_top_y` at 14.5). Under the master's pass rules this is a second failure, so work stops. The owner decides whether those anatomy bounds may be widened (a new recorded pass) or the top reference/fit corrected.
4. **Human art approval** of c003 (and c002 for comparison): `artifacts/inspection/<ID>/c003/` and `/c002/` (`viewer.html` embeds its own GLB, `turntable.mp4`, `validation-sheet.png`).

## Next bounded action

Arena: produce a compliant B00 board and a corrected LIFE-Q (owner approval each), then re-pin `tools/assets/intake.ts` to the new Arena commit and run `node tools/assets/intake.ts`. Owner: rule on blocker 3 and review the committed c002/c003 outputs. Any further FORM-Q reshaping needs an explicitly approved new pass. Do not start M04.

## Historical (superseded — do not treat as current)

- 2026-09-23, before intake: all 285 IDs unresolved; Arena at `6f07fd4`; B00 blocked with `NO_AMENDMENT_RUN_STOPPED`; LIFE-Q r001/r002 rejected for 3×3 layout. Superseded by the Arena run to `15c6f1b`.
- 2026-09-25, c002 (primary re-run on current sources, before owner rulings): FORM-Q top 0.751, left 0.463 against LIFE-Q r005; evidence preserved under `artifacts/inspection/*/c002/`. The left view was withdrawn by OR-2026-09-25-02.
- 2026-09-23/24, first M03 candidate c001: intake of eight native Arena candidates from `6f07fd4` under HR-2026-09-23-01, including ART-DIRECTION r001 and LIFE-Q r002 (which the Arena ledger records as REJECTED) through a 3×3 panel map. c001 results (FORM-Q top 0.759, left 0.796 against the r002 prime panel) were measured on those obsolete bytes and are preserved under `artifacts/inspection/*/c001/` as history only.
