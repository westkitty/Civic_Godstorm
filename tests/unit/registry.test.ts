import { describe, expect, it } from 'vitest';
import { assetRegistry, createAssetRegistry, UnknownAssetIdError } from '../../src/assets/registry.ts';

describe('asset registry', () => {
  it('knows all 285 specified IDs and resolves none of them at M00', () => {
    expect(assetRegistry.totalSpecified).toBe(285);
    expect(assetRegistry.unresolvedIds()).toHaveLength(285);
    expect(assetRegistry.resolve('CG-S-GOD-TORSO-Q')).toEqual({ id: 'CG-S-GOD-TORSO-Q', status: 'MISSING' });
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
