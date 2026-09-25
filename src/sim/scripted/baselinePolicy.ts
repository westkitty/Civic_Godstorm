// Deterministic scripted command driver for headless kernel runs and self-checks. This is a test
// harness, NOT the M08 AI: it reads its own settlements directly and exists only to exercise the
// command/turn pipeline with plausible orders. It issues commands through the shared validator.

import { forestrySite, housingCapacityMilli, laborMilli, quarrySite, type Command } from '../core/commands.ts';
import { units } from '../core/quantity.ts';
import type { CampaignState, JobAllocation, SettlementState } from '../core/state.ts';
import { ECONOMY_RULES, JOBS, WORLD_RULES } from '../data/rules.ts';
import { isWater } from '../world/generate.ts';
import { neighbors } from '../world/hex.ts';

function planJobs(state: CampaignState, settlement: SettlementState): JobAllocation {
  const perSite = ECONOMY_RULES.maxWorkersPerSite * 1000;
  let remaining = laborMilli(settlement);
  const take = (amount: number): number => {
    const granted = Math.max(0, Math.min(amount, remaining));
    remaining -= granted;
    return granted;
  };
  const farmCap = settlement.farmSites.length * perSite;
  const farm = take(Math.min(farmCap, 2000 + Math.max(0, remaining - 3750)));
  const forestry = forestrySite(state, settlement) === null ? 0 : take(1000);
  const builder = take(750);
  const quarry = quarrySite(state, settlement) === null ? 0 : take(Math.min(perSite, 1000));
  const extraFarm = take(farmCap - farm);
  return { farm: farm + extraFarm, forestry, quarry, builder: builder + take(remaining) };
}

function sameJobs(a: JobAllocation, b: JobAllocation): boolean {
  return JOBS.every((job) => a[job] === b[job]);
}

export function baselineCommands(state: CampaignState, civId: number): Command[] {
  const commands: Command[] = [];
  const base = { civId, issuedForTurn: state.turn + 1, expectedStateVersion: state.turn, consent: {} };
  let sequence = 0;
  const push = (command: Omit<Command, 'commandId' | 'sequence' | 'civId' | 'issuedForTurn' | 'expectedStateVersion' | 'consent'>): void => {
    sequence += 1;
    commands.push({ ...base, ...command, sequence, commandId: `${civId}:${state.turn + 1}:${sequence}` } as Command);
  };

  for (const settlement of state.settlements.filter((s) => s.ownerId === civId).sort((a, b) => a.id - b.id)) {
    const jobs = planJobs(state, settlement);
    if (!sameJobs(jobs, settlement.jobs)) push({ kind: 'SET_JOBS', actorId: settlement.id, target: null, options: jobs });
    if (settlement.queue.length > 0) continue;
    const housingSlack = housingCapacityMilli(settlement) - settlement.populationMilli;
    const canDwelling = settlement.dwellings < ECONOMY_RULES.maxDistrictParcels
      && settlement.storage.TIMBER >= units(12) && settlement.storage.STONE >= units(8);
    if (housingSlack < 1500 && canDwelling) {
      push({ kind: 'QUEUE_BUILD', actorId: settlement.id, target: settlement.cell, options: { build: 'DWELLING' } });
      continue;
    }
    const occupied = new Set(state.settlements.flatMap((s) => [s.cell, ...s.farmSites.map((f) => f.cell)]));
    const farmCell = neighbors(state.map, settlement.cell)
      .filter((cell) => cell >= 0 && !occupied.has(cell) && !isWater(state.map, cell)
        && (state.map.fertility[cell] as number) >= WORLD_RULES.minFarmFertility)
      .sort((a, b) => (state.map.fertility[b] as number) - (state.map.fertility[a] as number) || a - b)[0];
    if (farmCell !== undefined && settlement.storage.TIMBER >= units(4) && settlement.farmSites.length < 4) {
      push({ kind: 'QUEUE_BUILD', actorId: settlement.id, target: farmCell, options: { build: 'FARM' } });
    }
  }
  return commands;
}

/** Commands for every civilization this turn, in civilization order. */
export function baselineTurnCommands(state: CampaignState): Command[] {
  return state.civs.flatMap((civ) => baselineCommands(state, civ.id));
}
