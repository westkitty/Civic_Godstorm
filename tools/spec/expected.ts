// Frozen expectations transcribed from CIVIC_GODSTORM_MASTER_PLAN.md (contract CG-V1.0.0).
// Each constant cites the clause it enforces. Changing one requires an approved plan amendment,
// never a convenience edit to make the compiler pass.

export const CONTRACT_VERSION = 'CG-V1.0.0';

/** Reconciliation signatures from the build prompt and the master's closing comment. */
export const SIGNATURES = {
  section17: '6b4bf9095a10b3c05c592d895afda0c8adefa9ec5e3a66312de078d351ef9c80',
  milestoneBlock: '3cabfe7088b537d17793fe64d618a0ec445c5c05f8237bfe9378835f722f8a01',
} as const;

export type AssetClass =
  | 'ARENA SOURCE ASSET'
  | 'DIRECT ARENA ASSET'
  | 'DERIVED ASSET'
  | 'PROCEDURAL RUNTIME ASSET';

/** Section 17.1: 121 authored (120 source + 1 direct), 112 derived, 40 + 12 recipes; 285 total. */
export const CLASS_COUNTS: Readonly<Record<AssetClass, number>> = {
  'ARENA SOURCE ASSET': 120,
  'DIRECT ARENA ASSET': 1,
  'DERIVED ASSET': 112,
  'PROCEDURAL RUNTIME ASSET': 52,
};

export const TOTAL_IDS = 285;

interface ProfileRule {
  readonly assetClass: AssetClass;
  readonly extension: '.png' | '.glb' | '.ts';
  readonly count: number;
}

/**
 * Section 17.1/17.3 profile breakdown. Source: 30 anatomy modules, 4 forms, 4 lifecycle sheets,
 * 33 props (14 buildings + 9 units + 10 environment), 6 infrastructure sheets, 4 motifs,
 * 38 glyph sources (6 emblems + 32 icons), 1 art-direction board, 1 title.
 * Derived: 69 module GLBs (30 God + 39 prop), 4 form fixtures, 38 glyphs, 1 atlas.
 */
export const PROFILE_RULES: Readonly<Record<string, ProfileRule>> = {
  'REF-GOD': { assetClass: 'ARENA SOURCE ASSET', extension: '.png', count: 30 },
  'REF-FORM': { assetClass: 'ARENA SOURCE ASSET', extension: '.png', count: 4 },
  'REF-LIFE': { assetClass: 'ARENA SOURCE ASSET', extension: '.png', count: 4 },
  'REF-PROP': { assetClass: 'ARENA SOURCE ASSET', extension: '.png', count: 33 },
  'REF-INF': { assetClass: 'ARENA SOURCE ASSET', extension: '.png', count: 6 },
  'REF-MOTIF': { assetClass: 'ARENA SOURCE ASSET', extension: '.png', count: 4 },
  'REF-GLYPH': { assetClass: 'ARENA SOURCE ASSET', extension: '.png', count: 38 },
  'REF-DIRECTION': { assetClass: 'ARENA SOURCE ASSET', extension: '.png', count: 1 },
  'DIRECT-TITLE': { assetClass: 'DIRECT ARENA ASSET', extension: '.png', count: 1 },
  'MODEL-GOD': { assetClass: 'DERIVED ASSET', extension: '.glb', count: 30 },
  'MODEL-PROP': { assetClass: 'DERIVED ASSET', extension: '.glb', count: 39 },
  'MODEL-FORM': { assetClass: 'DERIVED ASSET', extension: '.glb', count: 4 },
  GLYPH: { assetClass: 'DERIVED ASSET', extension: '.png', count: 38 },
  ATLAS: { assetClass: 'DERIVED ASSET', extension: '.png', count: 1 },
  RUNTIME: { assetClass: 'PROCEDURAL RUNTIME ASSET', extension: '.ts', count: 40 },
  AUDIO: { assetClass: 'PROCEDURAL RUNTIME ASSET', extension: '.ts', count: 12 },
};

/** Section 17.1 authored-source categories, checked by canonical source directory. */
export const SOURCE_DIRECTORY_COUNTS: Readonly<Record<string, number>> = {
  'assets/source/god/': 38,
  'assets/source/buildings/': 14,
  'assets/source/infrastructure/': 6,
  'assets/source/units/': 9,
  'assets/source/environment/': 10,
  'assets/source/emblems/': 6,
  'assets/source/motifs/': 4,
  'assets/source/icons/': 32,
  'assets/source/art/': 2,
};

/** Section 17.1: ID prefix per class. */
export const CLASS_PREFIX: Readonly<Record<AssetClass, string>> = {
  'ARENA SOURCE ASSET': 'CG-S-',
  'DIRECT ARENA ASSET': 'CG-A-',
  'DERIVED ASSET': 'CG-D-',
  'PROCEDURAL RUNTIME ASSET': 'CG-R-',
};

/** Section 17.3 atlas profile: 8x8 cells of which 38 hold glyphs. */
export const ATLAS_CELLS = 64;

/** Section 16.6: the 24 SYS-* matrix rows plus four named presentation consumers. */
export const EXTRA_CONSUMERS = ['SYS-GOD', 'SYS-UI', 'SYS-RENDER', 'SYS-AUDIO'] as const;
export const CONSUMER_REGISTER_SIZE = 28;
export const SYSTEM_MATRIX_ROWS = 24;

/** Section 18.6: thirteen batches B00-B12 totalling 121 authored outputs. */
export const BATCH_COUNT = 13;
export const AUTHORED_TOTAL = 121;

/** Section 5: sixteen Godform recipes. */
export const GODFORM_RECIPES = 16;
