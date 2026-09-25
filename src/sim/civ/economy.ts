// Turn step 5 for one settlement (master Sections 2.2, 6.1-6.3, 16.5), M01 subset: labour trim,
// production with exact carried remainders, household consumption, spoilage, dues/upkeep, welfare,
// growth or famine, and construction. Conservation: people change only by named births/deaths;
// goods change only by named production, consumption, spoilage and construction debits.

import { forestrySite, housingCapacityMilli, laborMilli, quarrySite } from '../core/commands.ts';
import { occupiedCells } from '../gods/body.ts';
import { checked, units } from '../core/quantity.ts';
import type { CampaignState, SettlementState, SettlementTurnSummary } from '../core/state.ts';
import { ECONOMY_RULES, PHYSICAL_RESOURCES, type BuildKind, type PhysicalResource } from '../data/rules.ts';

const TRIM_ORDER = ['builder', 'quarry', 'forestry', 'farm'] as const;

function emptyLedger(): Record<PhysicalResource, number> {
  return Object.fromEntries(PHYSICAL_RESOURCES.map((resource) => [resource, 0])) as Record<PhysicalResource, number>;
}

/** Adds numerator/denominator to a carried remainder and returns the whole part. */
function carryDivide(settlement: SettlementState, key: string, numerator: number, denominator: number): number {
  const total = checked(numerator + (settlement.carry[key] ?? 0));
  settlement.carry[key] = total % denominator;
  return Math.floor(total / denominator);
}

function trimLabor(settlement: SettlementState, warnings: string[]): void {
  let excess = Object.values(settlement.jobs).reduce((sum, value) => sum + value, 0) - laborMilli(settlement);
  for (const job of TRIM_ORDER) {
    if (excess <= 0) break;
    const cut = Math.min(excess, settlement.jobs[job]);
    settlement.jobs[job] -= cut;
    excess -= cut;
    if (cut > 0) warnings.push(`LABOR_TRIMMED:${job}`);
  }
}

export function welfareOf(settlement: SettlementState, foodCoverage: number): number {
  const weights = ECONOMY_RULES.welfareWeights;
  const population = settlement.populationMilli;
  const housing = population === 0 ? 1000 : Math.min(1000, Math.floor((housingCapacityMilli(settlement) * 1000) / population));
  return Math.floor(
    (weights.food * foodCoverage +
      weights.housing * housing +
      weights.health * ECONOMY_RULES.baseHealth +
      weights.safety * ECONOMY_RULES.baseSafety +
      weights.participation * settlement.legitimacy) /
      1000,
  );
}

export function runSettlementTurn(state: CampaignState, settlement: SettlementState): SettlementTurnSummary {
  const map = state.map;
  const civ = state.civs.find((c) => c.id === settlement.ownerId);
  if (!civ) throw new Error(`settlement ${settlement.id} has no owner`);
  const produced = emptyLedger();
  const spoiled = emptyLedger();
  const warnings: string[] = [];
  const completed: BuildKind[] = [];

  trimLabor(settlement, warnings);

  // Farms: 4 FOOD x fertility/1000 per worker, filling sites four workers at a time. A parcel under a
  // God body cannot be farmed that turn (Section 6.3).
  const underBodies = new Set(state.gods.filter((g) => g.lifecycle === 'ALIVE').flatMap((g) => occupiedCells(state.map, g.maskName, g) ?? []));
  let farmNumerator = 0;
  let farmWorkers = settlement.jobs.farm;
  for (const site of settlement.farmSites) {
    if (underBodies.has(site.cell)) {
      warnings.push('FARM_UNDER_GOD');
      continue;
    }
    const workers = Math.min(farmWorkers, ECONOMY_RULES.maxWorkersPerSite * 1000);
    farmWorkers -= workers;
    farmNumerator += ECONOMY_RULES.farmFoodPerWorker * 100 * (map.fertility[site.cell] as number) * workers;
  }
  produced.FOOD += carryDivide(settlement, 'farm', farmNumerator, 1_000_000);

  // Forestry: 3 TIMBER per worker, drawing down woodland biomass (10 pool units per TIMBER).
  const woodland = forestrySite(state, settlement);
  if (settlement.jobs.forestry > 0 && woodland !== null) {
    let timber = carryDivide(settlement, 'forestry', ECONOMY_RULES.forestryTimberPerWorker * 100 * settlement.jobs.forestry, 1000);
    const available = Math.floor(((map.biomass[woodland] as number) * 100) / ECONOMY_RULES.biomassPerTimber);
    if (timber > available) {
      timber = available;
      warnings.push('FORESTRY_BIOMASS_LIMITED');
    }
    map.biomass[woodland] = (map.biomass[woodland] as number) - Math.ceil((timber * ECONOMY_RULES.biomassPerTimber) / 100);
    produced.TIMBER += timber;
  }

  // Quarry: 3 STONE per worker from a finite reserve.
  const quarry = quarrySite(state, settlement);
  if (settlement.jobs.quarry > 0 && quarry !== null) {
    let stone = carryDivide(settlement, 'quarry', ECONOMY_RULES.quarryStonePerWorker * 100 * settlement.jobs.quarry, 1000);
    const available = (map.stoneReserve[quarry] as number) * 100;
    if (stone > available) {
      stone = available;
      warnings.push('QUARRY_RESERVE_LIMITED');
    }
    map.stoneReserve[quarry] = (map.stoneReserve[quarry] as number) - Math.ceil(stone / 100);
    produced.STONE += stone;
  }

  produced.FOOD += units(ECONOMY_RULES.baseFoodYield);
  civ.knowledge += units(ECONOMY_RULES.baseKnowledgeYield);
  for (const resource of PHYSICAL_RESOURCES) settlement.storage[resource] += produced[resource];

  // Households: 2 FOOD per full population unit.
  const requiredFood = carryDivide(settlement, 'household', settlement.populationMilli * ECONOMY_RULES.householdFoodPerPop * 100, 1000);
  const consumedFood = Math.min(settlement.storage.FOOD, requiredFood);
  settlement.storage.FOOD -= consumedFood;
  const coverage = requiredFood === 0 ? 1000 : Math.floor((consumedFood * 1000) / requiredFood);
  settlement.foodCoverage = coverage;
  if (coverage < 1000) warnings.push('FOOD_SHORTAGE');

  // Overflow above storage capacity spoils at 10% per turn.
  const capacity = units(ECONOMY_RULES.baseStorage);
  for (const resource of PHYSICAL_RESOURCES) {
    const overflow = settlement.storage[resource] - capacity;
    if (overflow > 0) {
      const loss = Math.floor((overflow * ECONOMY_RULES.spoilagePercent) / 100);
      settlement.storage[resource] -= loss;
      spoiled[resource] = loss;
      if (loss > 0) warnings.push(`SPOILAGE:${resource}`);
    }
  }

  // Dues and HALL upkeep (civilization COIN ledger).
  if (coverage >= ECONOMY_RULES.duesFoodCoverageFloor) {
    civ.coin += units(ECONOMY_RULES.duesPerPop * Math.floor(settlement.populationMilli / 1000));
  }
  const upkeep = units(ECONOMY_RULES.hallUpkeep);
  if (civ.coin >= upkeep) {
    civ.coin -= upkeep;
  } else {
    settlement.hallIntegrity = Math.max(0, settlement.hallIntegrity - ECONOMY_RULES.unpaidIntegrityLoss);
    warnings.push('UPKEEP_UNPAID');
  }

  settlement.welfare = welfareOf(settlement, coverage);

  // Population: famine after the grace period, otherwise bounded growth.
  let births = 0;
  let deaths = 0;
  settlement.shortageTurns = coverage < 1000 ? settlement.shortageTurns + 1 : 0;
  if (settlement.shortageTurns > ECONOMY_RULES.famineGraceTurns) {
    const unfed = Math.floor((settlement.populationMilli * (1000 - coverage)) / 1000);
    deaths = Math.min(settlement.populationMilli, Math.ceil((unfed * ECONOMY_RULES.famineDeathPercent) / 100));
    settlement.populationMilli -= deaths;
  } else {
    const housing = housingCapacityMilli(settlement);
    const cap = Math.min(housing, ECONOMY_RULES.maxSettlementPopulation * 1000);
    const reserveOk = settlement.storage.FOOD >= requiredFood * ECONOMY_RULES.growthReserveTurns;
    if (settlement.welfare >= ECONOMY_RULES.growthWelfareFloor && reserveOk && settlement.populationMilli < cap) {
      births = Math.min(
        ECONOMY_RULES.growthCapMilli,
        Math.floor((settlement.populationMilli * ECONOMY_RULES.growthPercent) / 100),
        cap - settlement.populationMilli,
      );
      settlement.populationMilli += births;
    }
  }

  // Construction: 4 work per builder; materials were reserved at queue time.
  let work = carryDivide(settlement, 'builder', ECONOMY_RULES.workPerBuilder * 100 * settlement.jobs.builder, 1000);
  const workApplied = work;
  while (work > 0 && settlement.queue.length > 0) {
    const item = settlement.queue[0];
    if (!item) break;
    const step = Math.min(work, item.workRequired - item.workDone);
    item.workDone += step;
    work -= step;
    if (item.workDone >= item.workRequired) {
      settlement.queue.shift();
      completed.push(item.kind);
      if (item.kind === 'DWELLING') settlement.dwellings += 1;
      else settlement.farmSites.push({ cell: item.cell });
    }
  }
  if (work > 0 && settlement.jobs.builder > 0) warnings.push('BUILDERS_IDLE');

  return {
    settlementId: settlement.id,
    produced,
    consumedFood,
    requiredFood,
    spoiled,
    births,
    deaths,
    workApplied: workApplied - work,
    completed,
    warnings,
  };
}
