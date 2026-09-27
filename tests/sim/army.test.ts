import { describe, expect, it } from 'vitest';
import { createCampaign } from '../../src/sim/campaign.ts';
import { resolveTurn } from '../../src/sim/core/turn.ts';
import { units } from '../../src/sim/core/quantity.ts';
import {
  resolveArmyClash,
  resolveArmiesTurn,
  type ArmyState,
} from '../../src/sim/military/army.ts';
import type { Command } from '../../src/sim/core/commands.ts';
import { distance, neighbors } from '../../src/sim/world/hex.ts';
import type { CivState, SettlementState } from '../../src/sim/core/state.ts';

function createTestCampaign() {
  return createCampaign({ seed: 'army-test-seed', size: 'small', civCount: 2 });
}

describe('Strategic Armies & Logistics (Sections 8.1, 8.2, 8.3, 16.5)', () => {
  it('enforces company recruitment costs and population deduction', () => {
    const campaign = createTestCampaign();
    const settlement = campaign.settlements[0]!;
    const initialPop = settlement.populationMilli;

    // Recruit Militia (8 FOOD, 0 TOOLS, 200 milli-pop)
    const recruitCmd: Command = {
      commandId: 'cmd-recruit-1',
      civId: settlement.ownerId,
      actorId: settlement.id,
      issuedForTurn: 1,
      sequence: 1,
      target: null,
      consent: {},
      expectedStateVersion: 0,
      kind: 'RECRUIT_COMPANY',
      options: {
        companyType: 'MILITIA',
      },
    };

    const res = resolveTurn(campaign, [recruitCmd]);
    expect(res.accepted).toContain('cmd-recruit-1');

    const nextSettlement = res.state.settlements.find((s: SettlementState) => s.id === settlement.id)!;
    const summary = res.state.lastTurn?.settlements.find((s) => s.settlementId === settlement.id);
    const births = summary ? summary.births : 0;
    expect(nextSettlement.populationMilli).toBe(initialPop - 200 + births);
    expect(res.state.armies.length).toBe(1);

    const army = res.state.armies[0]!;
    expect(army.ownerId).toBe(settlement.ownerId);
    expect(army.cell).toBe(settlement.cell);
    expect(army.companies.length).toBe(1);
    expect(army.companies[0]!.type).toBe('MILITIA');
    expect(army.companies[0]!.strength).toBe(8);
    expect(army.companies[0]!.cohesion).toBe(100);
    expect(army.companies[0]!.populationMilli).toBe(200);
  });

  it('gates SIEGE recruitment behind T-ENG-3 tech', () => {
    const campaign = createTestCampaign();
    const settlement = campaign.settlements[0]!;

    const siegeCmd: Command = {
      commandId: 'cmd-recruit-siege',
      civId: settlement.ownerId,
      actorId: settlement.id,
      issuedForTurn: 1,
      sequence: 1,
      target: null,
      consent: {},
      expectedStateVersion: 0,
      kind: 'RECRUIT_COMPANY',
      options: {
        companyType: 'SIEGE',
      },
    };

    // Without T-ENG-3, command is rejected with PREREQUISITE_MISSING
    const res = resolveTurn(campaign, [siegeCmd]);
    expect(res.rejections).toHaveLength(1);
    expect(res.rejections[0]!.code).toBe('PREREQUISITE_MISSING');

    // Grant T-ENG-3 and retry
    const civ = campaign.civs.find((c: CivState) => c.id === settlement.ownerId)!;
    civ.completedTechs.push('T-ENG-3');
    // Ensure sufficient resources
    settlement.storage.TOOLS = units(20);
    settlement.storage.FOOD = units(50);

    const res2 = resolveTurn(campaign, [siegeCmd]);
    expect(res2.accepted).toContain('cmd-recruit-siege');
    expect(res2.state.armies[0]!.companies[0]!.type).toBe('SIEGE');
    expect(res2.state.armies[0]!.companies[0]!.strength).toBe(8);
  });

  it('caps army companies at 6', () => {
    const campaign = createTestCampaign();
    const settlement = campaign.settlements[0]!;
    settlement.storage.FOOD = units(100);
    settlement.populationMilli = 5000;

    // Create army with 6 companies already
    const army: ArmyState = {
      id: campaign.nextEntityId++,
      ownerId: settlement.ownerId,
      cell: settlement.cell,
      name: 'Full Army',
      companies: Array.from({ length: 6 }, () => ({
        id: campaign.nextEntityId++,
        type: 'MILITIA',
        strength: 8,
        cohesion: 100,
        equipment: 1000,
        rations: 2,
        populationMilli: 200,
        originSettlementId: settlement.id,
      })),
      supplyReserve: 10,
      stance: 'DEFENSIVE',
      apRemaining: 2,
      turnsWithoutSupply: 0,
    };
    campaign.armies.push(army);

    // Try recruiting specifically into this army
    const recruitIntoFull: Command = {
      commandId: 'cmd-recruit-overflow',
      civId: settlement.ownerId,
      actorId: settlement.id,
      issuedForTurn: 1,
      sequence: 1,
      target: null,
      consent: {},
      expectedStateVersion: 0,
      kind: 'RECRUIT_COMPANY',
      options: {
        companyType: 'MILITIA',
        armyId: army.id,
      },
    };

    const res = resolveTurn(campaign, [recruitIntoFull]);
    expect(res.rejections).toHaveLength(1);
    expect(res.rejections[0]!.code).toBe('CAPACITY_REACHED');
  });

  it('manages movement AP and stance restrictions', () => {
    const campaign = createTestCampaign();
    const settlement = campaign.settlements[0]!;
    const adjCells = neighbors(campaign.map, settlement.cell);
    const validStep = adjCells.find((c) => (campaign.map.elevation[c] as number) >= 90)!;

    const army: ArmyState = {
      id: campaign.nextEntityId++,
      ownerId: settlement.ownerId,
      cell: settlement.cell,
      name: 'Mobile Army',
      companies: [
        {
          id: campaign.nextEntityId++,
          type: 'INFANTRY',
          strength: 14,
          cohesion: 100,
          equipment: 1000,
          rations: 2,
          populationMilli: 200,
          originSettlementId: settlement.id,
        },
      ],
      supplyReserve: 4,
      stance: 'DEFENSIVE',
      apRemaining: 2,
      turnsWithoutSupply: 0,
    };
    campaign.armies.push(army);

    // 1. Move to adjacent cell
    const moveCmd: Command = {
      commandId: 'cmd-move-1',
      civId: settlement.ownerId,
      actorId: army.id,
      issuedForTurn: 1,
      sequence: 1,
      target: null,
      consent: {},
      expectedStateVersion: 0,
      kind: 'ARMY_MOVE',
      options: {
        armyId: army.id,
        path: [validStep],
      },
    };

    const res = resolveTurn(campaign, [moveCmd]);
    expect(res.accepted).toContain('cmd-move-1');
    const movedArmy = res.state.armies.find((a) => a.id === army.id)!;
    expect(movedArmy.cell).toBe(validStep);

    // 2. Change stance to FORTIFY and verify movement is blocked
    const fortifyCmd: Command = {
      commandId: 'cmd-stance-fortify',
      civId: settlement.ownerId,
      actorId: movedArmy.id,
      issuedForTurn: 2,
      sequence: 1,
      target: null,
      consent: {},
      expectedStateVersion: 1,
      kind: 'ARMY_STANCE',
      options: {
        armyId: movedArmy.id,
        stance: 'FORTIFY',
      },
    };
    const res2 = resolveTurn(res.state, [fortifyCmd]);
    expect(res2.accepted).toContain('cmd-stance-fortify');
    const fortifiedArmy = res2.state.armies.find((a) => a.id === army.id)!;
    expect(fortifiedArmy.stance).toBe('FORTIFY');

    const tryMoveWhileFortified: Command = {
      commandId: 'cmd-move-fortified',
      civId: settlement.ownerId,
      actorId: fortifiedArmy.id,
      issuedForTurn: 3,
      sequence: 1,
      target: null,
      consent: {},
      expectedStateVersion: 2,
      kind: 'ARMY_MOVE',
      options: {
        armyId: fortifiedArmy.id,
        path: [settlement.cell],
      },
    };
    const res3 = resolveTurn(res2.state, [tryMoveWhileFortified]);
    expect(res3.rejections).toHaveLength(1);
    expect(res3.rejections[0]!.code).toBe('UNSUPPORTED_STATE');
  });

  it('resolves logistics, supply radius, and unsupplied cohesion attrition', () => {
    const campaign = createTestCampaign();
    const settlement = campaign.settlements[0]!;

    // Place an army far away from all settlements (> 6 steps) with 0 reserve
    let farCell = -1;
    for (let c = 0; c < campaign.map.elevation.length; c++) {
      if ((campaign.map.elevation[c] as number) >= 90 && campaign.settlements.every((s) => distance(campaign.map, s.cell, c) > 6)) {
        farCell = c;
        break;
      }
    }
    if (farCell === -1) {
      farCell = (settlement.cell + 100) % campaign.map.elevation.length;
    }

    const starvingArmy: ArmyState = {
      id: campaign.nextEntityId++,
      ownerId: settlement.ownerId,
      cell: farCell,
      name: 'Expeditionary Force',
      companies: [
        {
          id: campaign.nextEntityId++,
          type: 'INFANTRY',
          strength: 14,
          cohesion: 100,
          equipment: 1000,
          rations: 0,
          populationMilli: 200,
          originSettlementId: settlement.id,
        },
      ],
      supplyReserve: 0,
      stance: 'DEFENSIVE',
      apRemaining: 2,
      turnsWithoutSupply: 1, // Already missed 1 turn
    };
    campaign.armies.push(starvingArmy);

    // Turn resolution with no supply: turnsWithoutSupply becomes 2, inflicting 15 cohesion loss
    resolveArmiesTurn(campaign);
    expect(starvingArmy.turnsWithoutSupply).toBe(2);
    expect(starvingArmy.companies[0]!.cohesion).toBe(85);

    // Another turn: cohesion drops another 15 -> 70
    resolveArmiesTurn(campaign);
    expect(starvingArmy.turnsWithoutSupply).toBe(3);
    expect(starvingArmy.companies[0]!.cohesion).toBe(70);
  });

  it('resolves deterministic combat between opposing armies with terrain and cohesion loss', () => {
    const campaign = createTestCampaign();
    const civA = campaign.civs[0]!;
    const civB = campaign.civs[1]!;
    const settlementA = campaign.settlements.find((s: SettlementState) => s.ownerId === civA.id)!;
    const settlementB = campaign.settlements.find((s: SettlementState) => s.ownerId === civB.id)!;

    const armyA: ArmyState = {
      id: 101,
      ownerId: civA.id,
      cell: 10,
      name: 'Civ A Vanguard',
      companies: [
        {
          id: 1,
          type: 'INFANTRY',
          strength: 14,
          cohesion: 100,
          equipment: 1000,
          rations: 2,
          populationMilli: 200,
          originSettlementId: settlementA.id,
        },
      ],
      supplyReserve: 4,
      stance: 'AGGRESSIVE',
      apRemaining: 2,
      turnsWithoutSupply: 0,
    };

    const armyB: ArmyState = {
      id: 102,
      ownerId: civB.id,
      cell: 10,
      name: 'Civ B Garrison',
      companies: [
        {
          id: 2,
          type: 'MILITIA',
          strength: 8,
          cohesion: 100,
          equipment: 1000,
          rations: 2,
          populationMilli: 200,
          originSettlementId: settlementB.id,
        },
      ],
      supplyReserve: 4,
      stance: 'DEFENSIVE',
      apRemaining: 2,
      turnsWithoutSupply: 0,
    };

    const clash = resolveArmyClash(campaign, armyA, armyB);
    expect(clash.attackerCohesionDamage).toBeGreaterThanOrEqual(2);
    expect(clash.defenderCohesionDamage).toBeGreaterThanOrEqual(2);
    // Infantry attacking Militia deals more damage to Militia than Militia deals to Infantry
    expect(clash.defenderCohesionDamage).toBeGreaterThan(clash.attackerCohesionDamage);

    // Defender cohesion dropped and took casualties
    expect(armyB.companies[0]!.cohesion).toBeLessThan(100);
    expect(armyB.companies[0]!.populationMilli).toBeLessThan(200);
  });

  it('inflicts 50 cohesion damage when a God strikes a cell with armies (Section 8.3)', () => {
    const campaign = createTestCampaign();
    const god = campaign.gods[0]!;
    const adjCells = neighbors(campaign.map, god.anchor);
    const targetCell = adjCells[0]!;

    const targetArmy: ArmyState = {
      id: campaign.nextEntityId++,
      ownerId: campaign.civs[1]!.id,
      cell: targetCell,
      name: 'Enemy Target Army',
      companies: [
        {
          id: campaign.nextEntityId++,
          type: 'INFANTRY',
          strength: 14,
          cohesion: 100,
          equipment: 1000,
          rations: 2,
          populationMilli: 200,
          originSettlementId: campaign.settlements[1]!.id,
        },
      ],
      supplyReserve: 0,
      stance: 'DEFENSIVE',
      apRemaining: 2,
      turnsWithoutSupply: 0,
    };
    campaign.armies.push(targetArmy);

    // God strikes targetCell
    const strikeCmd: Command = {
      commandId: 'cmd-god-strike-army',
      civId: god.ownerId,
      actorId: god.id,
      issuedForTurn: 1,
      sequence: 1,
      target: targetCell,
      consent: {},
      expectedStateVersion: 0,
      kind: 'GOD_STRIKE',
      options: {
        targetCell,
      },
    };

    const res = resolveTurn(campaign, [strikeCmd]);
    expect(res.accepted).toContain('cmd-god-strike-army');

    const hitArmy = res.state.armies.find((a) => a.id === targetArmy.id)!;
    // Section 8.3: 50 cohesion damage
    expect(hitArmy.companies[0]!.cohesion).toBe(50);
    expect(hitArmy.companies[0]!.populationMilli).toBeLessThan(200);
  });

  it('disbands army and restores population to origin settlement without duplication', () => {
    const campaign = createTestCampaign();
    const settlement = campaign.settlements[0]!;
    const startPop = settlement.populationMilli;

    const army: ArmyState = {
      id: campaign.nextEntityId++,
      ownerId: settlement.ownerId,
      cell: settlement.cell,
      name: 'Army To Disband',
      companies: [
        {
          id: campaign.nextEntityId++,
          type: 'INFANTRY',
          strength: 14,
          cohesion: 100,
          equipment: 1000,
          rations: 2,
          populationMilli: 180, // slightly damaged company
          originSettlementId: settlement.id,
        },
      ],
      supplyReserve: 2,
      stance: 'DEFENSIVE',
      apRemaining: 2,
      turnsWithoutSupply: 0,
    };
    campaign.armies.push(army);

    const disbandCmd: Command = {
      commandId: 'cmd-disband',
      civId: settlement.ownerId,
      actorId: army.id,
      issuedForTurn: 1,
      sequence: 1,
      target: null,
      consent: {},
      expectedStateVersion: 0,
      kind: 'DISBAND_ARMY',
      options: {
        armyId: army.id,
      },
    };

    const res = resolveTurn(campaign, [disbandCmd]);
    expect(res.accepted).toContain('cmd-disband');
    expect(res.state.armies.some((a) => a.id === army.id)).toBe(false);

    const settlementAfter = res.state.settlements.find((s: SettlementState) => s.id === settlement.id)!;
    // Population restored (startPop + 180, plus normal turn births/deaths)
    expect(settlementAfter.populationMilli).toBeGreaterThanOrEqual(startPop + 180);
  });
});
