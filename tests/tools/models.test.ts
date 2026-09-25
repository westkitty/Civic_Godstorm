import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import poses from '../../src/render/god/qPoses.json';
import { missingPoseJoints, Q_POSES } from '../../src/render/god/qRig.ts';

const root = resolve(import.meta.dirname, '../..');
const recipe = JSON.parse(readFileSync(resolve(root, 'tools/models/q_recipe.json'), 'utf8')) as {
  modules: Record<string, { slug: string; triangleBudget: number[] }>;
  form: { id: string; slug: string; triangleBudget: number[]; jointLimit: number };
};
const models = [
  ...Object.entries(recipe.modules).map(([id, m]) => ({ id, slug: m.slug, budget: m.triangleBudget })),
  { id: recipe.form.id, slug: recipe.form.slug, budget: recipe.form.triangleBudget },
];

function glbJson(path: string): { nodes: { name?: string }[]; skins?: { joints: number[] }[]; meshes: { name: string; primitives: { indices: number }[] }[]; accessors: { count: number }[] } {
  const data = readFileSync(path);
  expect(data.readUInt32LE(0)).toBe(0x46546c67);
  const length = data.readUInt32LE(12);
  return JSON.parse(data.subarray(20, 20 + length).toString('utf8')) as ReturnType<typeof glbJson>;
}

describe('Q derived models (Sections 17.3, 18.4)', () => {
  it('each export meta records the delivered file hash and LOD budgets hold', () => {
    for (const model of models) {
      const glbPath = resolve(root, 'assets/runtime/models', `${model.slug}.glb`);
      const meta = JSON.parse(readFileSync(resolve(root, 'assets/runtime/models', `${model.slug}.meta.json`), 'utf8')) as { sha256: string; id: string };
      expect(meta.id).toBe(model.id);
      expect(createHash('sha256').update(readFileSync(glbPath)).digest('hex')).toBe(meta.sha256);
      const doc = glbJson(glbPath);
      for (let level = 0; level < 3; level += 1) {
        const mesh = doc.meshes.find((m) => m.name.endsWith(`LOD${level}`));
        expect(mesh, `${model.id} LOD${level}`).toBeDefined();
        const tris = (mesh?.primitives ?? []).reduce((sum, p) => sum + (doc.accessors[p.indices]?.count ?? 0) / 3, 0);
        expect(tris).toBeLessThanOrEqual(model.budget[level] ?? 0);
        expect(tris).toBeGreaterThan(0);
      }
    }
  });

  it('every pose joint exists in the exported FORM-Q skeleton (names bound only after export)', () => {
    const doc = glbJson(resolve(root, 'assets/runtime/models', `${recipe.form.slug}.glb`));
    const joints = (doc.skins?.[0]?.joints ?? []).map((j) => doc.nodes[j]?.name ?? '');
    expect(joints.length).toBeGreaterThan(0);
    expect(joints.length).toBeLessThanOrEqual(recipe.form.jointLimit);
    expect(missingPoseJoints(joints)).toEqual([]);
    expect(missingPoseJoints(joints.filter((j) => j !== 'jaw'))).toEqual(['jaw']);
  });

  it('declares exactly the seven ordinary poses', () => {
    expect(Q_POSES).toEqual(['idle', 'walk', 'turn', 'feed', 'brace', 'rest', 'sleep']);
    expect(Object.keys(poses.poses)).toHaveLength(7);
  });
});
