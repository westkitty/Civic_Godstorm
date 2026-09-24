# B06 CHECKPOINT — Remaining adaptation and symbiosis modules (7 IDs)

**Batch:** B06 · **Gate:** installed-slot compatibility + preserved base silhouettes · **Mode:** PROVISIONAL — not yet started

## IDs and required identity anchors (registry §17.4)

| ID | Required identity |
|---|---|
| `CG-S-GOD-ARMOR-OSTEODERM` | One dorsal ridge strip of five overlapping bony scutes, irregular natural suture, NO metallic bolts |
| `CG-S-GOD-ARMOR-COAT` | Continuous thick fibrous mantle; large directional locks preserving body silhouette, not particle fur |
| `CG-S-GOD-ORGAN-SOLAR-SAIL` | One pleated dorsal photosynthetic sail with five ribs; translucency via opaque tonal technique |
| `CG-S-GOD-ORGAN-SPORE-SAC` | Two rounded porous sacs joined by a broad root saddle; six large visible pores total |
| `CG-S-GOD-SYMB-FUNGAL-GROVE` | Three joined fungal crowns on a living root saddle; broad caps, one clear passage below |
| `CG-S-GOD-SYMB-FOLLOWER-GALLERY` | Two timber-and-textile galleries sharing a flexible dorsal saddle, rails and one central walkway |
| `CG-S-GOD-ROOT-HOLDFAST` → `CG-S-GOD-SYMB-ROOT-HOLDFAST` | Four broad branching root bundles from one belly collar; each bundle forks once; retractable |

All seven are independent modules — no FORM/LIFE children in this batch. One pass: 7 parallel 2×2 sheets (3 spare generation slots); consolidated human gate at pass end.

**Pre-staged scaffolds (verified with identify):** all seven `r001/template_2x2.png` at 1024².

## Status after initial pass (2026-09-24) — 7/7 conforming, gate pending

| ID | Verdict | Notes |
|---|---|---|
| `CG-S-GOD-ARMOR-OSTEODERM` | **r001 CONFORMING** | Exactly 5 scutes (zoom-verified plan+side), irregular wavy sutures, zero metallic hardware, ridge-arching cross-section |
| `CG-S-GOD-ARMOR-COAT` | **r001 CONFORMING** | Continuous broad directional fiber locks, layered cross-section, silhouette preserved; **disclosed observation:** overlapping-lock rendering is feather-adjacent — registry prohibits particle fur only, which is satisfied |
| `CG-S-GOD-ORGAN-SOLAR-SAIL` | **r001 CONFORMING** | Exactly 5 ribs (zoom-verified), pleated membrane, opaque tonal banding translucency; minor: front face slightly squared, plan partially occluded |
| `CG-S-GOD-ORGAN-SPORE-SAC` | **r001 REJECTED → r002 CONFORMS** | r001: top-down panel leaked 4+4=8 pores vs six (TB-06 echo). r002: oblique-view + outer-face-placement + bare-top mitigation held — 3 per sac, six total, zero top/saddle pores; scaffold honored |
| `CG-S-GOD-SYMB-FUNGAL-GROVE` | **r001 CONFORMING** | Exactly 3 crowns (tall center + 2 flanking), living root saddle with gripping tendrils, clear walk-through passage beneath |
| `CG-S-GOD-SYMB-FOLLOWER-GALLERY` | **r001 CONFORMING** | Exactly 2 timber cabins + ochre awnings + rails, central walkway, segmented flexible saddle; **TB-07 canvas flag:** 1376×768, quadrant logic intact — disclosed (CROWN r003 precedent available) |
| `CG-S-GOD-SYMB-ROOT-HOLDFAST` | **r001 CONFORMING** | One belly collar, exactly 4 bundles each forking exactly once (8 tips, zoom-verified); clean retractable read |

Generation attempts: 9 of 10 (one consumed by a missing-r002-scaffold tool error; template created procedurally). Applied: TB-03 (fresh generations), TB-06 (per-panel counts — held for OSTEODERM/SAIL/ROOT-HOLDFAST; leaked once on SPORE-SAC plan panel, fixed by the recorded mitigation), TB-07 (identify() on every output — caught 2 canvas swaps).

## Applied lessons

- TB-03: fresh generation, corrective geometry first; never anchor on defective references.
- TB-06: per-panel element counts for ANY radial/countable anatomy (spore pores, scute count, sail ribs, root bundles) — state the count in every panel description.
- TB-07: run `identify` on every output; canvas deviation = disclosed flag, not silent accept/auto-reject.
- Budget: 10 hard attempts/turn; 7 planned + 3 spare for single retries.

## Gate status

Pass complete (7/7 conforming claims above were **independently re-verified by the primary session**: all 8 candidate sha256 hashes byte-identical to receipts, dimensions as declared, every content anchor confirmed by pixel inspection — audit entry `PARALLEL_SESSION_B06_INDEPENDENT_AUDIT`, commit `3324b84`). Consolidated gate ask_user SKIPPED TWICE (2026-09-24) — both skips recorded in `audit_trail`, no ruling assumed. B06 remains OPEN pending the user's ruling; canonical paths absent (correct).


## RULING 2026-09-24 (`B06_CONSOLIDATED_GATE_APPROVE6_HOLD_COAT`) + COAT r002

Six IDs APPROVED as provisional batch-local (OSTEODERM r001, SOLAR-SAIL r001, SPORE-SAC r002, FUNGAL-GROVE r001, FOLLOWER-GALLERY r001 — canvas swap accepted as technical pass, ROOT-HOLDFAST r001). ARMOR-COAT r001 was HELD and its authorized targeted r002 produced the same turn: **r002 CONFORMS** — wide flat nested directional bands, one overlap direction, zero feather anatomy (no shafts/barbs/tip rows); feather-adjacency reading eliminated. Fresh-generation repair with corrective geometry first, no defective anchor (TB-03). **B06 awaits only the user's COAT r002 verdict to close** (accept r002 → 7/7 closed; reject → 6/7 with COAT rejected-final).
