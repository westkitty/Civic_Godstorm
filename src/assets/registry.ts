// Runtime asset lookup (master Section 18.2). Only IDs from the compiled specification exist;
// only files recorded in the verified manifest resolve to a URL. Everything else is an explicit
// MISSING reference, never a guessed path.

import manifestJson from '../../assets/manifest.json';
import specIndex from './generated/specIndex.json';

export type AssetId = string;

export type AssetRef =
  | { readonly id: AssetId; readonly status: 'MISSING' }
  | { readonly id: AssetId; readonly status: 'VERIFIED'; readonly path: string };

interface VerifiedFile {
  readonly id: string;
  readonly path: string;
}

interface Manifest {
  readonly verifiedFiles: readonly VerifiedFile[];
  readonly registeredRecipes: readonly string[];
}

export class UnknownAssetIdError extends Error {
  override readonly name = 'UnknownAssetIdError';
}

export interface AssetRegistry {
  readonly totalSpecified: number;
  readonly contract: string;
  readonly section17Sha256: string;
  resolve(id: AssetId): AssetRef;
  unresolvedIds(): AssetId[];
}

export function createAssetRegistry(
  specified: readonly { readonly id: string }[],
  manifest: Manifest,
  meta: { readonly contract: string; readonly section17Sha256: string },
): AssetRegistry {
  const known = new Set(specified.map((row) => row.id));
  const verified = new Map(manifest.verifiedFiles.map((file) => [file.id, file.path]));
  const recipes = new Set(manifest.registeredRecipes);
  const resolve = (id: AssetId): AssetRef => {
    if (!known.has(id)) throw new UnknownAssetIdError(`"${id}" is not a specified asset ID`);
    const path = verified.get(id);
    if (path !== undefined) return { id, status: 'VERIFIED', path };
    return { id, status: 'MISSING' };
  };
  return {
    totalSpecified: known.size,
    contract: meta.contract,
    section17Sha256: meta.section17Sha256,
    resolve,
    unresolvedIds: () => [...known].filter((id) => !verified.has(id) && !recipes.has(id)),
  };
}

export const assetRegistry: AssetRegistry = createAssetRegistry(
  specIndex.assets,
  manifestJson,
  { contract: specIndex.contract, section17Sha256: specIndex.section17Sha256 },
);
