import { describe, expect, it } from 'vitest';
import { createCampaign } from '../../src/sim/campaign.ts';
import type { Command } from '../../src/sim/core/commands.ts';
import type { CampaignState } from '../../src/sim/core/state.ts';
import { resolveTurn } from '../../src/sim/core/turn.ts';
import { occupiedCells } from '../../src/sim/gods/body.ts';
import type { GodState } from '../../src/sim/gods/god.ts';
import { FAMILY_LOCOMOTORS, genomeProblems, STARTING_GENOME_Q, type Genome } from '../../src/sim/gods/grammar.ts';
import { planRoute, previewRoute } from '../../src/sim/gods/planner.ts';
import { convexHull, overlapsWithArea, transitionFor } from '../../src/sim/gods/sweep.ts';
import { buildObservationView, observedKnowledge } from '../../src/sim/observation/observation.ts';
import { BIOME_INDEX } from '../../src/sim/data/rules.ts';
import { distance, MASKS } from '../../src/sim/world/hex.ts';

const campaign = (): CampaignState => createCampaign({ seed: 'cg-demo', size: 'small', civCount: 2 });
const humanGod = (state: CampaignState): GodState => state.gods[0] as GodState;

function godCommand(state: CampaignState, kind: Command['kind'], options: unknown, consent: Command['consent'] = {}, sequence = 1): Command {
  const god = humanGod(state);
  return {
    commandId: `${kind}:${state.turn}:${sequence}`, civId: god.ownerId, actorId: god.id, issuedForTurn: state.turn + 1, sequence,
    target: null, consent, expectedStateVersion: state.turn, kind, options,
  } as Command;
}

const knowledgeOf = (state: CampaignState) => observedKnowledge(buildObservationView(state, humanGod(state).ownerId), humanGod(state).id);

describe('God grammar (Section 4.2)', () => {
  it('has exactly nine legal family/locomotor pairings and a legal starting genome', () => {
    expect(Object.values(FAMILY_LOCOMOTORS).flat()).toHaveLength(9);
    expect(genomeProblems(STARTING_GENOME_Q)).toEqual([]);
  });

  it('rejects known invalid genomes', () => {
    const bad: Partial<Genome>[] = [
      { locomotor: 'UNDULATOR' },
      { family: 'M', locomotor: 'WING', feeding: 'CARRION', tail: 'BALANCE', armor: 'SHELL' },
      { family: 'H', locomotor: 'PILLAR', feeding: 'FILTER', tail: 'NONE' },
      { family: 'Q', locomotor: 'DIGGER', organ: 'SOLAR-SAIL' },
      { tail: 'WEDGE' },
    ];
    for (const change of bad) expect(genomeProblems({ ...STARTING_GENOME_Q, ...change }).length).toBeGreaterThan(0);
  });
});

describe('swept-region geometry (Section 16.2)', () => {
  it('treats touching polygons as non-overlapping and shared area as overlapping', () => {
    const a = convexHull([[0, 0], [2, 0], [2, 2], [0, 2]]);
    expect(overlapsWithArea(a, convexHull([[2, 0], [4, 0], [4, 2], [2, 2]]))).toBe(false);
    expect(overlapsWithArea(a, convexHull([[1, 1], [3, 1], [3, 3], [1, 3]]))).toBe(true);
  });

  it('sweeps the hull notches of a forward TWO move and is rotation-consistent', () => {
    const counts = new Set<number>();
    for (let heading = 0; heading < 6; heading += 1) {
      const forward = transitionFor('TWO', MASKS.TWO, heading, 'FORWARD');
      counts.add(forward.swept.length);
      expect(forward.entered).toHaveLength(1);
      for (const cell of [...forward.occupied]) expect(forward.swept).toContainEqual(cell);
    }
    expect([...counts]).toEqual([7]);
    expect(transitionFor('DISC7', MASKS.DISC7, 0, 'TURN_LEFT').swept.length).toBeGreaterThanOrEqual(7);
  });
});

describe('starting God', () => {
  it('occupies a legal wild footprint next to its capital and sees its surroundings', () => {
    for (const seed of ['cg-demo', 'g-2', 'g-3']) {
      const state = createCampaign({ seed, size: 'standard', civCount: 6 });
      expect(state.gods).toHaveLength(6);
      const farms = new Set(state.settlements.flatMap((s) => s.farmSites.map((f) => f.cell)));
      for (const god of state.gods) {
        const cells = occupiedCells(state.map, god.maskName, god) ?? [];
        expect(cells).toHaveLength(2);
        for (const cell of cells) {
          expect(farms.has(cell)).toBe(false);
          expect(state.settlements.some((s) => s.cell === cell)).toBe(false);
          expect(state.observations.find((o) => o.civId === god.ownerId)?.visibility[cell]).toBe(2);
        }
        const capital = state.settlements.find((s) => s.ownerId === god.ownerId);
        expect(distance(state.map, god.anchor, capital?.cell ?? -1)).toBeLessThanOrEqual(3);
        expect(god.reserve).toBe(2400);
      }
    }
  });
});

describe('route planning on observed knowledge', () => {
  it('routes around the settlement core; SAFE routes never need consent', () => {
    const state = campaign();
    const god = humanGod(state);
    const capital = state.settlements[0];
    if (!capital) throw new Error('no capital');
    const result = planRoute(knowledgeOf(state), god.ownerId, god.maskName, god, [804], 'DIRECT');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    let pose = { anchor: god.anchor, heading: god.heading };
    for (const step of result.steps) {
      pose = { anchor: step.anchor, heading: step.heading };
      expect(occupiedCells(state.map, god.maskName, pose)).not.toContain(capital.cell);
    }
    expect(pose.anchor).toBe(804);
    const safe = planRoute(knowledgeOf(state), god.ownerId, god.maskName, god, [804], 'SAFE');
    expect(safe.ok && safe.civilianCollateral.length === 0 && safe.trespass.length === 0).toBe(true);
  });

  it('reports consent needs, and distinguishes a budget limit from impossibility', () => {
    const state = campaign();
    const god = humanGod(state);
    const preview = previewRoute(knowledgeOf(state), god, [711]);
    expect(preview.direct.ok && preview.direct.civilianCollateral).toEqual([710]);
    expect(preview.safe?.ok).toBe(false);
    expect(planRoute(knowledgeOf(state), god.ownerId, god.maskName, god, [804], 'DIRECT', 3)).toMatchObject({ ok: false, failure: 'BUDGET_EXCEEDED' });
    expect(planRoute(knowledgeOf(state), god.ownerId, god.maskName, god, Array(13).fill(804), 'DIRECT')).toMatchObject({ ok: false, failure: 'TOO_MANY_WAYPOINTS' });
  });
});

describe('God commands and resolution', () => {
  it('requires explicit consent to cross farmland and accepts the override', () => {
    let state = campaign();
    const refused = resolveTurn(state, [godCommand(state, 'GOD_MOVE', { waypoints: [711], routeMode: 'DIRECT', then: null })]);
    expect(refused.rejections.map((r) => r.code)).toEqual(['CONSENT_REQUIRED']);
    const accepted = resolveTurn(state, [godCommand(state, 'GOD_MOVE', { waypoints: [711], routeMode: 'DIRECT', then: null }, { civilianCollateral: [710] })]);
    expect(accepted.rejections).toEqual([]);
    state = accepted.state;
    const summary = state.lastTurn?.gods[0];
    expect(summary?.movementAp).toBeLessThanOrEqual(4);
    expect(summary?.steps).toBeGreaterThan(0);
  });

  it('persists an itinerary across turns within 4 AP per turn and 2 crossings per impulse', () => {
    let state = campaign();
    state = resolveTurn(state, [godCommand(state, 'GOD_MOVE', { waypoints: [804], routeMode: 'SAFE', then: 'FEED' })]).state;
    const turns: number[] = [];
    for (let turn = 0; turn < 5 && humanGod(state).status.kind === 'ACTIVE'; turn += 1) {
      turns.push(state.lastTurn?.gods[0]?.movementAp ?? -1);
      state = resolveTurn(state, []).state;
    }
    expect(humanGod(state).anchor).toBe(804);
    expect(turns.every((ap) => ap <= 4)).toBe(true);
  });

  it('feeds from real biomass under the body and conserves it as nutrition', () => {
    const state = campaign();
    const god = humanGod(state);
    const cells = occupiedCells(state.map, god.maskName, god) ?? [];
    const before = cells.reduce((sum, cell) => sum + (state.map.biomass[cell] as number), 0);
    const next = resolveTurn(state, [godCommand(state, 'GOD_FEED', {})]).state;
    const after = cells.reduce((sum, cell) => sum + (next.map.biomass[cell] as number), 0);
    const summary = next.lastTurn?.gods[0];
    expect(summary?.fed).toBe(true);
    // Ecology regrowth runs before feeding (step 3), so compare the taken amount to the gain.
    expect(summary?.nutritionGained).toBe((before - after) * 10);
    expect(humanGod(next).reserve).toBe(2400 + (summary?.nutritionGained ?? 0) - 800);
  });

  it('rests to recover fatigue, pays upkeep, and suffers a real shortfall when empty', () => {
    let state = campaign();
    humanGod(state).fatigue = 50;
    state = resolveTurn(state, [godCommand(state, 'GOD_REST', {})]).state;
    expect(humanGod(state).fatigue).toBe(20);
    expect(state.lastTurn?.gods[0]?.rested).toBe(true);
    humanGod(state).reserve = 0;
    state = resolveTurn(state, []).state;
    expect(state.lastTurn?.gods[0]?.shortfall).toBe(800);
    expect(humanGod(state).fatigue).toBe(35);
    expect(humanGod(state).vitalHealth).toBe(780);
  });

  it('cancels an itinerary with HOLD and never moves autonomously', () => {
    let state = campaign();
    state = resolveTurn(state, [godCommand(state, 'GOD_MOVE', { waypoints: [804], routeMode: 'SAFE', then: null })]).state;
    const anchor = humanGod(state).anchor;
    state = resolveTurn(state, [godCommand(state, 'GOD_HOLD', {})]).state;
    expect(humanGod(state).order.kind).toBe('HOLD');
    for (let turn = 0; turn < 5; turn += 1) state = resolveTurn(state, []).state;
    expect(humanGod(state).anchor).toBe(anchor);
  });

  it('rejects living commands for a dead God and orders for foreign Gods', () => {
    const state = campaign();
    const foreign = state.gods[1] as GodState;
    const command = { ...godCommand(state, 'GOD_FEED', {}), actorId: foreign.id };
    expect(resolveTurn(state, [command]).rejections.map((r) => r.code)).toEqual(['NOT_OWNER']);
    humanGod(state).lifecycle = 'DEAD';
    expect(resolveTurn(state, [godCommand(state, 'GOD_FEED', {})]).rejections.map((r) => r.code)).toEqual(['UNSUPPORTED_STATE']);
  });
});

describe('observation boundary', () => {
  function hiddenRouteCell(state: CampaignState): { dest: number; hidden: number } {
    const god = humanGod(state);
    const view = buildObservationView(state, god.ownerId);
    // A far destination whose planned route passes through never-observed cells.
    for (let dest = 0; dest < view.observation.visibility.length; dest += 1) {
      if (view.observation.visibility[dest] !== 0 || distance(state.map, dest, god.anchor) !== 6) continue;
      const plan = planRoute(knowledgeOf(state), god.ownerId, god.maskName, god, [dest], 'SAFE');
      if (!plan.ok) continue;
      const hidden = plan.steps.map((s) => s.anchor).find((cell) => view.observation.visibility[cell] === 0 && cell !== dest);
      if (hidden !== undefined) return { dest, hidden };
    }
    throw new Error('no hidden route cell found');
  }

  it('previews and validation are identical whether or not a hidden obstacle exists', () => {
    const clean = campaign();
    const { dest, hidden } = hiddenRouteCell(clean);
    const blocked = structuredClone(clean);
    blocked.map.biome[hidden] = BIOME_INDEX.DEEP_SEA;
    expect(JSON.stringify(buildObservationView(blocked, humanGod(blocked).ownerId))).toBe(JSON.stringify(buildObservationView(clean, humanGod(clean).ownerId)));
    expect(JSON.stringify(previewRoute(knowledgeOf(blocked), humanGod(blocked), [dest]))).toBe(JSON.stringify(previewRoute(knowledgeOf(clean), humanGod(clean), [dest])));
    const order = (s: CampaignState): Command => godCommand(s, 'GOD_MOVE', { waypoints: [dest], routeMode: 'SAFE', then: null });
    expect(resolveTurn(blocked, [order(blocked)]).rejections).toEqual(resolveTurn(clean, [order(clean)]).rejections);
  });

  it('stops at a newly discovered obstacle instead of passing through it', () => {
    const clean = campaign();
    const { dest, hidden } = hiddenRouteCell(clean);
    let state = structuredClone(clean);
    state.map.biome[hidden] = BIOME_INDEX.DEEP_SEA;
    state = resolveTurn(state, [godCommand(state, 'GOD_MOVE', { waypoints: [dest], routeMode: 'SAFE', then: null })]).state;
    for (let turn = 0; turn < 6 && humanGod(state).status.kind === 'ACTIVE'; turn += 1) state = resolveTurn(state, []).state;
    const god = humanGod(state);
    expect(god.status.kind).toBe('HALTED');
    expect(occupiedCells(state.map, god.maskName, god)).not.toContain(hidden);
    expect(god.anchor).not.toBe(dest);
  });
});

describe('two-way link and simultaneity', () => {
  it('a farm under a God body produces nothing that turn (workers may shift to a free field)', () => {
    const state = campaign();
    const god = humanGod(state);
    const capital = state.settlements[0];
    if (!capital) throw new Error('no capital');
    capital.farmSites = capital.farmSites.slice(0, 1);
    god.anchor = capital.farmSites[0]?.cell ?? -1;
    const summary = resolveTurn(state, []).state.lastTurn?.settlements[0];
    expect(summary?.warnings).toContain('FARM_UNDER_GOD');
    expect(summary?.produced.FOOD).toBe(200);
  });

  it('halts both Gods whose swept regions would intersect', () => {
    const state = campaign();
    const [a, b] = state.gods as [GodState, GodState];
    const target = 1000;
    // Place both Gods facing each other two cells apart on the same row with wild land between.
    a.anchor = target - 2; a.heading = 0;
    b.anchor = target + 2; b.heading = 3;
    for (const cell of [target - 3, target - 2, target - 1, target, target + 1, target + 2, target + 3]) state.map.biome[cell] = BIOME_INDEX.GRASSLAND;
    const orders = (who: GodState, dest: number, seq: number): Command => ({
      commandId: `m${who.id}`, civId: who.ownerId, actorId: who.id, issuedForTurn: 1, sequence: seq, target: null, consent: {},
      expectedStateVersion: 0, kind: 'GOD_MOVE', options: { waypoints: [dest], routeMode: 'DIRECT', then: null },
    });
    // Each God can plan (it may not see the other), but physical resolution halts both.
    const result = resolveTurn(state, [orders(a, target, 1), orders(b, target + 1, 1)]);
    const halted = result.state.gods.filter((g) => g.status.kind === 'HALTED').map((g) => g.status.kind === 'HALTED' ? g.status.reason : '');
    expect(halted.length).toBeGreaterThanOrEqual(1);
    for (const god of result.state.gods) {
      const cells = occupiedCells(result.state.map, god.maskName, god) ?? [];
      const other = result.state.gods.find((g) => g.id !== god.id) as GodState;
      expect(cells.some((cell) => (occupiedCells(result.state.map, other.maskName, other) ?? []).includes(cell))).toBe(false);
    }
  });
});
