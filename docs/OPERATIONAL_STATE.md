# Operational state (restart pointer)

| Field | Value |
|---|---|
| Current milestone | **M01 - Playable simulation kernel** (not started) |
| Last accepted milestone | M00 - Architecture foundation ([evidence](evidence/M00.md)) |
| Accepted commit | The M00 commit on branch `m00-architecture-foundation`. It has not been merged to `main` and not pushed |
| Active candidate | none |
| Toolchain | Node 24.21.0 LTS / npm 11.19.0 (see [TOOLCHAIN.md](TOOLCHAIN.md)). Global Node 26.9.0 is untouched |
| Known-good journeys | Browser boot shell. `WEBGL2_UNAVAILABLE` and `RENDERER_START_FAILED` error paths (Chrome 153, desktop and narrow) |
| Asset status | 285/285 IDs unresolved. Authored 0/121 approved, derived 0/112 verified, recipes 0/52 registered |
| Pending source requests | B00 `CG-S-ART-DIRECTION`, then B01 (seven Q IDs) and B02 (six civic IDs) through the Arena workflow. They are not needed for M01/M02, where placeholders are allowed. M03 is blocked on B00+B01 human approval |
| Pending human decisions | Whether to push `m00-architecture-foundation` and how to integrate it (PR or merge). Review of the eight IDs outside the traceability closure (informational) |

## Next bounded action (M01)

Implement `src/sim/core` and `src/sim/world` as pure TypeScript:

- the CG-XOR32-v1 stream with FNV-1a stream seeding and the §16.7 golden vectors;
- integer Quantity arithmetic;
- a canonical sorted serialisation with SHA-256 state hash;
- offset/axial wrapped hex topology and §16.2 masks;
- a command/turn reducer with the stable rejection codes;
- basic population/food/construction;
- a save envelope.

Register the `sim` vitest suites. Exit evidence:

- golden RNG vectors;
- 50 seeded 30-turn headless runs with identical rerun hashes;
- no negative stock or population;
- the five-population opening food arithmetic;
- wrapped coordinate and path fixtures.

`test:campaigns` gains its seeded headless runner at M01.
