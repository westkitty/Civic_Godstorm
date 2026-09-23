# Operational state (restart pointer)

| Field | Value |
|---|---|
| Current milestone | **M02 - Direct God-control prototype** (not started) |
| Last accepted milestone | M01 - Playable simulation kernel ([evidence](evidence/M01.md)); M00 ([evidence](evidence/M00.md)) |
| Branches | `m00-architecture-foundation` (pushed), `m01-simulation-kernel` (stacked on M00). Neither is merged to `main` |
| Toolchain | Node 24.21.0 LTS / npm 11.19.0; Playwright Chrome channel plus Playwright Firefox 155.0 and WebKit 26.6 builds |
| Known-good journeys | Boot shell; WebGL2-missing and renderer-failure paths; browser determinism self-check matching Node in Chrome, Firefox and WebKit |
| Asset status | 285/285 IDs unresolved. The Arena branch `arena/01a0d03e-civic-godstorm` reports B00 BLOCKED (tool below the 1536 px floor) and four provisional B01 candidates, none approved. It has not been integrated |
| Blocking decisions | M03 needs B00 + B01 human approval. B00 is blocked on Arena tool capability, and resolving that is the user's decision |

## Next bounded action (M02)

Build a first-class God record from the §4 grammar for one legal Q/PILLAR starting genome:

- the §16.2 footprint and swept-region validation, and footprint A* over `(anchor, heading)`;
- MOVE/FEED/REST/HOLD with AP, stance and fatigue;
- consent previews, the persistent itinerary and overrides;
- an observation boundary for fog;
- the God dock and command strip in the browser (pointer, keyboard and touch-emulated), with explicit `MISSING <ID>` placeholders for all God art.

Exit evidence is a real browser journey: select, route around a city, feed, rest, cancel the itinerary and override a legal safety warning. It must produce the same headless command outcomes, and a hidden obstacle must not leak.
