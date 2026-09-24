# B08 CHECKPOINT — Environment material sheets and unit sheets (18 IDs)

**Batch:** B08 · **Gate:** Shared scale/material gate; no extra people/animals/equipment · **Mode:** PROVISIONAL — CLOSED
**Opened:** 2026-09-24T08:05:00+00:00 · **Closed:** 2026-09-24 en bloc under ruling #17 (`STANDING_CONTINUATION_ORDER_B08_TO_B12`)
**Counts:** 18 requested · 19 candidates generated · 18 approved-provisional · 1 candidate rejected (CRYSTAL r001)
**Canonical (pending promotion ruling):** `assets/source/environment/cg_s_env_*.png`, `assets/source/units/cg_s_unt_*.png` — all ABSENT; no promotions under ruling #17 (2048/3072 ruling reserved to the owner).

## Chunk 1 — 10 ENV material sheets (9/10 conforming r001; CRYSTAL repaired as r002)

| ID | Verdict | Identity anchors verified |
|---|---|---|
| `CG-S-ENV-CONIFER` | r001 CONFORMING | tall narrow conifer; EXACTLY four stepped branch whorls (elevation + plan rings); narrow pointed top |
| `CG-S-ENV-CRYSTAL` | r001 REJECTED → **r002 APPROVED** | r001: four columns vs exactly 3 (TB-06 count class, zoom-verified). r002: EXACTLY three columns (tall/medium/short) in hero, elevation and plan footprints; blunt faceted prisms; zero glow effects |
| `CG-S-ENV-DECIDUOUS` | r001 CONFORMING | one broad-canopy tree; distinct trunk; EXACTLY three major branching masses (plan-verified) |
| `CG-S-ENV-FUNGUS` | r001 CONFORMING | EXACTLY three broad gently-domed caps (largest central) on ONE shared base mound; gill-ridge underside macro |
| `CG-S-ENV-KELP` | r001 CONFORMING | one anchored holdfast; EXACTLY three continuous undulating ribbons (plan-verified); no fish/animals/bubbles |
| `CG-S-ENV-ORE` | r001 CONFORMING | diagonal banded seam in rock; EXACTLY two strong contrasting strata (pale-light + deep-dark) with macro boundary |
| `CG-S-ENV-PALM` | r001 CONFORMING | one-bend bent trunk with rounded root base; EXACTLY six broad fronds (plan-verified); crown attach detail |
| `CG-S-ENV-REEDS` | r001 CONFORMING | one shared tuft; EXACTLY five reed stalks (plan-verified) with broad bent seed-head tips in varied directions |
| `CG-S-ENV-ROCK` | r001 CONFORMING | EXACTLY three joined angular weathered masses (tall dominant + two flanks); flat fractured facets |
| `CG-S-ENV-RUBBLE` | r001 CONFORMING | EXACTLY five broken masonry blocks + EXACTLY two splintered ochre timber fragments in one pile (counted across views) |

## Chunk 2 — 8 UNT sheets + CRYSTAL r002 (ALL CONFORM; 19th candidate = CRYSTAL r002)

| ID | Verdict | Identity anchors verified |
|---|---|---|
| `CG-S-UNT-BALLISTA` | r001 CONFORMING | wheeled timber tension engine; exactly ONE horizontal bow; visible loading bed with bolt; rear windlass crank |
| `CG-S-UNT-BOW` | r001 CONFORMING | one recurved wooden bow + string + wrapped grip; exactly ONE separate arrow alongside (leaf head, three-feather fletch) |
| `CG-S-UNT-HULL-MERCHANT` | r001 CONFORMING | single low broad cargo hull; ONE square sail on central mast; open deck crates matching WAGON cargo family |
| `CG-S-UNT-HULL-WAR` | r001 CONFORMING | long narrow oared hull (single oar bank both sides); ONE square sail; reinforced banded stem; shield rail; benches + oars in plan; no crew figures |
| `CG-S-UNT-SHIELD` | r001 CONFORMING | one broad oval shield; central reinforced ridge + rim boss; REVERSE panel shows horizontal handgrip; no bearer |
| `CG-S-UNT-SOLDIER` | r001 CONFORMING — **TB-07 canvas flag (1376×768; quadrant logic intact; 5th occurrence; accepted-with-flag, not silent)** | ONE stylized armored figure, neutral A-pose, EMPTY open hands, closed simple helmet with vision slit; no plume/horns/face; no second figure/animals/equipment |
| `CG-S-UNT-SPEAR` | r001 CONFORMING | one straight shaft, ONE leaf blade, wrapped grip, butt cap; single object, no bearer/hands |
| `CG-S-UNT-WAGON` | r001 CONFORMING | two-axle four-wheel hand-pushed cargo wagon; rectangular boxes + rolled lashed canopy bundle; push handle; no animals |

## Process record

- Chunk 1 consumed the full 10-attempt turn cap (10 ENV generations + 1 failed attempt against a missing scaffold); CRYSTAL r002 scaffold was pre-staged and fired at the head of chunk 2 (audits `B08_TURN_CAP_CRYSTAL_R002_PENDING`, `B08_PASS_COMPLETE_CLOSED`).
- SOLDIER canvas swap handled per TB-07 rule: `identify` caught the 1376×768 deviation, quadrant logic verified intact, disclosed as a flag — not a silent accept, not a content rejection.
- HULL-WAR verified against the plan hull contract: long/narrow proportions, ONE square sail, reinforced banded stem, shield rail, benches + oars in plan view, zero crew.
- Reset #9 (workspace re-root to docs commit) recovered zero-loss via ls-remote-verified `reset --hard` before chunk 2 (audit `NINTH_WORKSPACE_RESET_RECOVERED`).
- All 19 candidate PNGs committed as evidence; rejected CRYSTAL r001 keeps explicit REJECTED status and is never a source.
- Housekeeping at this file's creation (2026-09-24): `batch_checkpoints.B08` id_states/counts synced to the closed state — chunk-2 IDs had been left `NOT_STARTED` and the awaiting count stale at 9 from chunk 1. Receipts and approval records were already correct at `dd995bb`; display state only.
