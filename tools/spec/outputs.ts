// Builds the deterministic machine registries described in master Section 18.2.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  checkContract,
  extractMilestoneBlock,
  extractSection17,
  parseContract,
  type AssetRow,
  type CheckResult,
  type ParsedContract,
} from './contract.ts';
import { CONTRACT_VERSION, type AssetClass } from './expected.ts';

export const MASTER_FILE = 'CIVIC_GODSTORM_MASTER_PLAN.md';
export const ARENA_FILE = 'LM_ARENA_ASSET_PRODUCTION_PROMPT.md';
export const BUILD_PROMPT_FILE = 'OPUS_5_5_MASTER_BUILD_PROMPT.md';

export const SPECIFICATION_PATH = 'assets/specification.json';
export const MISSING_PATH = 'assets/missing.json';
export const PROVENANCE_PATH = 'assets/provenance.json';
export const MANIFEST_PATH = 'assets/manifest.json';
export const RUNTIME_INDEX_PATH = 'src/assets/generated/specIndex.json';

export interface GeneratedFile {
  readonly path: string;
  readonly content: string;
}

export function loadContract(root: string): { contract: ParsedContract; results: CheckResult[] } {
  const read = (file: string): string => readFileSync(resolve(root, file), 'utf8');
  const contract = parseContract(read(MASTER_FILE));
  const results = checkContract(contract, {
    arenaSection17: extractSection17(read(ARENA_FILE)),
    buildPromptMilestones: extractMilestoneBlock(read(BUILD_PROMPT_FILE)),
  });
  return { contract, results };
}

/** Which kind of evidence can move an ID out of SPECIFIED (master Section 18.2). */
function resolutionPath(assetClass: AssetClass): string {
  switch (assetClass) {
    case 'ARENA SOURCE ASSET':
    case 'DIRECT ARENA ASSET':
      return 'ARENA_CANDIDATE_THEN_HUMAN_APPROVAL';
    case 'DERIVED ASSET':
      return 'APPROVED_SOURCES_THEN_VERIFIED_DERIVATION';
    case 'PROCEDURAL RUNTIME ASSET':
      return 'CODE_TESTS_AND_BROWSER_EVIDENCE';
  }
}

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

export function buildOutputs(contract: ParsedContract): { generated: GeneratedFile[]; seeds: GeneratedFile[] } {
  const batchOf = new Map<string, string>();
  for (const batch of contract.batches) for (const id of batch.assetIds) batchOf.set(id, batch.id);
  // Section 17.10: traceability rows name recipes whose dependencies recursively name sources.
  const dependenciesOf = new Map(contract.assets.map((row) => [row.id, row.dependencies]));
  const reachedBy = new Map<string, Set<string>>();
  for (const [system, roots] of contract.traceability) {
    const pending = [...roots];
    const seen = new Set<string>();
    while (pending.length > 0) {
      const id = pending.pop() as string;
      if (seen.has(id)) continue;
      seen.add(id);
      pending.push(...(dependenciesOf.get(id) ?? []));
    }
    for (const id of seen) {
      if (!reachedBy.has(id)) reachedBy.set(id, new Set());
      reachedBy.get(id)?.add(system);
    }
  }
  const consumersBy = (row: AssetRow): string[] =>
    contract.consumerRegister.filter((system) => reachedBy.get(row.id)?.has(system) ?? false);

  const counts: Record<string, number> = {};
  const profileCounts: Record<string, number> = {};
  for (const row of contract.assets) {
    counts[row.assetClass] = (counts[row.assetClass] ?? 0) + 1;
    profileCounts[row.profile] = (profileCounts[row.profile] ?? 0) + 1;
  }

  const provenanceHeader = {
    contract: CONTRACT_VERSION,
    source: MASTER_FILE,
    section17Sha256: contract.section17Sha256,
    milestoneBlockSha256: contract.milestoneBlockSha256,
  };

  const specification = {
    schemaVersion: 1,
    note: 'Requirements compiled from master Section 17. Not evidence that any asset exists, is approved or works.',
    ...provenanceHeader,
    counts: { total: contract.assets.length, byClass: counts, byProfile: profileCounts },
    profiles: contract.profiles,
    consumerRegister: contract.consumerRegister,
    traceability: Object.fromEntries(contract.traceability),
    batches: contract.batches,
    // Informational: rows whose own consumer column is their only link, because no Section 17.10
    // traceability row (recursively) names them. Not a contract violation; recorded for review.
    outsideTraceabilityClosure: contract.assets.filter((row) => consumersBy(row).length === 0).map((row) => row.id),
    godform: Object.fromEntries(contract.godformRecipes.map((recipe) => [recipe, contract.godformModuleMap.get(recipe) ?? []])),
    assets: contract.assets.map((row) => ({
      id: row.id,
      class: row.assetClass,
      profile: row.profile,
      path: row.path,
      purpose: row.purpose,
      plannedDimensions: row.dimensions,
      variants: row.variants,
      consumers: row.consumers,
      tracedBy: consumersBy(row),
      dependencies: row.dependencies,
      batch: batchOf.get(row.id) ?? null,
      declaredIn: row.declaredIn,
      resolutionPath: resolutionPath(row.assetClass),
    })),
  };

  // At M00 nothing has been produced, approved, derived or verified: every ID is unresolved.
  // Later milestones regenerate this from provenance/manifest evidence, never by hand.
  const missing = {
    schemaVersion: 1,
    ...provenanceHeader,
    unresolvedCount: contract.assets.length,
    unresolved: contract.assets.map((row) => ({
      id: row.id,
      class: row.assetClass,
      status: 'SPECIFIED',
      batch: batchOf.get(row.id) ?? null,
      needs: resolutionPath(row.assetClass),
    })),
  };

  const runtimeIndex = {
    contract: CONTRACT_VERSION,
    section17Sha256: contract.section17Sha256,
    counts: { total: contract.assets.length, byClass: counts },
    assets: contract.assets.map((row) => ({ id: row.id, class: row.assetClass, profile: row.profile, path: row.path })),
  };

  return {
    generated: [
      { path: SPECIFICATION_PATH, content: json(specification) },
      { path: MISSING_PATH, content: json(missing) },
      { path: RUNTIME_INDEX_PATH, content: json(runtimeIndex) },
    ],
    seeds: [
      {
        path: PROVENANCE_PATH,
        content: json({
          schemaVersion: 1,
          contract: CONTRACT_VERSION,
          note: 'Actual candidate, approval, native-dimension and rights records only. Empty means none exist.',
          records: [],
        }),
      },
      {
        path: MANIFEST_PATH,
        content: json({
          schemaVersion: 1,
          contract: CONTRACT_VERSION,
          note: 'Only verified shipping file facts and registered recipe IDs. Empty means nothing is verified.',
          verifiedFiles: [],
          registeredRecipes: [],
        }),
      },
    ],
  };
}
