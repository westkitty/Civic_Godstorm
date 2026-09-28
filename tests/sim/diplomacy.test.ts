import { describe, expect, it } from 'vitest';
import { createCampaign } from '../../src/sim/campaign.ts';
import { resolveTurn, assertInvariants } from '../../src/sim/core/turn.ts';
import type { Command } from '../../src/sim/core/commands.ts';
import {
  getDiplomaticRelation,
  hasActiveClause,
  validateCellPassage,
} from '../../src/sim/diplomacy/treaty.ts';
import type { SettlementState } from '../../src/sim/core/state.ts';

function createTestCampaign() {
  return createCampaign({ seed: 'diplo-test-seed', size: 'small', civCount: 2 });
}

describe('Treaties, Border Easements & Diplomacy (Sections 9.1, 9.2)', () => {
  it('initializes pairwise diplomatic relations between starting civilizations', () => {
    const campaign = createTestCampaign();
    expect(campaign.diplomacy.length).toBe(1); // 2 civs -> 1 pairwise relation
    const rel = campaign.diplomacy[0]!;
    expect(rel.trust).toBe(0);
    expect(rel.atWar).toBe(false);
    expect(rel.contact).toBe(true);
    expect(campaign.treaties).toEqual([]);
    expect(() => assertInvariants(campaign)).not.toThrow();
  });

  it('proposes and auto-signs a treaty with AI recipient', () => {
    const campaign = createTestCampaign();
    const civ0 = campaign.civs[0]!;
    const civ1 = campaign.civs[1]!;

    const proposeCmd: Command = {
      commandId: 'cmd-treaty-1',
      civId: civ0.id,
      actorId: civ0.id,
      issuedForTurn: 1,
      sequence: 1,
      target: null,
      consent: {},
      expectedStateVersion: 0,
      kind: 'PROPOSE_TREATY',
      options: {
        recipientCivId: civ1.id,
        clauses: [
          { id: 'D-BORDER', cells: [], terms: {} },
          { id: 'D-PASSAGE', cells: [], terms: {} },
          { id: 'D-RESEARCH', cells: [], terms: {} },
        ],
        endTurn: 10,
        terminationNoticeTurns: 2,
      },
    };

    const res = resolveTurn(campaign, [proposeCmd]);
    expect(res.accepted).toContain('cmd-treaty-1');
    expect(res.state.treaties.length).toBe(1);

    const treaty = res.state.treaties[0]!;
    expect(treaty.status).toBe('ACTIVE');
    expect(treaty.proposerCivId).toBe(civ0.id);
    expect(treaty.recipientCivId).toBe(civ1.id);
    expect(treaty.clauses.map((c) => c.id)).toEqual(['D-BORDER', 'D-PASSAGE', 'D-RESEARCH']);

    // Trust should have increased by +100
    const rel = getDiplomaticRelation(res.state, civ0.id, civ1.id);
    expect(rel?.trust).toBe(100);

    // TREATY_SIGNED event in history
    const signedEvent = res.state.history.find((e) => e.type === 'TREATY_SIGNED');
    expect(signedEvent).toBeDefined();
    expect(signedEvent?.actorIds).toContain(civ0.id);
    expect(signedEvent?.actorIds).toContain(civ1.id);
  });

  it('awards research bonus each turn under active D-RESEARCH clause', () => {
    const campaign = createTestCampaign();
    const civ0 = campaign.civs[0]!;
    const civ1 = campaign.civs[1]!;

    const initialK0 = civ0.knowledge;
    const initialK1 = civ1.knowledge;

    const proposeCmd: Command = {
      commandId: 'cmd-research-treaty',
      civId: civ0.id,
      actorId: civ0.id,
      issuedForTurn: 1,
      sequence: 1,
      target: null,
      consent: {},
      expectedStateVersion: 0,
      kind: 'PROPOSE_TREATY',
      options: {
        recipientCivId: civ1.id,
        clauses: [{ id: 'D-RESEARCH', cells: [], terms: {} }],
        endTurn: 5,
        terminationNoticeTurns: 1,
      },
    };

    // Turn 1: Propose and activate
    const controlRes = resolveTurn(createTestCampaign(), []);
    const baseGain0 = controlRes.state.civs.find((c) => c.id === civ0.id)!.knowledge - initialK0;
    const baseGain1 = controlRes.state.civs.find((c) => c.id === civ1.id)!.knowledge - initialK1;

    const res1 = resolveTurn(campaign, [proposeCmd]);
    expect(res1.accepted).toContain('cmd-research-treaty');

    // Turn 1 resolveDiplomacyTurn should have awarded +1 knowledge to each party on top of base
    const nextCiv0 = res1.state.civs.find((c) => c.id === civ0.id)!;
    const nextCiv1 = res1.state.civs.find((c) => c.id === civ1.id)!;
    expect(nextCiv0.knowledge).toBe(initialK0 + baseGain0 + 1);
    expect(nextCiv1.knowledge).toBe(initialK1 + baseGain1 + 1);

    // Turn 2 without commands: another +1
    const controlRes2 = resolveTurn(controlRes.state, []);
    const baseGain0T2 = controlRes2.state.civs.find((c) => c.id === civ0.id)!.knowledge - initialK0;
    const baseGain1T2 = controlRes2.state.civs.find((c) => c.id === civ1.id)!.knowledge - initialK1;

    const res2 = resolveTurn(res1.state, []);
    const c0T2 = res2.state.civs.find((c) => c.id === civ0.id)!;
    const c1T2 = res2.state.civs.find((c) => c.id === civ1.id)!;
    expect(c0T2.knowledge).toBe(initialK0 + baseGain0T2 + 2);
    expect(c1T2.knowledge).toBe(initialK1 + baseGain1T2 + 2);
  });

  it('enforces passage rights for foreign army movement', () => {
    const campaign = createTestCampaign();
    const civ0 = campaign.civs[0]!;
    const civ1 = campaign.civs[1]!;
    const s1 = campaign.settlements.find((s) => s.ownerId === civ1.id)!;

    // Without passage treaty, civ0 cannot move into s1.cell
    const passagePre = validateCellPassage(campaign, civ0.id, s1.cell, false);
    expect(passagePre.ok).toBe(false);
    expect(passagePre.reason).toContain('Requires D-PASSAGE or D-BORDER');

    // Add D-PASSAGE treaty
    campaign.treaties.push({
      id: 1,
      proposerCivId: civ0.id,
      recipientCivId: civ1.id,
      clauses: [{ id: 'D-PASSAGE', cells: [], terms: {} }],
      startTurn: 1,
      endTurn: null,
      terminationNoticeTurns: 1,
      status: 'ACTIVE',
      causeEventId: 0,
    });

    const passagePost = validateCellPassage(campaign, civ0.id, s1.cell, false);
    expect(passagePost.ok).toBe(true);
    expect(hasActiveClause(campaign, civ0.id, civ1.id, 'D-PASSAGE')).toBe(true);
  });

  it('validates God passage under D-GOD-CORRIDOR with mass limits', () => {
    const campaign = createTestCampaign();
    const civ0 = campaign.civs[0]!;
    const civ1 = campaign.civs[1]!;
    const s1 = campaign.settlements.find((s) => s.ownerId === civ1.id)!;

    // Without corridor, God cannot transit
    const godPassPre = validateCellPassage(campaign, civ0.id, s1.cell, true, 50);
    expect(godPassPre.ok).toBe(false);
    expect(godPassPre.reason).toContain('Requires D-GOD-CORRIDOR');

    // Add corridor with maxMass = 40
    campaign.treaties.push({
      id: 1,
      proposerCivId: civ0.id,
      recipientCivId: civ1.id,
      clauses: [{ id: 'D-GOD-CORRIDOR', cells: [s1.cell], terms: { maxMass: 40 } }],
      startTurn: 1,
      endTurn: null,
      terminationNoticeTurns: 1,
      status: 'ACTIVE',
      causeEventId: 0,
    });

    // 50 > 40 -> rejected
    expect(validateCellPassage(campaign, civ0.id, s1.cell, true, 50).ok).toBe(false);
    // 30 <= 40 -> accepted
    expect(validateCellPassage(campaign, civ0.id, s1.cell, true, 30).ok).toBe(true);
  });

  it('declaring war breaches active treaties, drops trust, and enables military passage', () => {
    const campaign = createTestCampaign();
    const civ0 = campaign.civs[0]!;
    const civ1 = campaign.civs[1]!;
    const s1 = campaign.settlements.find((s) => s.ownerId === civ1.id)!;

    // Set up an active treaty
    campaign.treaties.push({
      id: 1,
      proposerCivId: civ0.id,
      recipientCivId: civ1.id,
      clauses: [{ id: 'D-NONAGGRESSION', cells: [], terms: {} }],
      startTurn: 1,
      endTurn: null,
      terminationNoticeTurns: 1,
      status: 'ACTIVE',
      causeEventId: 0,
    });

    const warCmd: Command = {
      commandId: 'cmd-war-1',
      civId: civ0.id,
      actorId: civ0.id,
      issuedForTurn: 1,
      sequence: 1,
      target: null,
      consent: {},
      expectedStateVersion: 0,
      kind: 'DECLARE_WAR',
      options: {
        targetCivId: civ1.id,
      },
    };

    const res = resolveTurn(campaign, [warCmd]);
    expect(res.accepted).toContain('cmd-war-1');

    const rel = getDiplomaticRelation(res.state, civ0.id, civ1.id)!;
    expect(rel.atWar).toBe(true);
    expect(rel.trust).toBe(-800);

    const treaty = res.state.treaties[0]!;
    expect(treaty.status).toBe('BREACHED');

    // History event
    const warEvent = res.state.history.find((e) => e.type === 'WAR_STARTED');
    expect(warEvent).toBeDefined();

    // In war, military movement into enemy territory is allowed
    const passage = validateCellPassage(res.state, civ0.id, s1.cell, false);
    expect(passage.ok).toBe(true);

    // Make peace
    const peaceCmd: Command = {
      commandId: 'cmd-peace-1',
      civId: civ0.id,
      actorId: civ0.id,
      issuedForTurn: 2,
      sequence: 1,
      target: null,
      consent: {},
      expectedStateVersion: res.state.turn,
      kind: 'MAKE_PEACE',
      options: {
        targetCivId: civ1.id,
      },
    };

    const peaceRes = resolveTurn(res.state, [peaceCmd]);
    expect(peaceRes.accepted).toContain('cmd-peace-1');

    const relPost = getDiplomaticRelation(peaceRes.state, civ0.id, civ1.id)!;
    expect(relPost.atWar).toBe(false);
    expect(relPost.trust).toBe(-500); // -800 + 300

    const peaceEvent = peaceRes.state.history.find((e) => e.type === 'WAR_ENDED');
    expect(peaceEvent).toBeDefined();
  });

  it('cancelling an active treaty marks it terminated and reduces trust', () => {
    const campaign = createTestCampaign();
    const civ0 = campaign.civs[0]!;
    const civ1 = campaign.civs[1]!;

    campaign.treaties.push({
      id: 42,
      proposerCivId: civ0.id,
      recipientCivId: civ1.id,
      clauses: [{ id: 'D-BORDER', cells: [], terms: {} }],
      startTurn: 1,
      endTurn: null,
      terminationNoticeTurns: 1,
      status: 'ACTIVE',
      causeEventId: 0,
    });

    const cancelCmd: Command = {
      commandId: 'cmd-cancel-1',
      civId: civ0.id,
      actorId: civ0.id,
      issuedForTurn: 1,
      sequence: 1,
      target: null,
      consent: {},
      expectedStateVersion: 0,
      kind: 'CANCEL_TREATY',
      options: {
        treatyId: 42,
      },
    };

    const res = resolveTurn(campaign, [cancelCmd]);
    expect(res.accepted).toContain('cmd-cancel-1');

    const treaty = res.state.treaties.find((t) => t.id === 42)!;
    expect(treaty.status).toBe('TERMINATED');

    const rel = getDiplomaticRelation(res.state, civ0.id, civ1.id)!;
    expect(rel.trust).toBe(-150);

    const breachEvent = res.state.history.find((e) => e.type === 'TREATY_BREACHED');
    expect(breachEvent).toBeDefined();
  });
});
