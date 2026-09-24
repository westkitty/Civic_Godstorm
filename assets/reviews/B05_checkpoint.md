# B05 CHECKPOINT — Aerial mantle grammar (5 IDs)

**Batch:** B05 · **Gate:** depends on B04 mantle torso (TORSO-M approved-provisional); no added limbs or feathers · **Mode:** PROVISIONAL — not yet started

## IDs and plan

| ID | Role | Dependency |
|---|---|---|
| `CG-S-GOD-LOCO-WING` | Foldable membrane wing, 3 structural spars, continuous root cuff; NO feathers, no extra forelimb | independent |
| `CG-S-GOD-FEED-CARRION` | Hooked scoop jaw, 4 blunt gripping teeth, deep throat pouch; scavenger, NOT a generic dragon skull | independent |
| `CG-S-GOD-SENSE-ANTENNA-CROWN` | Antenna crown sense module | independent |
| `CG-S-GOD-FORM-M` | Whole-body M-family assembly (legal module junctions) | TORSO-M r002 (approved-provisional) + the 3 modules above |
| `CG-S-GOD-LIFE-M` | Six-state lifecycle sheet for family M | FORM-M |

**Production order:** 3 independent modules first, then FORM-M + LIFE-M parent-first in the same pass if module inspection is clean; consolidated human gate at pass end.
**Pre-staged scaffolds (verified with identify):** `CG-S-GOD-LOCO-WING/r001/template_2x2.png`, `CG-S-GOD-FEED-CARRION/r001/template_2x2.png`, `CG-S-GOD-SENSE-ANTENNA-CROWN/r001/template_2x2.png`, `CG-S-GOD-FORM-M/r001/template_2x2.png` (all 1024²), `CG-S-GOD-LIFE-M/r001/template_3x2.png` (1264×848).

## Applied lessons for this batch

- TB-03: fresh generation with corrective geometry first; never anchor on defective references.
- TB-04: global no-words rule + positional stage descriptions for the LIFE-M 3×2 sheet.
- New B04 finding: a square whole-form sheet as content anchor can bias a wide lifecycle scaffold into extra rows (LIFE-S r002) — for LIFE-M, anchor on a **single side-profile crop** of FORM-M's lateral panel and lead with the pre-counted six-cell rule.
- Generation budget: 10 hard attempts/turn; reserve slots for repairs (B05 needs 5 minimum).

## Status after full pass (2026-09-24, ruling `B05_CROWN_PASS2_THEN_CHILDREN` executed)

| ID | Verdict | Notes |
|---|---|---|
| `CG-S-GOD-LOCO-WING` | **r001 CONFORMING** | Membrane (zero feathers), exactly 3 spars, unbroken root cuff close-up, clean fold panel; minor: ochre membrane smudges, small wrist spur — non-blocking |
| `CG-S-GOD-FEED-CARRION` | **r001 CONFORMING** | Rounded hooked scoop (not a fang), exactly 4 blunt gripping teeth (verified lateral + frontal), deep throat pouch, no dragon-skull features; minor: keratin pitting, rear seam groove — non-blocking |
| `CG-S-GOD-SENSE-ANTENNA-CROWN` | **r001+r002 REJECTED (TB-06) → r003 authorized pass-2 CONFORMS** | Per-panel EXACTLY-SIX counts fixed the plan panel (zoom-verified: six blades, three per side, bare mount edges). **Technical flag (TB-07):** model abandoned the square scaffold, native 1376×768 landscape with quadrant logic intact — first observed canvas swap; gate to accept as technical pass |
| `CG-S-GOD-FORM-M` | **r001 CONFORMING** | Five-module assembly, inventory-complete, wings at flush rings, crown six-frond with open center, no legs/eyes/extra anatomy; flags non-blocking (spars not resolvable at assembly scale; crown profile overlap legal) |
| `CG-S-GOD-LIFE-M` | **r001 CONFORMING with two disclosed flags** | Single-view-anchor strategy VALIDATED: exact 3×2, six states once each, no text, strong continuity, correct corpse. Flags for gate: (1) ossuary skull renders one large round socket despite prohibition — reads as temporal fenestra; registry anchors (species ossuary, scavenger-not-dragon jaw) hold; repair path recorded; (2) injured panel under-marked: clear wing tear, no distinctly visible flank scar (conservative direction, no gore) |

**Gate payload (all 5):** WING r001 · CARRION r001 · CROWN r003 (canvas flag) · FORM-M r001 · LIFE-M r001 (two flags).

Also this turn: FIFTH_WORKSPACE_RESET_RECOVERED (pre-flight); ruling #12 `B05_CROWN_PASS2_THEN_CHILDREN` recorded; TB-06 (radial count multiplication) and TB-07 (scaffold canvas abandonment) added. Generation attempts: 10 of 10 (one consumed by a missing-scaffold tool error, no image; CROWN r002 scaffold created procedurally on demand).
