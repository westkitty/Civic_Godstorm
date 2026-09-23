import { describe, expect, it } from 'vitest';
import manifest from '../../assets/manifest.json';
import { assetRegistry, createAssetRegistry, UnknownAssetIdError } from '../../src/assets/registry.ts';

describe('asset registry', () => {
  it('knows all 285 specified IDs and resolves exactly the verified manifest entries', () => {
    expect(assetRegistry.totalSpecified).toBe(285);
    const resolved = manifest.verifiedFiles.length + manifest.registeredRecipes.length;
    expect(assetRegistry.unresolvedIds()).toHaveLength(285 - resolved);
    for (const file of manifest.verifiedFiles) {
      expect(assetRegistry.resolve(file.id)).toEqual({ id: file.id, status: 'VERIFIED', path: file.path });
    }
    // An ID without verified evidence (B03, not produced) stays an explicit MISSING reference.
    expect(assetRegistry.resolve('CG-S-GOD-TORSO-H')).toEqual({ id: 'CG-S-GOD-TORSO-H', status: 'MISSING' });
  });

  it('rejects guessed IDs instead of inventing a path', () => {
    expect(() => assetRegistry.resolve('CG-S-GOD-DRAGON')).toThrow(UnknownAssetIdError);
  });

  it('resolves only IDs present in the verified manifest', () => {
    const registry = createAssetRegistry(
      [{ id: 'CG-D-ICO-FOOD' }, { id: 'CG-D-ICO-WOOD' }, { id: 'CG-R-DEBUG' }],
      { verifiedFiles: [{ id: 'CG-D-ICO-FOOD', path: 'assets/runtime/ui/cg_d_ico_food.png' }], registeredRecipes: ['CG-R-DEBUG'] },
      { contract: 'CG-V1.0.0', section17Sha256: 'x' },
    );
    expect(registry.resolve('CG-D-ICO-FOOD')).toEqual({
      id: 'CG-D-ICO-FOOD', status: 'VERIFIED', path: 'assets/runtime/ui/cg_d_ico_food.png',
    });
    expect(registry.resolve('CG-D-ICO-WOOD').status).toBe('MISSING');
    expect(registry.unresolvedIds()).toEqual(['CG-D-ICO-WOOD']);
  });
});
