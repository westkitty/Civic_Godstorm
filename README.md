# CIVIC GODSTORM

This is an offline-first browser 4X in which the player directly commands one persistent colossal God while building a civilization that can live with, change, exploit, resist or outlive it.

The authority is [`CIVIC_GODSTORM_MASTER_PLAN.md`](CIVIC_GODSTORM_MASTER_PLAN.md), contract CG-V1.0.0. Implementation follows [`OPUS_5_5_MASTER_BUILD_PROMPT.md`](OPUS_5_5_MASTER_BUILD_PROMPT.md). Authored source images come only from the [LM Arena workflow](LM_ARENA_ASSET_PRODUCTION_PROMPT.md).

**Current state:** M00-M02 are accepted. The M02 direct God-control prototype lets you select your God, plan footprint-aware routes around cities, feed, rest, cancel itineraries and consent to warned routes by mouse, keyboard or touch, on a schematic map with fog. M03 (first complete God) is a **candidate, not accepted**: six Q models (revision c003) were rebuilt from the current canonical sources. After the single repair pass the FORM-Q top view is still below its gate. Acceptance also waits on a new compliant art-direction board (B00 reopened by the owner), a corrected LIFE-Q sheet and human art approval. 119 of 121 authored source images are canonical and hash-verified from the Arena branch. `CG-S-ART-DIRECTION` is absent pending a new compliant board and `CG-S-GOD-LIFE-S` is unresolved. Derived models and runtime recipes are mostly still `MISSING`, and there is no complete game yet. See [`docs/OPERATIONAL_STATE.md`](docs/OPERATIONAL_STATE.md).

## Setup

This project needs Node 24.21.0 LTS (see `.nvmrc` and [`docs/TOOLCHAIN.md`](docs/TOOLCHAIN.md)).

```bash
npm ci
```

```bash
npm run dev
```

## Controls (M02 prototype)

- `G` selects and frames your God. `M` starts a move. Then click or tap a destination (`Shift` adds a waypoint), or use the arrow keys and `Enter`.
- On desktop, right-click routes directly.
- `F` feeds, `R` rests and `H` holds (cancels the itinerary).
- `Enter` ends the turn and `Esc` backs out.
- `WASD` pans, `Q`/`E` rotate and `+`/`-` zoom. Drag pans, the wheel or a pinch zooms.
- Add `?seed=<seed>` to choose the world. `?debug=1` enables visibly marked debug tools.

## Validation commands (master §19.1)

Runners accept `--runs <n>`, `--civs <1-6>`, `--seed <1-64 of A-Za-z0-9._:->`, `--map small|standard|large`, `--scenario <id>`, `--turns <1-1000>` and `--out <dir>`. Browser and vitest suites take the same settings through `CG_SEED`, `CG_MAP`, `CG_SCENARIO`, `CG_TURNS` and `CG_OUT`; only `CG_OUT` is consumed so far. Every required gate exits nonzero on failure.

| Command | What it does now | Exit now |
|---|---|---|
| `npm run typecheck` | Strict `tsc` over app and node/tool projects | 0 |
| `npm run lint` | ESLint with type-aware rules plus simulation determinism and module-boundary rules | 0 |
| `npm run test:unit` | Vitest `unit` project: contract compiler, corrupted-catalog fixtures, args, capability probe, asset registry | 0 |
| `npm run test:sim` | Vitest `sim` project: golden RNG vectors, SHA-256, hex/path fixtures, world generation, economy, commands, 50×30 determinism, save round-trip, Node self-check fixture | 0 |
| `npm run test:assets` | Recompiles the Section 17 contract (48 checks), checks registry freshness, manifest hashes and canonical-path occupancy, and reports separate completion counts | 0; missing assets are allowed during development |
| `npm run test:e2e` | Production build, then Playwright journeys in Chrome (desktop, narrow), Firefox and WebKit: boot/error paths, determinism self-check, and God-control journeys by pointer, keyboard and touch with headless replay | 0 |
| `npm run test:campaigns` | Seeded headless campaigns, each run twice with hash comparison (defaults: 50 runs × 30 turns, standard, 6 civs); `--runs`, `--civs` and the other runner arguments are accepted | 0 |
| `npm run bench` | Validates arguments, then reports that no workload exists | 2 (not implemented, M12) |
| `npm run build` | Vite production build for `/Civic_Godstorm/` | 0 |
| `npm run preview` | Serves `dist/` on port 4173 | server |
| `npm run validate:release` | Release asset gate: zero unresolved IDs and every authored source approved | 1: 166 IDs unresolved |

Model pipeline (M03, first Q God). It needs the Python toolchain in `tools/models/requirements.txt` and a Chromium for the evidence capture:

```bash
python3.11 -m venv .toolchain/py && .toolchain/py/bin/pip install -r tools/models/requirements.txt
tools/models/q-pipeline.sh
```

The pipeline builds the volumes, then the skinned GLBs with LODs and `.blend` files. It ground-solves the poses and measures silhouettes, identity anchors, structure and deformation. It runs the Khronos glTF-Validator, builds the offline `viewer.html` inspectors, captures the 144-frame turntables, validation sheets and age/injury sample, and registers the results in provenance. `tools/models/fit_form.py --write` refits the form placements and is not part of every run. `node tools/assets/intake.ts --check` confirms every canonical source is byte-identical to the pinned Arena commit and matches its receipt hash, and that nothing else sits under `assets/source/`. Without `--check`, it reconciles the files, `assets/provenance.json` and `assets/manifest.json` from the Arena receipts.

Helpers:

- `npm run spec:compile` regenerates `assets/specification.json`, `assets/missing.json` and `src/assets/generated/specIndex.json` from the master.
- `npm run probe:env -- --out <dir>` records host and tool versions.
- `node tools/runners/write-selfcheck-fixture.ts` regenerates the Node determinism fixture. Run it only after a reviewed rules change.
- Firefox and WebKit journeys need Playwright browser builds; install them once with the command below.

```bash
npx playwright install firefox webkit
```

No script publishes or deploys anything.
