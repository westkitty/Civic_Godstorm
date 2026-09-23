# B00 Checkpoint — Global Art Direction (`CG-S-ART-DIRECTION`)

**Date:** 2026-09-23 · **Specification:** CG-V1.0.0 · **Branch:** `arena/01a0d03e-civic-godstorm` @ `5bd357e` (base; artifact commit follows this file)
**Session repository state found:** clean checkout, docs-only `main` history, **no `assets/` tree, no prior source/provenance records** → all 121 authored outputs started this session at `SPECIFIED`.

## Verdict

| Item | State |
|---|---|
| `CG-S-ART-DIRECTION` | **BLOCKED — dimensional capability**, not style |
| Candidates generated | 2 of 2 permitted (1 initial + 1 targeted repair) |
| Approved | 0 · Awaiting approval | 0 · Rejected candidates | 2 · Blocked IDs | 1 |
| Canonical path | Correctly absent — no approved normalized source exists |

## Capability preflight (contract §2)

| Capability | Tool actually present | Verified result |
|---|---|---|
| Image generation | Arena Agent Mode `generate_image` | Works; native outputs **1264×848** and **1376×768** observed; **model-selected sizes, not user-selectable**; model identity UNKNOWN |
| Native alpha | same | **No alpha channel** in outputs (PNG color-type 2 TrueColor) — relevant to later REF-GLYPH work, where sources are intentionally opaque anyway |
| Inspection | ImageMagick `identify` (incl. IHDR fields) | Dimensions / format / depth / colorspace / alpha / hashes all verifiable |
| Deterministic resample | ImageMagick `convert` | Available; resampler recordable per use |
| sRGB PNG @ exact profile dims | — | **Not achievable for ≥1536px-wide boards: probe subject r001 is the proof** |

The probe was executed with the contract-mandated B00 style candidate — no out-of-manifest image was generated.

## Candidate evidence

**r001 — `assets/candidates/CG-S-ART-DIRECTION/r001/cg_s_art_direction.png`**
PNG 8-bit sRGB TrueColor, no alpha, 1264×848 native (aspect error **0.63%**, within 1%), sha256 `84ed5820…b551bb`.
Content QA against the REF-DIRECTION row: **all six panels present and conforming** — (1) hex world diorama at 45°/55° with tiny settlement and road; (2) Q beside a city, tower at shoulder height, arched continuous torso, four pillar limbs, brow band of four recessed eyes, tapering tail; (3) faceted matte hide study; (4) six civic material swatches; (5) ecological palette bands; (6) dark interface-hierarchy panel with one danger accent. No typography, no forbidden anatomy, palette adherent. *Rejected solely because* 1264px native < the 1536×1024 normalization floor (would need **2.43×** upscale; master allowance is 2× for reference boards).

**r002 — `assets/candidates/CG-S-ART-DIRECTION/r002/cg_s_art_direction.png`**
Repair candidate, reference-anchored on r001. PNG 8-bit sRGB, 1376×768 native — **16:9, aspect error 19.44% (>1% limit)** and still below the floor. *Rejected.* Repair budget exhausted; per §4 the ID is marked BLOCKED with specific mismatch, no endless regeneration loop run.

## Why production stops here

- §4: "A tool that cannot meet the permitted input threshold must report the ID blocked, not rename a lower-resolution substitute as approved." Promoting r001/r002 would be exactly that violation. No bytes occupy `assets/source/art/cg_s_art_direction.png`.
- §7 stopping condition: unavailable generation capability → stop, ask the smallest decision.
- B01's parent dependency is therefore unsatisfied; **B01 has not been started** and no quota was spent on it.

## Smallest decision required (human)

The two candidates — especially **r001** — demonstrate that the tool *can* deliver the mandated monumental-biological-cartography style and full board content, but at ~1264–1376px native, not the ≥1536px the master's normalization allowance requires. Choose one:

1. **Amend A (narrowest):** permit this board's normalization from its actual same-aspect native (1264×848, +2.43× recorded Lanczos, +43% blur risk). Needs a one-line master-plan amendment; recorded against the ID either way.
2. **Amend B:** relax REF-DIRECTION canonical size to native-achievable dimensions (e.g. accept 1264×848 3:2-class boards as canonical).
3. **No amendment:** B00 remains BLOCKED in this environment; the run stops here honestly, candidates preserved as evidence for a capable session.

*Alternatively* (orthogonal): direct me to continue producing **B01 module content candidates** as provisional, unapproved work only — but §4 makes B00 a hard gate before dependent production, so this is not recommended and nothing downstream was started.

## Ledger

`assets/arena_receipts.json` — full registry (121 IDs, machine-parsed from master §17.4–17.6; 120 source + 1 direct verified; dependency closure verified), capability-probe record, per-candidate receipts with real sha256 hashes, and the B00 checkpoint. Reconciliation: contract SHA-256 target not reproducible across the chat/markdown byte boundary (5 conventions tried — recorded inconclusive, non-blocking); **substantive row-by-row reconciliation PASSED**.

## Ruling (2026-09-23, human, via Arena session)

**No amendment — the production run stops.** B00 remains BLOCKED by design in this environment. Candidates r001/r002 are preserved strictly as capability evidence; they are NOT approved sources and must never be promoted by a later agent merely because they are newer. B01–B12 were not started. Canonical sources approved in this environment: **0 of 121**. The canonical path `assets/source/art/cg_s_art_direction.png` remains intentionally absent. A future session with a tool capable of ≥1536px-wide native 3:2 output may restart the run at B00 from `SPECIFIED` using this ledger and the registered request envelope; the style/content viability shown by r001 does not pre-approve it.
