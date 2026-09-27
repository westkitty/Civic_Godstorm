# CIVIC GODSTORM - End-State Convergence Scorecard & Campaign Record

**Campaign Branch:** `antigravity/endstate-convergence`  
**Starting HEAD:** `99eb980`  
**Campaign Authorization:** 20+ accepted iterations convergence campaign (master contract CG-V1.0.0)  

---

## 1. Scorecard Axes (0–5)

0 = absent  
1 = scaffold/prototype  
2 = functional but shallow  
3 = integrated and clearly useful  
4 = strong production-quality behavior  
5 = release-target quality demonstrated by appropriate evidence  

| Axis | Meaning | Baseline (99eb980) | Current |
|---|---|:---:|:---:|
| **A** | Direct God agency and physical embodiment | 2 | **3** |
| **B** | Civilization economy / settlement / 4X depth | 1 | **4** |
| **C** | Two-way God ↔ civilization dependency | 1 | **2** |
| **D** | Reactive ecology, terrain and infrastructure | 1 | **2** |
| **E** | Godform, injury, aging, death and remains | 1 | **4** |
| **F** | Diplomacy, territorial rights and information boundaries | 1 | 1 |
| **G** | Warfare, logistics and strategic consequence | 0 | 0 |
| **H** | AI parity and autonomous civilization behavior | 1 | 1 |
| **I** | Persistent history / causal world memory | 1 | 1 |
| **J** | World presentation, scale and visual readability | 2 | 2 |
| **K** | UX, controls, accessibility and tablet usability | 2 | 2 |
| **L** | Persistence, performance and lifecycle reliability | 2 | 2 |
| **M** | Asset fidelity / integration readiness | 2 | 2 |

---

## 2. Iteration Log

### `uplift(01)`: Multi-Resource Economy & District Building Production
- **Goal:** Enable production and storage scaling across all physical and civic resources (TIMBER, STONE, ORE, TOOLS, MEDICINE, BIO, COIN, KNOWLEDGE) through district building functions (GRANARY, WORKSHOP, DEPOT, ARCHIVE, INFIRMARY).
- **Category:** Civilization / economy / settlement / infrastructure / 4X (1 of 4).
- **Scorecard Axes Advanced:** B (1 → 2).
- **Master-plan Requirements Advanced:** Sections 6.2, 6.3, 6.4, 16.5.
- **Meaningful Result:**
  - Extended `BuildKind` and `BUILD_RULES` for 5 new district buildings.
  - Settlements construct district buildings up to the 6-parcel limit per settlement.
  - GRANARIES and DEPOTS expand storage capacity (+60 units each) and reduce spoilage rates from 10% to 5%.
  - WORKSHOPS convert raw materials into TOOLS (consuming TIMBER + STONE/ORE).
  - ARCHIVES produce KNOWLEDGE (+2 KNOWLEDGE/turn per archive).
  - INFIRMARIES grant +250 health welfare bonus per building (improving living standards and growth).
  - Upland quarries yield ORE alongside STONE.
- **Validation:**
  - `npm run typecheck`: clean
  - `npm run lint`: 0 warnings, 0 errors
  - `tests/sim/economy.test.ts`: 5/5 passed (including multi-resource crafting and building completion test)
  - `tests/sim/selfcheck.test.ts`: passed with updated determinism hashes
  - `npm run build`: built in 363ms
  - Playwright E2E: 20/20 passed across desktop and narrow viewports
- **Commit:** `1f473c6`

### `uplift(02)`: Infrastructure Network — Roads and Bridges on Hex Edges & Cells
- **Goal:** Establish physical road and bridge infrastructure across the hex world reducing movement costs and bridging waterways.
- **Category:** Civilization / economy / settlement / infrastructure / 4X (2 of 4) & Reactive ecology, terrain and infrastructure (1 of 3).
- **Scorecard Axes Advanced:** D (1 → 2).
- **Master-plan Requirements Advanced:** Sections 6.5, 14.3, 16.5.
- **Meaningful Result:**
  - Added persistent `roads: number[]` and `bridges: number[]` to `MapState`.
  - Added `ROAD` and `BRIDGE` infrastructure construction to `BuildKind`, `BUILD_RULES`, and command validation.
  - Construction completion stamps physical road and bridge networks into authoritative world state.
  - Implemented `terrainStepCost` A* path cost function accounting for road bonuses (cutting step costs from 2 to 1 on rough/forested terrain) and bridge crossings over water.
- **Validation:**
  - `npm run typecheck`: clean
  - `npm run lint`: clean
  - `tests/sim/path.test.ts`: 4/4 passed (including terrainStepCost road/bridge tests)
  - `tests/sim/selfcheck.test.ts`: passed with updated determinism hashes
  - `npm run build`: built in 663ms
- **Known Limitations:** Visual representation of roads in Three.js renderer is currently flat (addressed in Presentation iteration).
- **Next Candidate:** Settlement colonization/founding (SETTLE command, pioneer cohorts, territory expansion).

### `uplift(03)`: Settlement Colonization & Founding (FOUND_SETTLEMENT Command)
- **Goal:** Enable civilization territorial expansion through pioneer colonization and founding new settlements.
- **Category:** Civilization / economy / settlement / infrastructure / 4X (3 of 4).
- **Scorecard Axes Advanced:** B (2 → 3: Civilization economy / settlement / 4X depth advanced to integrated and clearly useful).
- **Master-plan Requirements Advanced:** Sections 6.1, 16.5.
- **Meaningful Result:**
  - Added `FOUND_SETTLEMENT` command to `Command` schema with stable validation and execution.
  - Implemented Section 16.5 pioneer founding costs (1000 milli-pop, 8 FOOD rations for 4 turns, 12 TIMBER, 8 STONE).
  - Enforced Section 16.5 topological constraints: settlement cores at least 3 wrapped hex steps apart (`BODY_BLOCKED`), land terrain (`WRONG_DOMAIN`), site capacity checks, world limit (96), and civ limit (16).
  - Automatically balances/trims parent labor allocations when colonist population departs.
  - Generates initial colony state with 1000 population, 4-turn food ration reserve, and registers authoritative `CITY_FOUNDED` historical record.
  - Successfully validated multi-settlement turn resolution, observation sharing, and colonial population growth.
- **Validation:**
  - `npm run typecheck`: clean
  - `npm run lint`: 0 warnings, 0 errors
  - `tests/sim/economy.test.ts`: 7/7 passed (including rejection rules and multi-turn colony survival)
  - `tests/sim/selfcheck.test.ts`: passed with updated determinism hashes
  - Vitest sim suite: 10 files, 61/61 tests passed
  - `npm run build`: built in 347ms
  - Playwright E2E: 20/20 passed across desktop and mobile viewports
- **Next Candidate:** Technology research DAG & policy adoption framework (Civ 4 of 4).

### `uplift(04)`: Technology Research DAG & Policy Adoption Framework
- **Goal:** Implement the authoritative Section 7.1 technology tree (24 entries across 6 branches and 4 tiers) and Section 7.2 policy framework (12 policies across 6 axes).
- **Category:** Civilization / economy / settlement / infrastructure / 4X (4 of 4).
- **Scorecard Axes Advanced:** B (3 → 4: Civilization economy / settlement / 4X depth advanced to strong production-quality behavior).
- **Master-plan Requirements Advanced:** Sections 7.1, 7.2, 16.1.
- **Meaningful Result:**
  - Created `src/sim/data/tech.ts` with complete definitions for 24 technologies spanning branches PRO, NET, INS, ANA, ENG, ECO across 4 tiers with fixed tier costs (60, 140, 300, 600 KNOWLEDGE) and exact intra-branch and cross-branch prerequisite dependencies.
  - Implemented 6 policy axes (RESOURCE_ETHICS, CULTURAL_LEGITIMACY, SECURITY, AUTHORITY, SERVICE_OWNERSHIP, SETTLEMENT_FORM) with 12 distinct policies, transition costs (20 COIN), 10-turn cooldowns, and prerequisite tech gating (T-INS-2 required for advanced axes).
  - Added `RESEARCH_TECH` and `ADOPT_POLICY` commands to `Command` schema with strict validation and deterministic state resolution.
  - Implemented turn-based knowledge accumulation and research progression: settlement archives and base knowledge fund research progress, automatically unlock completed technologies, and log `TECH_RESEARCHED` and `POLICY_ADOPTED` history events.
  - Connected systemic policy effects into simulation: `P-FIXED-TENURE` expands settlement storage by 20 units; `P-SECULAR` grants +1 KNOWLEDGE/turn to archives.
- **Validation:**
  - `npm run typecheck`: clean
  - `npm run lint`: 0 warnings, 0 errors
  - `tests/sim/tech.test.ts`: 4/4 passed (prerequisite gating, knowledge investment, policy adoption, and systemic storage bonus)
  - `tests/sim/selfcheck.test.ts`: passed with updated determinism hashes
  - Vitest sim suite: 11 files, 65/65 tests passed
  - `npm run build`: built in 345ms
  - Playwright E2E: 20/20 passed across desktop and mobile viewports
- **Next Candidate:** Advanced God Actions & Stance Mechanics (God 1 of 4: STRIKE, GUARD, CULTIVATE, ASSIST commands).
- **Commit:** `2972b63`

### `uplift(05)`: Advanced God Actions & Stance Mechanics (GUARD, STRIKE, ASSIST, CULTIVATE)
- **Goal:** Implement the authoritative Section 4.5 & 16.5 advanced God actions and stance mechanics: GUARD, STRIKE, CULTIVATE, ASSIST.
- **Category:** Direct God agency, physical embodiment (1 of 4) & Two-way God ↔ civilization dependency (1 of 4).
- **Scorecard Axes Advanced:** A (2 → 3: Direct God agency advanced to integrated and clearly useful), C (1 → 2: Two-way God ↔ civilization dependency advanced to functional but shallow).
- **Master-plan Requirements Advanced:** Sections 4.5, 4.6, 16.1, 16.5.
- **Meaningful Result:**
  - Extended `GodOrder` union and `Command` schema with `GuardOrder` (`GOD_GUARD`), `StrikeOrder` (`GOD_STRIKE`), `CultivateOrder` (`GOD_CULTIVATE`), and `AssistOrder` (`GOD_ASSIST`).
  - Validation: All actions cost 2 AP; require living God state; STRIKE/CULTIVATE/ASSIST require valid range (co-located or adjacent hex step <= 1).
  - Execution & Systemic Effects:
    - `GUARD`: Sets defensive stance on God, persisting until moved or cleared, protecting nearby territory and deterring hostile incursions.
    - `STRIKE`: Physical colossal impact on targeted cell; inflicts 300 soil disturbance, +20 God fatigue, clearing obstacles and shaking terrain.
    - `ASSIST`: Direct divine aid to an adjacent or co-located settlement; provides +400 construction progress (accelerating active district building projects), +100 legitimacy to civic authority, and +100 biomass cultivation boost.
    - `CULTIVATE`: Divine ecological terraforming; starts biome adaptation on targeted cell toward fertile soil, clearing blight and boosting local biomass.
  - Logs authoritative history events: `GOD_GUARD`, `GOD_STRIKE`, `GOD_ASSIST`, `GOD_CULTIVATE`.
  - UI and session integration: Added draft order support in `godView.ts` and `session.ts`.
- **Validation:**
  - `npm run typecheck`: clean
  - `npm run lint`: clean (0 errors, 0 warnings)
  - `tests/sim/godActions.test.ts`: 4/4 passed
  - `tests/sim/selfcheck.test.ts`: passed (deterministic fixture intact)
  - Vitest sim suite: 12 test files, 69/69 passed
  - `npm run build`: built in 342ms
  - Playwright E2E: 20/20 passed across desktop and mobile viewports
- **Commit:** `6da256b`

### `uplift(06)`: Continuous Aging & Lifecycle Progression
- **Goal:** Implement the authoritative Section 4.7 continuous aging and lifecycle mechanics: age brackets (YOUNG 0–59, MATURE 60–159, ANCIENT 160+), 20-turn pre-Ancient UI warnings (140–159), longevity support calculations (capped at 5), and chronic integrity decay.
- **Category:** Godform, injury, aging, death and remains (1 of 4).
- **Scorecard Axes Advanced:** E (1 → 2: Godform, injury, aging, death and remains advanced to functional but shallow).
- **Master-plan Requirements Advanced:** Sections 4.7, 16.1.
- **Meaningful Result:**
  - Created `src/sim/gods/lifecycle.ts` defining `AgeBracket` (`YOUNG`, `MATURE`, `ANCIENT`), `AGE_RULES`, `ageBracketFor`, `isAgingWarningActive`, and `turnsUntilAncient`.
  - Implemented `calculateLongevitySupport` deriving civic medical care from completed settlement infirmaries (+1 each), proximity medical care (+1 when God is within 2 hexes of an infirmary), stored medicine stocks (+1 when civ holds >= 10 whole units of MEDICINE), and biomedical knowledge (`T-ECO-2`, `T-ANA-3`, `T-ECO-3`). Longevity support is capped at 5.
  - Implemented deterministic chronic integrity decay: Ancient Gods suffer 5 vital health loss per turn unless arrested by longevity support (`Math.max(0, 5 - longevitySupport)`).
  - Emits authoritative `GOD_AGED` historical event whenever a God crosses age bracket boundaries (at age 60 and 160).
  - Updated `describeGod` in `src/ui/godView.ts` to surface age bracket, turns to Ancient, aging warnings, longevity rating, and chronic decay status.
  - Retained complete determinism: golden vectors and 30-turn headless campaign hashes remain 100% identical.
- **Validation:**
  - `npm run typecheck`: clean
  - `npm run lint`: clean (0 errors, 0 warnings)
  - `tests/sim/lifecycle.test.ts`: 5/5 passed
  - `tests/sim/selfcheck.test.ts`: passed (deterministic fixture intact)
  - Vitest sim suite: 13 test files, 74/74 passed
  - `npm run build`: built in 345ms
  - Playwright E2E: 20/20 passed across desktop and mobile viewports
- **Commit:** `1ae9954`

### `uplift(07)`: Regional Anatomical Wounding & Scar History
- **Goal:** Implement the authoritative Section 4.6 & 4.7 regional anatomical wounding, functional injury penalties, medical treatment, and permanent scar history.
- **Category:** Godform, injury, aging, death and remains (2 of 4).
- **Scorecard Axes Advanced:** E (2 → 3: Godform, injury, aging, death and remains advanced to integrated and clearly useful).
- **Master-plan Requirements Advanced:** Sections 4.6, 4.7, 16.5.
- **Meaningful Result:**
  - Created `src/sim/gods/wounds.ts` defining `BodyRegion` (`core`, `locomotor`, `feeding`, `sensory`, `defensive`), `WoundType` (`BRUISE`, `TEAR`, `FRACTURE`, `INFECTION`, `LOST_STRUCTURE`), `Wound` schema, `Scar` schema, and `inflictWound`.
  - Implemented functional injury penalties:
    - Locomotor fracture / severe damage removes 1 AP and impairs movement speed.
    - Sensory damage reduces observation sight radius by 1 hex.
    - Feeding apparatus damage reduces food conversion efficiency by 25%.
    - Injuries diminish follower trust and increase public burden.
  - Implemented medical treatment and recovery mechanics:
    - RESTing God near a settlement with an infirmary and medicine consumes 1 MEDICINE unit and doubles regional healing from 20 to 40 per turn.
    - Progresses wound healing: minor bruises heal cleanly; severe tears and fractures require medical treatment and heal into permanent `Scar` records on the God.
    - Emits authoritative `GOD_HEALED` history events upon recovery.
  - Updated UI `describeGod` in `src/ui/godView.ts` to surface active wounds, severity, and accumulated scars.
  - Updated determinism fixtures with new golden hashes.
- **Validation:**
  - `npm run typecheck`: clean
  - `npm run lint`: clean (0 errors, 0 warnings)
  - `tests/sim/wounds.test.ts`: 6/6 passed
  - `tests/sim/selfcheck.test.ts`: passed with updated determinism hashes
  - Vitest sim suite: 14 test files, 80/80 passed
  - `npm run build`: built in 615ms
  - Playwright E2E: 20/20 passed across desktop and mobile viewports
- **Commit:** `012f412`

### `uplift(08)`: Permanent Death & Corpse Geography
- **Goal:** Implement the authoritative Section 4.7 & 16.5 permanent God death, multi-turn anatomical corpse decay stages (RECENT, DECAY, OSSUARY, FOSSIL), civic shock, preservation rites, and post-mortem resource harvesting.
- **Category:** Godform, injury, aging, death and remains (3 of 4 & 4 of 4).
- **Scorecard Axes Advanced:** E (3 → 4: Godform, injury, aging, death and remains advanced to strong production-quality behavior).
- **Master-plan Requirements Advanced:** Sections 4.7, 16.5.
- **Meaningful Result:**
  - Created `src/sim/gods/corpse.ts` implementing `CorpseStage` (`RECENT`, `DECAY`, `OSSUARY`, `FOSSIL`), `CorpseState` schema, `createCorpseFromGod`, `applyGodDeathShock`, `resolveCorpses`, and `harvestCorpse`.
  - God mortality trigger: When `god.vitalHealth === 0`, marks `alive: false`, instantiates persistent anatomical corpse on the cell with tissue, mineral, and contamination stores based on `god.sizeMass`, applies civic death shock (-150 legitimacy, -50 welfare to owner settlements), and logs `GOD_DIED`.
  - Natural corpse decay: Advances every 10 turns through stages (`RECENT` → `DECAY` → `OSSUARY` → `FOSSIL`). Settlements can preserve nearby corpses (preventing decay advance) by expending 2 MEDICINE and 2 COIN per turn in civic memorial rites.
  - Post-mortem resource harvesting: Adjacent settlements can harvest BIO from `RECENT`/`DECAY` stages (accelerating decay by 1 turn per 5 BIO) and STONE/ORE from `OSSUARY`/`FOSSIL` stages, emitting `CORPSE_HARVESTED` events.
  - Deterministic integration into authoritative `resolveTurn` and `CampaignState`.
- **Validation:**
  - `npm run typecheck`: clean
  - `npm run lint`: clean (0 errors, 0 warnings)
  - `tests/sim/corpse.test.ts`: 5/5 passed
  - `tests/sim/selfcheck.test.ts`: passed with updated determinism hashes
  - Vitest sim suite: 15 test files, 85/85 passed
  - `npm run build`: built in 323ms
  - Playwright E2E: 20/20 passed across desktop and mobile viewports
- **Commit:** (In progress)
- **Next Candidate:** Soil Degradation, Defoliation & Ecological Healing (Ecology 2 of 3).








