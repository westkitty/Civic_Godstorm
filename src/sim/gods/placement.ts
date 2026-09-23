// Starting God placement (master Sections 2.1, 3.3): a legal initial footprint near the capital on
// wild land, a safe rest site (the footprint itself), and at least twenty turns of reachable
// ecological support counted conservatively without regrowth. Deterministic scan order.

import type { MapState, SettlementState } from '../core/state.ts';
import { GOD_RULES } from '../data/rules.ts';
import { isWater } from '../world/generate.ts';
import { cellsWithin, distance } from '../world/hex.ts';
import { occupiedCells, type Pose } from './body.ts';
import { SIZE_RULES, type Genome } from './grammar.ts';

export function placeStartingGod(
  map: MapState,
  settlements: readonly SettlementState[],
  occupiedByGods: ReadonlySet<number>,
  capital: SettlementState,
  maskName: string,
  genome: Genome,
): Pose | null {
  const farms = new Set(settlements.flatMap((s) => s.farmSites.map((f) => f.cell)));
  const cores = settlements.map((s) => s.cell);
  const foreignCores = settlements.filter((s) => s.ownerId !== capital.ownerId).map((s) => s.cell);
  const needed = GOD_RULES.startSupportTurns * SIZE_RULES[genome.size].upkeep * GOD_RULES.biomassPerNutrition;
  const anchors = cellsWithin(map, capital.cell, 3)
    .filter((cell) => distance(map, cell, capital.cell) >= 2)
    .sort((a, b) => distance(map, a, capital.cell) - distance(map, b, capital.cell) || a - b);
  for (const anchor of anchors) {
    for (let heading = 0; heading < 6; heading += 1) {
      const cells = occupiedCells(map, maskName, { anchor, heading });
      if (!cells) continue;
      const legal = cells.every((cell) => !isWater(map, cell) && !farms.has(cell) && !cores.includes(cell)
        && !occupiedByGods.has(cell) && !foreignCores.some((core) => distance(map, core, cell) <= 1));
      if (!legal) continue;
      const support = cellsWithin(map, anchor, 2)
        .filter((cell) => !isWater(map, cell) && !farms.has(cell) && !cores.includes(cell))
        .reduce((sum, cell) => sum + (map.biomass[cell] as number), 0);
      if (support >= needed) return { anchor, heading };
    }
  }
  return null;
}
