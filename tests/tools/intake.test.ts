import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { approvedSourceProblems, type ProvenanceRecord } from '../../tools/assets/audit.ts';
import {
  ARENA_COMMIT,
  decideIntake,
  planIntake,
  pngFacts,
  referencedRulings,
  type ArenaLedger,
  type ArenaReceipt,
  type SpecRow,
} from '../../tools/assets/intake.ts';

const root = resolve(import.meta.dirname, '../..');
const provenance = JSON.parse(readFileSync(resolve(root, 'assets/provenance.json'), 'utf8')) as {
  humanRulings: { id: string }[];
  records: ProvenanceRecord[];
};
const rulings = new Set(provenance.humanRulings.map((ruling) => ruling.id));
const row = (path: string) => ({ assetClass: 'ARENA SOURCE ASSET', path });

// Minimal ledger fixture: one promotable ID.
const spec: SpecRow[] = [{ id: 'CG-S-X', class: 'ARENA SOURCE ASSET', profile: 'REF-GOD', path: 'assets/source/god/x.png', batch: 'B01' }];
const receipt = (over: Partial<ArenaReceipt> = {}): ArenaReceipt => ({
  canonical_path: 'assets/source/god/x.png',
  id_status: 'CANONICAL_SOURCE_PRESENT',
  candidates: [{ revision: 'r002', path: 'c/r002.png', sha256: 'cand', status: 'CANDIDATE_AWAITING_APPROVAL' }],
  approval: { approver: 'human (repository owner)' },
  promotion: {
    authority: 'owner ruling RULE_A',
    date: '2026-09-24',
    operation: 'LANCZOS_UP2X',
    source_candidate: 'c/r002.png',
    source_candidate_sha256: 'cand',
    canonical_dimensions: '2048x2048',
    canonical_sha256: 'canon',
  },
  ...over,
});
const ledger = (r: ArenaReceipt, authority = 'human (repository owner)'): ArenaLedger => ({
  specification_version: 'CG-V1.0.0',
  receipts: { 'CG-S-X': r },
  human_rulings: [{ id: 'RULE_A', ruling: { authority } }],
});

describe('Arena source intake (Sections 17.2, 18.2)', () => {
  it('reconciles the pinned Arena commit: canonical bytes, provenance and absent IDs', () => {
    const plan = planIntake(root);
    expect(plan.problems).toEqual([]);
    for (const { record, bytes } of plan.sources) {
      expect(readFileSync(resolve(root, record.path)).equals(bytes)).toBe(true);
      expect(record.candidate.commit).toBe(ARENA_COMMIT);
      expect(provenance.records.find((r) => r.id === record.id)).toEqual(JSON.parse(JSON.stringify(record)));
    }
    // Absent IDs come from the ledger, not from this test; none may occupy a canonical path.
    for (const absent of plan.absent) expect(['BLOCKED', 'REJECTED']).toContain(absent.status);
    expect(plan.sources.length + plan.absent.length).toBe(121);
  }, 60_000);

  it('every approved record verifies against its file', () => {
    for (const record of provenance.records.filter((r) => r.status === 'APPROVED_SOURCE')) {
      const bytes = readFileSync(resolve(root, record.path ?? ''));
      expect(approvedSourceProblems(record, row(record.path ?? ''), bytes, rulings)).toEqual([]);
    }
  });

  it('accepts a complete human-approved promotion chain', () => {
    const decision = decideIntake(ledger(receipt()), spec);
    expect(decision.problems).toEqual([]);
    expect(decision.accept.map((a) => a.id)).toEqual(['CG-S-X']);
  });

  it('never intakes a rejected, unpromoted, blocked or agent-approved source', () => {
    const rejected = receipt({ candidates: [{ revision: 'r002', path: 'c/r002.png', sha256: 'cand', status: 'REJECTED' }] });
    expect(decideIntake(ledger(rejected), spec).problems.join()).toMatch(/is REJECTED/);
    const unpromoted: ArenaReceipt = Object.fromEntries(Object.entries(receipt()).filter(([key]) => key !== 'promotion')) as unknown as ArenaReceipt;
    expect(decideIntake(ledger(unpromoted), spec).problems.join()).toMatch(/without a promotion/);
    expect(decideIntake(ledger(receipt(), 'agent'), spec).problems.join()).toMatch(/not a human decision/);
    expect(decideIntake(ledger(receipt({ approval: { approver: 'agent' } })), spec).problems.join()).toMatch(/receipt approval is not a human/);
    const blocked = decideIntake(ledger(receipt({ id_status: 'BLOCKED', blocked_reason: 'owner final' })), spec);
    expect(blocked.accept).toEqual([]);
    expect(blocked.absent[0]).toMatchObject({ id: 'CG-S-X', status: 'BLOCKED', reason: 'owner final' });
    expect(decideIntake(ledger(receipt({ canonical_path: 'elsewhere.png' })), spec).problems.join()).toMatch(/!= specified/);
  });

  it('resolves ruling references by ID and by 1-based ledger number', () => {
    const list = [{ id: 'A', ruling: {} }, { id: 'B', ruling: {} }];
    expect(referencedRulings('rulings #1 + #2', list)).toEqual(['A', 'B']);
    expect(referencedRulings('owner ruling B', list)).toEqual(['B']);
    expect(referencedRulings('nothing', list)).toEqual([]);
  });

  it('rejects hash drift, a missing file and non-human approval', () => {
    const record = provenance.records.find((r) => r.id === 'CG-S-GOD-FORM-Q') as ProvenanceRecord;
    const bytes = Buffer.from(readFileSync(resolve(root, record.path ?? '')));
    bytes[bytes.length - 20] = (bytes[bytes.length - 20] ?? 0) ^ 1;
    expect(approvedSourceProblems(record, row(record.path ?? ''), bytes, rulings).join()).toMatch(/sha256 mismatch/);
    expect(approvedSourceProblems(record, row(record.path ?? ''), null, rulings).join()).toMatch(/file absent/);
    expect(approvedSourceProblems({ ...record, approval: { approver: 'agent' } }, row(record.path ?? ''), readFileSync(resolve(root, record.path ?? '')), rulings).join()).toMatch(/not a human decision/);
  });

  it('rejects a non-profile source without a recorded human waiver', () => {
    const record = provenance.records.find((r) => r.id === 'CG-S-GOD-LIFE-Q') as ProvenanceRecord;
    const bytes = readFileSync(resolve(root, record.path ?? ''));
    expect(approvedSourceProblems(record, row(record.path ?? ''), bytes, rulings)).toEqual([]);
    expect(approvedSourceProblems({ ...record, dimensionWaiver: 'HR-UNKNOWN' }, row(record.path ?? ''), bytes, rulings).join()).toMatch(/no recorded human waiver/);
  });

  it('pngFacts rejects non-PNG bytes', () => {
    expect(() => pngFacts(Buffer.from('not a png at all, definitely'))).toThrow(/not a PNG/);
  });
});
