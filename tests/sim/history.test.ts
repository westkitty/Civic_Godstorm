import { describe, expect, it } from 'vitest';
import { createCampaign } from '../../src/sim/campaign.ts';
import {
  buildChronicle,
  formatHistoryProse,
  getAllConsequences,
  getAncestralCausalChain,
  getDirectCauses,
  getDirectConsequences,
  queryHistory,
  recordHistoryEvent,
} from '../../src/sim/core/history.ts';

describe('Causal World History Event Ledger (master Section 13.1)', () => {
  it('records events with monotonic IDs and causal DAG validation', () => {
    const campaign = createCampaign({ seed: 'hist-test', size: 'small', civCount: 2 });
    const initialCount = campaign.history.length;
    const initialNextId = campaign.nextEventId;

    const event1 = recordHistoryEvent(campaign, {
      turn: 1,
      type: 'GOD_STRIKE',
      actorIds: [0],
      locationIds: [45],
      observerCivIds: [0],
      payload: { godId: 0, targetCell: 45 },
    });

    expect(event1.eventId).toBeGreaterThanOrEqual(initialNextId);
    expect(campaign.history.length).toBe(initialCount + 1);
    expect(campaign.nextEventId).toBe(event1.eventId + 1);

    // Event 2 caused by event 1
    const event2 = recordHistoryEvent(campaign, {
      turn: 1,
      type: 'ROUTE_CHANGED',
      actorIds: [0],
      locationIds: [45],
      causeIds: [event1.eventId],
      observerCivIds: [0],
      payload: { cell: 45, reason: 'crushed by strike' },
    });

    expect(event2.eventId).toBe(event1.eventId + 1);
    expect(event2.causeIds).toEqual([event1.eventId]);

    // Invalid causeId (forward reference) should be discarded
    const event3 = recordHistoryEvent(campaign, {
      turn: 2,
      type: 'GOD_GUARD',
      actorIds: [0],
      locationIds: [45],
      causeIds: [9999], // Future or invalid ID
      observerCivIds: [0],
      payload: {},
    });
    expect(event3.causeIds).toEqual([]);
  });

  it('traverses ancestral causes and consequence trees through the DAG', () => {
    const campaign = createCampaign({ seed: 'hist-test', size: 'small', civCount: 2 });

    // Causal chain: WOUNDED -> DIED -> CORPSE_STAGE_CHANGED -> CORPSE_HARVESTED
    const eWound = recordHistoryEvent(campaign, {
      turn: 5,
      type: 'GOD_WOUNDED',
      actorIds: [0],
      locationIds: [10],
      observerCivIds: [0],
      payload: { godId: 0, woundType: 'FRACTURE', severity: 2, region: 'locomotor' },
    });

    const eDeath = recordHistoryEvent(campaign, {
      turn: 8,
      type: 'GOD_DIED',
      actorIds: [0],
      locationIds: [10],
      causeIds: [eWound.eventId],
      observerCivIds: [0],
      payload: { godId: 0 },
    });

    const eRemains = recordHistoryEvent(campaign, {
      turn: 18,
      type: 'CORPSE_STAGE_CHANGED',
      actorIds: [0],
      locationIds: [10],
      causeIds: [eDeath.eventId],
      observerCivIds: [0],
      payload: { godId: 0, stage: 'OSSUARY' },
    });

    const eHarvest = recordHistoryEvent(campaign, {
      turn: 20,
      type: 'CORPSE_HARVESTED',
      actorIds: [0, 0],
      locationIds: [10],
      causeIds: [eRemains.eventId],
      observerCivIds: [0],
      payload: { godId: 0, settlementId: 0, resource: 'STONE', units: 10 },
    });

    // Direct causes
    const directCauses = getDirectCauses(campaign, eRemains.eventId);
    expect(directCauses).toHaveLength(1);
    expect(directCauses[0]?.eventId).toBe(eDeath.eventId);

    // Full ancestral chain
    const ancestors = getAncestralCausalChain(campaign, eHarvest.eventId);
    expect(ancestors.map((a) => a.eventId)).toEqual([eWound.eventId, eDeath.eventId, eRemains.eventId]);

    // Direct consequences
    const directConsequences = getDirectConsequences(campaign, eDeath.eventId);
    expect(directConsequences.map((c) => c.eventId)).toEqual([eRemains.eventId]);

    // All downstream consequences
    const allConsequences = getAllConsequences(campaign, eWound.eventId);
    expect(allConsequences.map((c) => c.eventId)).toEqual([eDeath.eventId, eRemains.eventId, eHarvest.eventId]);
  });

  it('formats deterministic authored prose templates for varied event types', () => {
    const campaign = createCampaign({ seed: 'hist-test', size: 'small', civCount: 2 });

    const e1 = recordHistoryEvent(campaign, {
      turn: 1,
      type: 'CITY_FOUNDED',
      actorIds: [0, 1],
      locationIds: [12],
      observerCivIds: [0],
      payload: { name: 'Dawn Haven' },
    });
    const text1 = formatHistoryProse(e1, campaign);
    expect(text1).toContain('Dawn Haven');
    expect(text1).toContain('cell 12');

    const e2 = recordHistoryEvent(campaign, {
      turn: 4,
      type: 'TECH_RESEARCHED',
      actorIds: [0],
      locationIds: [],
      observerCivIds: [0],
      payload: { name: 'Selective Breeding', techId: 'T-ECO-1' },
    });
    const text2 = formatHistoryProse(e2, campaign);
    expect(text2).toContain('Selective Breeding');

    const e3 = recordHistoryEvent(campaign, {
      turn: 7,
      type: 'ROUTE_CHANGED',
      actorIds: [0],
      locationIds: [33],
      observerCivIds: [0],
      payload: { cell: 33, reason: 'massive trampling' },
    });
    const text3 = formatHistoryProse(e3, campaign);
    expect(text3).toContain('massive trampling');
    expect(text3).toContain('cell 33');
  });

  it('filters historical events by observer civilization and query criteria', () => {
    const campaign = createCampaign({ seed: 'hist-test', size: 'small', civCount: 2 });

    recordHistoryEvent(campaign, {
      turn: 3,
      type: 'TECH_RESEARCHED',
      actorIds: [0],
      locationIds: [],
      observerCivIds: [0],
      payload: { techId: 'T-INS-1' },
    });

    recordHistoryEvent(campaign, {
      turn: 4,
      type: 'TECH_RESEARCHED',
      actorIds: [1],
      locationIds: [],
      observerCivIds: [1],
      payload: { techId: 'T-ENG-1' },
    });

    // Civ 0 observer filter
    const civ0Events = queryHistory(campaign, { observerCivId: 0, types: ['TECH_RESEARCHED'] });
    expect(civ0Events.every((e) => e.observerCivIds.includes(0))).toBe(true);

    // Turn range filter
    const turnRangeEvents = queryHistory(campaign, { minTurn: 4, maxTurn: 4 });
    expect(turnRangeEvents.every((e) => e.turn === 4)).toBe(true);
  });

  it('constructs a displayable chronicle with causal links and prose', () => {
    const campaign = createCampaign({ seed: 'hist-test', size: 'small', civCount: 2 });
    const civId = campaign.civs[0]!.id;
    const chronicle = buildChronicle(campaign, civId);

    expect(chronicle.length).toBeGreaterThan(0);
    for (const entry of chronicle) {
      expect(entry.eventId).toBeGreaterThan(0);
      expect(typeof entry.text).toBe('string');
      expect(entry.text.length).toBeGreaterThan(0);
      expect(Array.isArray(entry.causes)).toBe(true);
      expect(Array.isArray(entry.consequences)).toBe(true);
    }
  });
});
