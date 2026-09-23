# CIVIC GODSTORM - Implementation Architecture Contract

**Status:** implementation record (M00-M02). **Subordinate to:** `CIVIC_GODSTORM_MASTER_PLAN.md` (contract CG-V1.0.0).

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
| ADR-M00-06 | Lint encodes module boundaries and determinism. `src/sim/**` cannot import Three/React/render/ui/app/audio/persistence and cannot use `Math.random`, `Date.now`, `performance.now`, `new Date`, `window`, `document` or timers. `src/render/**` cannot import UI. | §13.2, §14.3 | Probe run in `docs/evidence/M00.md` |

## Module ownership (master §14.3)

Directories are created only when a milestone first needs them. The rows marked *present* exist now.

| Module | Owns | State |
|---|---|---|
| `src/app/` | Boot, capability probe, error boundary, build identity | present |
| `src/render/` | `RendererHost` (sole owner of `WebGLRenderer`, scene, camera and frame scheduling), recipes | present (`CG-R-DEBUG` only) |
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
| `tools/` | Spec compiler, asset gates, runners, environment probe | present |
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
| `assets/missing.json` | generated | Unresolved IDs. At M00 this is all 285 in state `SPECIFIED` |
| `src/assets/generated/specIndex.json` | generated | Compact runtime lookup (ID, class, profile, path) |
| `assets/provenance.json` | seeded once, then evidence only | Actual candidate, approval and rights records. Empty |
| `assets/manifest.json` | seeded once, then evidence only | Verified shipping file facts and registered recipes. Empty |

The compiler never overwrites provenance or the manifest. `test:assets` fails if a generated registry is stale, if a manifest entry's path or hash disagrees with the file, or if any file sits at a canonical path without a provenance or manifest record.
