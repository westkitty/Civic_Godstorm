import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkContract,
  ContractParseError,
  extractMilestoneBlock,
  extractSection17,
  parseContract,
  sha256,
  type CheckResult,
} from '../../tools/spec/contract.ts';
import { SIGNATURES } from '../../tools/spec/expected.ts';
import { buildOutputs } from '../../tools/spec/outputs.ts';

const root = resolve(import.meta.dirname, '../..');
const master = readFileSync(resolve(root, 'CIVIC_GODSTORM_MASTER_PLAN.md'), 'utf8');

const failures = (results: readonly CheckResult[]): string[] => results.filter((r) => !r.ok).map((r) => r.name);
const checkMutated = (text: string): string[] => failures(checkContract(parseContract(text)));

describe('canonical master contract', () => {
  const contract = parseContract(master);

  it('reproduces both reconciliation signatures', () => {
    expect(contract.section17Sha256).toBe(SIGNATURES.section17);
    expect(contract.milestoneBlockSha256).toBe(SIGNATURES.milestoneBlock);
  });

  it('passes every M00 check and yields exactly 285 IDs', () => {
    expect(failures(checkContract(contract))).toEqual([]);
    expect(contract.assets).toHaveLength(285);
  });

  it('matches the companion copies byte-for-byte', () => {
    const arena = readFileSync(resolve(root, 'LM_ARENA_ASSET_PRODUCTION_PROMPT.md'), 'utf8');
    const prompt = readFileSync(resolve(root, 'OPUS_5_5_MASTER_BUILD_PROMPT.md'), 'utf8');
    expect(sha256(extractSection17(arena))).toBe(SIGNATURES.section17);
    expect(sha256(extractMilestoneBlock(prompt))).toBe(SIGNATURES.milestoneBlock);
  });

  it('builds deterministic registries that claim nothing exists', () => {
    const first = buildOutputs(contract);
    const second = buildOutputs(parseContract(master));
    expect(first).toEqual(second);
    const missing = JSON.parse(first.generated.find((f) => f.path === 'assets/missing.json')?.content ?? '{}') as {
      unresolvedCount: number;
      unresolved: { status: string }[];
    };
    expect(missing.unresolvedCount).toBe(285);
    expect(missing.unresolved.every((entry) => entry.status === 'SPECIFIED')).toBe(true);
  });
});

describe('contract checks reject corrupted catalogs', () => {
  it('detects any edit to Section 17 through its signature', () => {
    const edited = master.replace('Low clustered house, broad eaves', 'Low clustered house, wide eaves');
    expect(checkMutated(edited)).toContain('signature.section17');
  });

  it('detects a deleted asset row via counts', () => {
    const edited = master.replace(/^\| `CG-S-ENV-KELP`.*\n/m, '');
    const failed = checkMutated(edited);
    expect(failed).toEqual(expect.arrayContaining(['ids.total', 'count.class.ARENA SOURCE ASSET', 'rows.wellFormed']));
  });

  it('detects a duplicated ID', () => {
    const row = /^\| `CG-S-ENV-ROCK`.*\n/m.exec(master)?.[0] ?? '';
    const failed = checkMutated(master.replace(row, row + row));
    expect(failed).toEqual(expect.arrayContaining(['ids.unique', 'paths.unique']));
  });

  it('detects a filename that breaks the lowercase-underscore rule', () => {
    const edited = master.replace('assets/source/units/cg_s_unt_bow.png', 'assets/source/units/cg-s-unt-bow.png');
    expect(checkMutated(edited)).toContain('rows.wellFormed');
  });

  it('detects an unknown dependency and a dependency cycle', () => {
    const unknown = master.replace('| CG-S-GOD-FORM-Q |\n', '| CG-S-GOD-FORM-Z |\n');
    expect(checkMutated(unknown)).toContain('rows.wellFormed');
    const cyclic = master.replace(
      /(\| `CG-S-GOD-FORM-Q` .*?\| )CG-S-GOD-TORSO-Q, /,
      '$1CG-S-GOD-LIFE-Q, CG-S-GOD-TORSO-Q, ',
    );
    expect(checkMutated(cyclic)).toContain('dependencies.acyclic');
  });

  it('detects an unregistered consumer system', () => {
    const edited = master.replace('| 0.50 U tall | SYS-MILITARY |', '| 0.50 U tall | SYS-HEROES |');
    expect(checkMutated(edited)).toContain('consumers.known');
  });

  it('detects a source ID assigned to two batches', () => {
    const edited = master.replace('| B12 | Title painting | 1 | `CG-A-ART-TITLE`', '| B12 | Title painting | 1 | `CG-S-ICO-FOOD`');
    expect(checkMutated(edited)).toContain('batches.allocation');
  });

  it('detects a Godform recipe mapped to no visible module', () => {
    const edited = master.replace('GF-CROWN -> SENSE-ANTENNA-CROWN; ', 'GF-CROWN -> nothing; ');
    expect(checkMutated(edited)).toContain('godform.mapping');
  });

  it('fails loudly when the contract markers are missing', () => {
    expect(() => parseContract(master.replace('<!-- CG_ASSET_CONTRACT_END -->', ''))).toThrow(ContractParseError);
  });
});
