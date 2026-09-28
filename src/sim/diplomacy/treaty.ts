// Diplomacy, treaties, territorial rights and access corridors (master Section 9.1, 9.2).
// All simulation data uses bounded integers; presentation and 3D scenes never live here.

import type { CampaignState } from '../core/state.ts';

export const CLAUSE_IDS = [
  'D-BORDER',
  'D-TRADE',
  'D-ALLIANCE',
  'D-PASSAGE',
  'D-GOD-CORRIDOR',
  'D-FEEDING',
  'D-SANCTUARY',
  'D-SACRED-SITE',
  'D-RESTITUTION',
  'D-DETERRENCE',
  'D-REMAINS',
  'D-RESEARCH',
  'D-ASYLUM',
  'D-NONAGGRESSION',
  'D-ENCOUNTER-AVOIDANCE',
  'D-COMPACT',
] as const;
export type ClauseId = (typeof CLAUSE_IDS)[number];

export interface TreatyClause {
  readonly id: ClauseId;
  /** Cells where this clause applies (e.g. corridor or sanctuary cells). Empty if globally between parties. */
  readonly cells: number[];
  /** Specific terms / integers (e.g. max mass for corridor, coin compensation). */
  readonly terms: Record<string, number>;
}

export const TREATY_STATUSES = ['PROPOSED', 'ACTIVE', 'BREACHED', 'TERMINATED'] as const;
export type TreatyStatus = (typeof TREATY_STATUSES)[number];

export interface Treaty {
  readonly id: number;
  readonly proposerCivId: number;
  readonly recipientCivId: number;
  readonly clauses: TreatyClause[];
  readonly startTurn: number;
  endTurn: number | null;
  readonly terminationNoticeTurns: number;
  status: TreatyStatus;
  readonly causeEventId: number;
}

export interface DiplomaticRelation {
  readonly civA: number;
  readonly civB: number;
  trust: number; // -1000..1000
  atWar: boolean;
  contact: boolean;
}

/** Returns the canonical relation key for two civilization IDs. */
export function relationKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/** Finds or initializes the diplomatic relation between two civilizations. */
export function getDiplomaticRelation(
  state: CampaignState,
  civA: number,
  civB: number,
): DiplomaticRelation | null {
  if (civA === civB) return null;
  const rel = state.diplomacy.find(
    (r) => (r.civA === civA && r.civB === civB) || (r.civA === civB && r.civB === civA),
  );
  return rel ?? null;
}

/** Modifies trust between two civilizations, clamped to [-1000, 1000]. */
export function adjustTrust(
  state: CampaignState,
  civA: number,
  civB: number,
  delta: number,
): void {
  const rel = getDiplomaticRelation(state, civA, civB);
  if (rel) {
    rel.trust = Math.max(-1000, Math.min(1000, rel.trust + delta));
  }
}

/** Checks whether a cell is part of another civilization's core territory (within 2 steps of a settlement). */
export function getCellOwner(state: CampaignState, cell: number): number | null {
  // Direct settlement core
  const settlement = state.settlements.find((s) => s.cell === cell);
  if (settlement) return settlement.ownerId;

  // Farm parcel
  const farmSettlement = state.settlements.find((s) => s.farmSites.some((f) => f.cell === cell));
  if (farmSettlement) return farmSettlement.ownerId;

  return null;
}

/** Checks if two civilizations have an active treaty containing a specific clause. */
export function hasActiveClause(
  state: CampaignState,
  civA: number,
  civB: number,
  clauseId: ClauseId,
  cell?: number,
): boolean {
  return state.treaties.some((t) => {
    if (t.status !== 'ACTIVE') return false;
    const isParty =
      (t.proposerCivId === civA && t.recipientCivId === civB) ||
      (t.proposerCivId === civB && t.recipientCivId === civA);
    if (!isParty) return false;

    return t.clauses.some((c) => {
      if (c.id !== clauseId) return false;
      if (cell !== undefined && c.cells.length > 0) {
        return c.cells.includes(cell);
      }
      return true;
    });
  });
}

/** Validates whether movement into a cell is permitted by diplomacy and treaties. */
export function validateCellPassage(
  state: CampaignState,
  travelerCivId: number,
  cell: number,
  isGod: boolean,
  godMass = 10,
): { readonly ok: boolean; readonly reason?: string } {
  const cellOwner = getCellOwner(state, cell);
  if (cellOwner === null || cellOwner === travelerCivId) {
    return { ok: true };
  }

  const rel = getDiplomaticRelation(state, travelerCivId, cellOwner);
  if (rel?.atWar) {
    // Movement into enemy territory is allowed during war
    return { ok: true };
  }

  if (isGod) {
    // God passage requires D-GOD-CORRIDOR covering the cell
    const hasCorridor = state.treaties.some((t) => {
      if (t.status !== 'ACTIVE') return false;
      const isParty =
        (t.proposerCivId === travelerCivId && t.recipientCivId === cellOwner) ||
        (t.proposerCivId === cellOwner && t.recipientCivId === travelerCivId);
      if (!isParty) return false;

      return t.clauses.some((c) => {
        if (c.id !== 'D-GOD-CORRIDOR') return false;
        if (c.cells.length > 0 && !c.cells.includes(cell)) return false;
        const maxMass = c.terms.maxMass ?? 100;
        return godMass <= maxMass;
      });
    });

    if (hasCorridor) return { ok: true };
    return { ok: false, reason: 'Requires D-GOD-CORRIDOR treaty clause for God transit through foreign territory' };
  } else {
    // Army/Civilian passage requires D-PASSAGE or D-BORDER recognition
    const hasPassage =
      hasActiveClause(state, travelerCivId, cellOwner, 'D-PASSAGE', cell) ||
      hasActiveClause(state, travelerCivId, cellOwner, 'D-BORDER', cell);

    if (hasPassage) return { ok: true };
    return { ok: false, reason: 'Requires D-PASSAGE or D-BORDER treaty clause for transit through foreign territory' };
  }
}

/** Resolves per-turn diplomatic effects (research sharing, treaty expirations). */
export function resolveDiplomacyTurn(state: CampaignState): void {
  for (const treaty of state.treaties) {
    if (treaty.status !== 'ACTIVE') continue;

    // Check expiration
    if (treaty.endTurn !== null && state.turn >= treaty.endTurn) {
      treaty.status = 'TERMINATED';
      continue;
    }

    // Apply active clause per-turn benefits
    for (const clause of treaty.clauses) {
      if (clause.id === 'D-RESEARCH') {
        // Research sharing grants +1 KNOWLEDGE per turn to both parties
        const civA = state.civs.find((c) => c.id === treaty.proposerCivId);
        const civB = state.civs.find((c) => c.id === treaty.recipientCivId);
        if (civA) civA.knowledge += 1;
        if (civB) civB.knowledge += 1;
      }
    }
  }
}
