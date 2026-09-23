# CIVIC GODSTORM

This is an offline-first browser 4X in which the player directly commands one persistent colossal God while building a civilization that can live with, change, exploit, resist or outlive it.

The authority is [`CIVIC_GODSTORM_MASTER_PLAN.md`](CIVIC_GODSTORM_MASTER_PLAN.md), contract CG-V1.0.0. Implementation follows [`OPUS_5_5_MASTER_BUILD_PROMPT.md`](OPUS_5_5_MASTER_BUILD_PROMPT.md). Authored source images come only from the [LM Arena workflow](LM_ARENA_ASSET_PRODUCTION_PROMPT.md).

**Current state:** M01 simulation kernel accepted, on top of the M00 foundation: a deterministic headless kernel (world, economy, commands, turns, hashing, saves) with an in-browser determinism self-check. **There is no playable game yet.** See [`docs/OPERATIONAL_STATE.md`](docs/OPERATIONAL_STATE.md).

## Setup

This project needs Node 24.21.0 LTS (see `.nvmrc` and [`docs/TOOLCHAIN.md`](docs/TOOLCHAIN.md)).

```bash
npm ci
```

```bash
npm run dev
```

## Validation commands (master §19.1)

Runners accept `--runs <n>`, `--civs <1-6>`, `--seed <1-64 of A-Za-z0-9._:->`, `--map small|standard|large`, `--scenario <id>`, `--turns <1-1000>` and `--out <dir>`. Browser and vitest suites take the same settings through `CG_SEED`, `CG_MAP`, `CG_SCENARIO`, `CG_TURNS` and `CG_OUT`; only `CG_OUT` is consumed so far. Every required gate exits nonzero on failure.

| Command | What it does now | Exit now |
|---|---|---|
| `npm run typecheck` | Strict `tsc` over app and node/tool projects | 0 |
| `npm run lint` | ESLint with type-aware rules plus simulation determinism and module-boundary rules | 0 |
| `npm run test:unit` | Vitest `unit` project: contract compiler, corrupted-catalog fixtures, args, capability probe, asset registry | 0 |
| `npm run test:sim` | Vitest `sim` project: golden RNG vectors, SHA-256, hex/path fixtures, world generation, economy, commands, 50×30 determinism, save round-trip, Node self-check fixture | 0 |
| `npm run test:assets` | Recompiles the Section 17 contract (48 checks), checks registry freshness, manifest hashes and canonical-path occupancy, and reports separate completion counts | 0; missing assets are allowed during development |
| `npm run test:e2e` | Production build, then Playwright journeys in Chrome (desktop, narrow), Firefox and WebKit, including the browser determinism self-check | 0 |
| `npm run test:campaigns` | Seeded headless campaigns, each run twice with hash comparison (defaults: 50 runs × 30 turns, standard, 6 civs); `--runs`, `--civs` and the other runner arguments are accepted | 0 |
| `npm run bench` | Validates arguments, then reports that no workload exists | 2 (not implemented, M12) |
| `npm run build` | Vite production build for `/Civic_Godstorm/` | 0 |
| `npm run preview` | Serves `dist/` on port 4173 | server |
| `npm run validate:release` | Release asset gate: zero unresolved IDs and every authored source approved | 1: 285 IDs unresolved |

Helpers:

- `npm run spec:compile` regenerates `assets/specification.json`, `assets/missing.json` and `src/assets/generated/specIndex.json` from the master.
- `npm run probe:env -- --out <dir>` records host and tool versions.
- `node tools/runners/write-selfcheck-fixture.ts` regenerates the Node determinism fixture. Run it only after a reviewed rules change.
- Firefox and WebKit journeys need Playwright browser builds; install them once with the command below.

```bash
npx playwright install firefox webkit
```

No script publishes or deploys anything.
