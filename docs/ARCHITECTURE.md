# CIVIC GODSTORM - Implementation Architecture Contract

**Status:** implementation record (M00-M03). **Subordinate to:** `CIVIC_GODSTORM_MASTER_PLAN.md` (contract CG-V1.0.0).

This file records how the code base realises the master's architecture. It is not a fourth planning document. It adds no scope, mechanics or assets. Where it and the master disagree, the master governs and the disagreement is a defect in this file.

## Decisions taken at M00

| ID | Decision | Master basis | Evidence |
|---|---|---|---|
| ADR-M00-01 | Greenfield layout: the repository held only the three planning documents at `5bd357e`, so there was no existing implementation to preserve. | §0, §22.2, AD-02 | `git ls-files` at `5bd357e`; `docs/evidence/M00.md` |
| ADR-M00-02 | Toolchain is Node 24.21.0 LTS (Krypton) with npm 11.19.0, pinned in `.nvmrc`, `.node-version`, `engines` and `package-lock.json`. The machine's global Node 26.9.0 (Current, not LTS) was left untouched. A checksum-verified Node 24.21.0 is kept project-locally in the gitignored `.toolchain/`. | §14.1 | `docs/TOOLCHAIN.md` |
| ADR-M00-03 | TypeScript is pinned to 6.0.3, not 7.0.2 (latest), because `typescript-eslint@8.70.1` supports only `typescript >=4.8.4 <6.1.0`. This is a compatibility choice within the frozen stack, not a change of stack. | §14.1 | `npm view typescript-eslint@8.70.1 peerDependencies` |
| ADR-M00-04 | Node tools (`tools/**`) run as `.ts` under Node's built-in type stripping. `erasableSyntaxOnly` enforces a compatible subset, so no extra TS runner dependency is added. | §14.1 (no unrequired frameworks) | `process.features.typescript === 'strip'` |
| ADR-M00-05 | M00 browser journeys use the installed Google Chrome channel (153.0.8010.53). The Chromium/Firefox/WebKit release matrix belongs to M13 and is not claimed here. | §19 M13, §20.1 | `playwright.config.ts` |
| ADR-M01-01 | The simulation hashes with its own synchronous pure-TypeScript SHA-256 (checked against `node:crypto` over 300 lengths). WebCrypto is asynchronous and differs by runtime, so it stays out of the determinism path. | §13.2 | `tests/sim/hashing.test.ts` |
| ADR-M01-02 | State is plain integer JSON data (arrays, not typed arrays) resolved by `structuredClone` and mutation of the clone. The committed input is never mutated. Canonical serialisation rejects floats, NaN, undefined and non-plain objects. | §13.2, §16.1 | `tests/sim/commands.test.ts` (no-mutation), `hashing.test.ts` |
| ADR-M01-03 | Start placement follows the master's cap of 64 attempts per candidate world: a STARTS-stream shuffle of stably enumerated candidates, examined in order, over at most 32 candidate worlds, reporting named rejection counters. | §3.3 | `tests/sim/world.test.ts` |
| ADR-M02-01 | God legality is one pure function over a `Knowledge` interface. Resolution passes true-state knowledge (physics); planning, previews and command validation pass observed knowledge, so a rejection or preview cannot reveal hidden truth. Execution follows the stored plan and halts rather than re-planning with hidden knowledge. | §4.4, §11 | `tests/sim/gods.test.ts` observation boundary |
| ADR-M02-02 | Impulse simultaneity uses micro-slots: each moving God proposes one step against the same positions, and intersecting proposals halt both. Multi-AP steps accumulate payment across impulses. | §2.3, §16.1 | `tests/sim/gods.test.ts` |
| ADR-M02-03 | The renderer consumes a `WorldSnapshot` built by the UI from the player's ObservationView and drafts, never from true state. The terrain is a schematic development presentation until CG-R-TERRAIN's art-direction dependency is approved. | §12.3, §17.8 | `src/ui/godView.ts` |
| ADR-M03-01 | The model toolchain is Blender 4.5.14 LTS as a Python module (`bpy`, PyPI) plus numpy/scipy/scikit-image/Pillow and imageio-ffmpeg's static ffmpeg (libx264), pinned in `tools/models/requirements.txt` in a project-local venv (`.toolchain/py`). The cloud container cannot reach download.blender.org. `bpy` provides the same glTF exporter and `.blend` authoring files the master names. | §18.1, §18.4 | `tools/models/requirements.txt`, `docs/evidence/M03.md` |
| ADR-M03-02 | Reference-constrained geometry is implicit. Each module is a slice loft: superellipse cross-sections whose extents come from the two approved views that contain the module's long axis, so those two silhouettes are reproduced by construction. The remaining approved views then carve it with a soft intersection. The complete Q form is a smooth union of the module volumes placed by `tools/models/fit_form.py`, a deterministic coordinate descent over named, bounded placement parameters. The fit maximises silhouette IoU against the scored form views and is constrained by identity anchors: four exposed eyes, exposed snout and tail tip, four separate feet on the ground and one connected body. | §18.1, §18.3 | `tools/models/volumes.py`, `build_volumes.py`, `fit_form.py` |
| ADR-M03-03 | Skin weights are computed, not painted. Inverse-distance weights to bone segments are taken within each module region and blended across junctions by soft region membership from the module distance fields. They are limited to 4 influences and normalised to 1. Bone names come only from the recipe, and runtime binds them only after verifying them against the exported GLB (`bindQRig`, `tests/tools/models.test.ts`). | §17.2, §18.3, §18.4 | `tools/models/build_models.py`, `src/render/god/qRig.ts` |
| ADR-M03-04 | Poses are data (`src/render/god/qPoses.json`): model-space rotations per joint, applied parent-first, plus a root offset. The TypeScript runtime and the Python validator implement the same rule, so pose deformation (volume ratio, edge stretch, ground contact) is measured on the delivered bytes. There are no baked clips. | §17.2 (no guessed clips), §19 M03 | `tools/models/validate_q.py`, `tools/models/fit_poses.py` |
| ADR-M03-05 | A derived model is DERIVED_UNVERIFIED until every gate passes and the human art decision is recorded. The map draws a DERIVED_UNVERIFIED model only when its SHA-256 matches its provenance record, and labels it as an unapproved candidate in the God panel. A corrupt or missing file keeps the `CG-R-DEBUG` placeholder. Nothing enters the verified manifest before approval. | §18.2 | `src/render/god/godAsset.ts`, `tests/e2e/god-model.spec.ts` |
| ADR-M00-06 | Lint encodes module boundaries and determinism. `src/sim/**` cannot import Three/React/render/ui/app/audio/persistence and cannot use `Math.random`, `Date.now`, `performance.now`, `new Date`, `window`, `document` or timers. `src/render/**` cannot import UI. | §13.2, §14.3 | Probe run in `docs/evidence/M00.md` |

## Module ownership (master §14.3)

Directories are created only when a milestone first needs them. The rows marked *present* exist now.

| Module | Owns | State |
|---|---|---|
| `src/app/` | Boot, capability probe, error boundary, build identity | present |
| `src/render/` | `RendererHost` (sole owner of `WebGLRenderer`, scene, camera and frame scheduling), recipes; `god/` Q model loading, rig/pose binding, age and injury presentation | present (`CG-R-DEBUG`; Q body from M03) |
| `src/inspector/` | Offline single-file model inspector bundled into each `viewer.html` | present (M03) |
| `src/ui/` | React surfaces, semantic controls, placeholder presentation | present |
| `src/assets/` | Spec index lookup, `AssetRef {id, status:'MISSING'}` resolution, verified-manifest paths | present |
| `src/sim/core/` | State types, command validation, turn reducer, integer math, RNG, canonical hash | present (M01) |
| `src/sim/world/` | Hex topology/masks, generation, ordinary A* | present (M01) |
| `src/sim/civ/` | Settlement economy step | present (M01) |
| `src/sim/data/` | Rules data with section citations and `RULES_HASH` | present (M01) |
| `src/sim/scripted/` | Deterministic scripted command driver for tests (not AI) | present (M01) |
| `src/runtime/` | Determinism self-check; GameSession (drafts, automated AI-civ commands, command log, replay) | present (M01-M02) |
| `src/persistence/` | Save envelope encode/decode (no IndexedDB yet) | present (M01) |
| `src/sim/gods/` | Grammar, God record, sweep geometry, body legality, footprint planner, God commands and resolution, start placement | present (M02) |
| `src/sim/observation/` | Per-civilization knowledge and the ObservationView boundary | present (M02) |
| `src/sim/ai/`, `src/audio/` | See master §14.3 | later milestones |
| `tools/` | Spec compiler, asset gates, source intake, runners, environment probe; `models/` Q conversion pipeline; `inspector/` viewer build and evidence capture | present |
| `tests/` | `unit` + `tools` (vitest project `unit`), `sim` (project `sim`), `e2e` (Playwright) | present |

## Runtime shell invariants

- **One frame-loop owner.** `RendererHost` renders on demand through one coalesced `requestAnimationFrame`. No continuous loop exists yet. No simulation or game state lives in the renderer. Pointer gestures (drag-pan with a 6 px threshold, pinch, wheel, click/tap picking) are normalised there; the UI decides what a picked cell means.
- **Rendering settings.** `WebGLRenderer` only, WebGL2 required. DPR is capped at 1.5 (medium tier, §15). The camera uses the §12.1 default of 45° azimuth and 55° elevation, orthographic.
- **Capability gate.** A missing WebGL2 context produces the `WEBGL2_UNAVAILABLE` requirement screen, never a degraded fake-3D build (AD-03). A renderer construction failure produces `RENDERER_START_FAILED` with a retry. An unexpected React error produces `UI_FATAL`. All three use `role="alert"`, a focused heading and a keyboard-reachable action.
- **Context loss.** `webglcontextlost` is prevented and reported through a polite live region. On restore, presentation is rebuilt from code. There is no game state to lose at M00.
- **Disposal.** Disposal is explicit for geometry, materials, textures, listeners, the `ResizeObserver` and the renderer. Unmounting `WorldView` disposes its host.
- **Missing assets.** Every unresolved asset renders as the `CG-R-DEBUG` checker with the literal `MISSING <ID>` label, as a 3D placeholder or a DOM panel. Unknown IDs throw `UnknownAssetIdError` rather than resolving to a guessed path.
- **Build identity.** Package version, git commit (with a `-dirty` flag) and contract, with no wall-clock timestamps.
- **Static distribution.** `base: '/Civic_Godstorm/'`. Nothing is deployed by any script.

## Asset registries (master §18.2)

| File | Producer | Meaning |
|---|---|---|
| `assets/specification.json` | `npm run spec:compile` (generated) | Section 17 requirements: 285 IDs with class, profile, path, consumers, recursive traceability, dependencies, batch and resolution path |
| `assets/missing.json` | generated from the contract plus provenance/manifest evidence | Unresolved IDs with their actual status |
| `src/assets/generated/specIndex.json` | generated | Compact runtime lookup (ID, class, profile, path) |
| `assets/provenance.json` | `tools/assets/intake.ts`, `tools/models/register-derived.ts` | Human rulings, APPROVED_SOURCE records (hash, native dimensions, waiver) and DERIVED_UNVERIFIED model records |
| `assets/manifest.json` | `tools/assets/intake.ts` | Verified file facts: approved sources so far; no derived asset yet |

The compiler never overwrites provenance or the manifest. `test:assets` fails if a generated registry is stale, if a manifest entry's path or hash disagrees with the file, or if any file sits at a canonical path without a provenance or manifest record.
