import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { approvedSourceProblems, type ProvenanceRecord } from '../../tools/assets/audit.ts';
import { ARENA_COMMIT, buildRecord, INTAKE, pngFacts, RULINGS } from '../../tools/assets/intake.ts';

const root = resolve(import.meta.dirname, '../..');
const provenance = JSON.parse(readFileSync(resolve(root, 'assets/provenance.json'), 'utf8')) as { records: ProvenanceRecord[] };
const rulings = new Set(RULINGS.map((ruling) => ruling.id));
const row = (path: string) => ({ assetClass: 'ARENA SOURCE ASSET', path });

describe('source intake (Sections 17.2, 18.2)', () => {
  it('canonical files are byte-identical to the pinned Arena candidates', () => {
    for (const item of INTAKE) {
      const candidate = execFileSync('git', ['show', `${ARENA_COMMIT}:${item.candidatePath}`], { cwd: root, maxBuffer: 1 << 26 });
      expect(readFileSync(resolve(root, item.canonicalPath)).equals(candidate)).toBe(true);
      const record = provenance.records.find((r) => r.id === item.id);
      expect(record).toEqual(JSON.parse(JSON.stringify(buildRecord(item, candidate))));
    }
  });

  it('every approved record verifies against its file', () => {
    for (const record of provenance.records.filter((r) => r.status === 'APPROVED_SOURCE')) {
      const bytes = readFileSync(resolve(root, record.path ?? ''));
      expect(approvedSourceProblems(record, row(record.path ?? ''), bytes, rulings)).toEqual([]);
    }
  });

  it('rejects a native-dimension source without a recorded human waiver', () => {
    const record = provenance.records.find((r) => r.id === 'CG-S-GOD-TORSO-Q') as ProvenanceRecord;
    const bytes = readFileSync(resolve(root, record.path ?? ''));
    expect(approvedSourceProblems({ ...record, dimensionWaiver: 'HR-UNKNOWN' }, row(record.path ?? ''), bytes, rulings).join()).toMatch(/no recorded human waiver/);
  });

  it('rejects hash drift, a missing file and non-human approval', () => {
    const record = provenance.records.find((r) => r.id === 'CG-S-GOD-FORM-Q') as ProvenanceRecord;
    const bytes = Buffer.from(readFileSync(resolve(root, record.path ?? '')));
    bytes[bytes.length - 20] = (bytes[bytes.length - 20] ?? 0) ^ 1;
    expect(approvedSourceProblems(record, row(record.path ?? ''), bytes, rulings).join()).toMatch(/sha256 mismatch/);
    expect(approvedSourceProblems(record, row(record.path ?? ''), null, rulings).join()).toMatch(/file absent/);
    expect(approvedSourceProblems({ ...record, approval: { approver: 'agent' } }, row(record.path ?? ''), readFileSync(resolve(root, record.path ?? '')), rulings).join()).toMatch(/not a human decision/);
  });

  it('pngFacts rejects non-PNG bytes', () => {
    expect(() => pngFacts(Buffer.from('not a png at all, definitely'))).toThrow(/not a PNG/);
  });
});
