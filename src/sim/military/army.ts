// Strategic military units, recruitment, movement, logistics and combat (master Sections 8.1, 8.2, 8.3, 16.5).
// All simulation data uses bounded integers; presentation and 3D scenes never live here.

import type { CampaignState } from '../core/state.ts';
import { distance } from '../world/hex.ts';
import { isWater, isWoodland } from '../world/generate.ts';
import { units } from '../core/quantity.ts';

export const COMPANY_TYPES = ['MILITIA', 'INFANTRY', 'ARCHER', 'ENGINEER', 'SIEGE'] as const;
export type CompanyType = (typeof COMPANY_TYPES)[number];

export const ARMY_STANCES = ['DEFENSIVE', 'AGGRESSIVE', 'MARCH', 'FORTIFY'] as const;
export type ArmyStance = (typeof ARMY_STANCES)[number];

export interface CompanySpec {
  readonly type: CompanyType;
  readonly baseStrength: number;
  readonly structurePower: number;
  readonly foodCost: number;
  readonly toolsCost: number;
  readonly workCost: number;
  readonly populationMilliCost: number;
  readonly requiredTech?: string | undefined;
}

/** Section 8.1 base strengths and recruitment costs. */
export const COMPANY_SPECS: Readonly<Record<CompanyType, CompanySpec>> = {
  MILITIA: {
    type: 'MILITIA',
    baseStrength: 8,
    structurePower: 8,
    foodCost: 8,
    toolsCost: 0,
    workCost: 4,
    populationMilliCost: 200,
  },
  INFANTRY: {
    type: 'INFANTRY',
    baseStrength: 14,
    structurePower: 8,
    foodCost: 12,
    toolsCost: 4,
    workCost: 6,
    populationMilliCost: 200,
  },
  ARCHER: {
    type: 'ARCHER',
    baseStrength: 10,
    structurePower: 8,
    foodCost: 12,
    toolsCost: 4,
    workCost: 6,
    populationMilliCost: 200,
  },
  ENGINEER: {
    type: 'ENGINEER',
    baseStrength: 6,
    structurePower: 8,
    foodCost: 10,
    toolsCost: 6,
    workCost: 6,
    populationMilliCost: 200,
  },
  SIEGE: {
    type: 'SIEGE',
    baseStrength: 8,
    structurePower: 30,
    foodCost: 20,
    toolsCost: 10,
    workCost: 10,
    populationMilliCost: 200,
    requiredTech: 'T-ENG-3',
  },
};

export interface CompanyState {
  readonly id: number;
  readonly type: CompanyType;
  strength: number;
  cohesion: number; // 0..100
  equipment: number; // 0..1000 permille
  rations: number;
  populationMilli: number;
  readonly originSettlementId: number;
}

export interface ArmyState {
  readonly id: number;
  readonly ownerId: number;
  cell: number;
  name: string;
  companies: CompanyState[];
  supplyReserve: number;
  stance: ArmyStance;
  apRemaining: number;
  turnsWithoutSupply: number;
}

export const ARMY_RULES = {
  maxCompaniesPerArmy: 6,
  baseAp: 2,
  marchAp: 3,
  supplyRadius: 3,
  roadSupplyRadius: 6,
  unsuppliedCohesionLoss: 15,
  foodConsumptionPerCompany: 1,
} as const;

/** Section 8.2 stance multipliers in permille (attack, defense). */
export const STANCE_MODIFIERS: Readonly<Record<ArmyStance, { readonly attack: number; readonly defense: number; readonly apBonus: number }>> = {
  DEFENSIVE: { attack: 900, defense: 1150, apBonus: 0 },
  AGGRESSIVE: { attack: 1200, defense: 850, apBonus: 0 },
  MARCH: { attack: 800, defense: 800, apBonus: 1 },
  FORTIFY: { attack: 750, defense: 1250, apBonus: -2 },
};

/** Calculates the effective combat power of an army considering terrain, stance, and company conditions. */
export function calculateArmyPower(
  state: CampaignState,
  army: ArmyState,
  isAttacker: boolean,
  fromCell?: number,
): number {
  const stanceMod = STANCE_MODIFIERS[army.stance];
  const stanceFactor = isAttacker ? stanceMod.attack : stanceMod.defense;

  // Base power summing companies
  let totalCompanyPower = 0;
  for (const c of army.companies) {
    if (c.populationMilli <= 0 || c.cohesion <= 0) continue;
    // base * (cohesion/100) * (equipment/1000) * (pop/200)
    const effectiveCompany = Math.floor(
      (c.strength * c.cohesion * c.equipment * c.populationMilli) / (100 * 1000 * 200),
    );
    totalCompanyPower += Math.max(1, effectiveCompany);
  }

  // Terrain multipliers (permille, Section 8.2)
  let terrainFactor = 1000;
  const cell = army.cell;
  const map = state.map;

  if (!isAttacker) {
    // Defender terrain advantages
    if ((map.elevation[cell] as number) >= 160) {
      terrainFactor = Math.floor((terrainFactor * 1200) / 1000); // defensive hills 1200
    }
    if (isWoodland(map, cell)) {
      terrainFactor = Math.floor((terrainFactor * 1150) / 1000); // woodland defense 1150
    }
    if (state.settlements.some((s) => s.cell === cell)) {
      terrainFactor = Math.floor((terrainFactor * 1250) / 1000); // urban defense 1250
    }
  } else if (fromCell !== undefined) {
    // River crossing attack penalty: 750 permille if crossing water or bridge
    if (isWater(map, fromCell) || (map.bridges && map.bridges[fromCell] === 1)) {
      terrainFactor = Math.floor((terrainFactor * 750) / 1000);
    }
  }

  const finalPower = Math.floor((totalCompanyPower * stanceFactor * terrainFactor) / (1000 * 1000));
  return Math.max(1, finalPower);
}

export interface CombatRoundResult {
  readonly attackerCohesionDamage: number;
  readonly defenderCohesionDamage: number;
  readonly attackerCasualtiesMilli: number;
  readonly defenderCasualtiesMilli: number;
  readonly attackerRouted: boolean;
  readonly defenderRouted: boolean;
}

/** Executes a single impulse of combat between two armies (Section 8.2). */
export function resolveArmyClash(
  state: CampaignState,
  attacker: ArmyState,
  defender: ArmyState,
  attackerFromCell?: number,
): CombatRoundResult {
  const attackPower = calculateArmyPower(state, attacker, true, attackerFromCell);
  const defensePower = calculateArmyPower(state, defender, false);

  // Section 8.2: clamp(floor(20 * attackPower / max(1, defensePower)), 2, 35)
  const defenderCohesionDamage = Math.min(35, Math.max(2, Math.floor((20 * attackPower) / Math.max(1, defensePower))));
  const attackerCohesionDamage = Math.min(35, Math.max(2, Math.floor((20 * defensePower) / Math.max(1, attackPower))));

  let attackerCasualtiesMilli = 0;
  let defenderCasualtiesMilli = 0;

  // Apply damage and casualties to defender
  for (const c of defender.companies) {
    c.cohesion = Math.max(0, c.cohesion - defenderCohesionDamage);
    const cas = Math.min(c.populationMilli, Math.floor((defenderCohesionDamage / 1000) * c.populationMilli));
    c.populationMilli -= cas;
    defenderCasualtiesMilli += cas;
  }

  // Apply damage and casualties to attacker
  for (const c of attacker.companies) {
    c.cohesion = Math.max(0, c.cohesion - attackerCohesionDamage);
    const cas = Math.min(c.populationMilli, Math.floor((attackerCohesionDamage / 1000) * c.populationMilli));
    c.populationMilli -= cas;
    attackerCasualtiesMilli += cas;
  }

  const avgAttackerCohesion =
    attacker.companies.length > 0
      ? Math.floor(attacker.companies.reduce((sum, c) => sum + c.cohesion, 0) / attacker.companies.length)
      : 0;
  const avgDefenderCohesion =
    defender.companies.length > 0
      ? Math.floor(defender.companies.reduce((sum, c) => sum + c.cohesion, 0) / defender.companies.length)
      : 0;

  const attackerRouted = avgAttackerCohesion <= 20;
  const defenderRouted = avgDefenderCohesion <= 20;

  return {
    attackerCohesionDamage,
    defenderCohesionDamage,
    attackerCasualtiesMilli,
    defenderCasualtiesMilli,
    attackerRouted,
    defenderRouted,
  };
}

/** Determines if an army is in supply range of a friendly settlement (Section 8.2). */
export function findSupplyingSettlement(
  state: CampaignState,
  army: ArmyState,
): number | null {
  const friendlySettlements = state.settlements.filter((s) => s.ownerId === army.ownerId);
  for (const settlement of friendlySettlements) {
    const dist = distance(state.map, settlement.cell, army.cell);
    // Road connection extends supply radius to 6, otherwise 3
    const hasRoadAtArmy = (state.map.roads && state.map.roads[army.cell] === 1);
    const maxDist = hasRoadAtArmy ? ARMY_RULES.roadSupplyRadius : ARMY_RULES.supplyRadius;
    if (dist <= maxDist && settlement.storage.FOOD >= units(1)) {
      return settlement.id;
    }
  }
  return null;
}

/** Resolves per-turn army logistics, rations, attrition and AP reset (Section 8.2). */
export function resolveArmiesTurn(state: CampaignState): void {
  const survivingArmies: ArmyState[] = [];

  for (const army of state.armies) {
    // 1. Reset AP according to stance
    const stanceMod = STANCE_MODIFIERS[army.stance];
    army.apRemaining = Math.max(0, ARMY_RULES.baseAp + stanceMod.apBonus);

    // Filter out completely dead companies (0 population)
    army.companies = army.companies.filter((c) => c.populationMilli > 0);
    if (army.companies.length === 0) {
      // Army dissolved from casualties
      state.history.push({
        eventId: state.history.length + 1,
        turn: state.turn,
        impulse: 0,
        type: 'WAR_ENDED',
        actorIds: [army.ownerId, army.id],
        locationIds: [army.cell],
        causeIds: [],
        observerCivIds: [army.ownerId],
        payload: {
          action: 'ARMY_DISSOLVED',
          armyId: army.id,
          reason: 'All companies eliminated',
        },
        schemaVersion: 1,
      });
      continue;
    }

    // 2. Logistics & Food upkeep (1 FOOD per company)
    const foodNeeded = army.companies.length * ARMY_RULES.foodConsumptionPerCompany;
    let foodSupplied = 0;

    if (army.supplyReserve >= foodNeeded) {
      army.supplyReserve -= foodNeeded;
      foodSupplied = foodNeeded;
    } else {
      // Consume remaining reserve
      foodSupplied += army.supplyReserve;
      army.supplyReserve = 0;
      const deficit = foodNeeded - foodSupplied;

      // Draw from friendly supplying settlement if in range
      const suppSettlementId = findSupplyingSettlement(state, army);
      if (suppSettlementId !== null) {
        const settlement = state.settlements.find((s) => s.id === suppSettlementId);
        if (settlement) {
          const availableUnits = Math.floor(settlement.storage.FOOD / 100);
          const drawn = Math.min(deficit, availableUnits);
          settlement.storage.FOOD -= units(drawn);
          foodSupplied += drawn;
        }
      }
    }

    if (foodSupplied >= foodNeeded) {
      army.turnsWithoutSupply = 0;
      // Well-supplied army recovers cohesion slightly (up to 5/turn, cap 100)
      for (const c of army.companies) {
        c.cohesion = Math.min(100, c.cohesion + 5);
      }
    } else {
      army.turnsWithoutSupply += 1;
      // Two turns without rations reduce cohesion by 15/turn (Section 8.2)
      if (army.turnsWithoutSupply >= 2) {
        for (const c of army.companies) {
          c.cohesion = Math.max(0, c.cohesion - ARMY_RULES.unsuppliedCohesionLoss);
        }
      }
    }

    survivingArmies.push(army);
  }

  state.armies = survivingArmies;
}

/** Disbands an army and returns surviving personnel to origin settlement without population duplication. */
export function disbandArmy(state: CampaignState, armyId: number): boolean {
  const index = state.armies.findIndex((a) => a.id === armyId);
  if (index === -1) return false;
  const [army] = state.armies.splice(index, 1);
  if (!army) return false;

  for (const company of army.companies) {
    if (company.populationMilli <= 0) continue;
    // Return population to origin settlement or nearest friendly settlement
    let targetSettlement = state.settlements.find((s) => s.id === company.originSettlementId);
    if (!targetSettlement || targetSettlement.ownerId !== army.ownerId) {
      targetSettlement = state.settlements.find((s) => s.ownerId === army.ownerId);
    }
    if (targetSettlement) {
      targetSettlement.populationMilli += company.populationMilli;
    }
  }

  state.history.push({
    eventId: state.history.length + 1,
    turn: state.turn,
    impulse: 0,
    type: 'TERRITORY_CHANGED',
    actorIds: [army.ownerId, army.id],
    locationIds: [army.cell],
    causeIds: [],
    observerCivIds: [army.ownerId],
    payload: {
      action: 'DISBAND_ARMY',
      armyId: army.id,
    },
    schemaVersion: 1,
  });

  return true;
}
