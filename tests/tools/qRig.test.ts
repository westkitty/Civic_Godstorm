import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Group, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { applyLifePresentation, STAGE_SCALE } from '../../src/render/god/qLife.ts';
import { bindQRig, Q_POSES, QRigBindingError } from '../../src/render/god/qRig.ts';

const glbPath = resolve(import.meta.dirname, '../../assets/runtime/models/cg_d_god_form_q.glb');

async function loadForm(): Promise<Object3D> {
  const bytes = readFileSync(glbPath);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await new GLTFLoader().parseAsync(buffer, '');
  return gltf.scene;
}

function worldOf(root: Object3D, joint: string): Vector3 {
  const bone = root.getObjectByName(joint);
  if (!bone) throw new Error(`no ${joint}`);
  root.updateMatrixWorld(true);
  return bone.getWorldPosition(new Vector3());
}

describe('Q rig binding and pose controllers (M03)', () => {
  it('binds the delivered FORM-Q skeleton and its three LODs', async () => {
    const rig = bindQRig(await loadForm());
    expect(rig.jointNames).toContain('root');
    expect([...rig.lods.keys()].sort()).toEqual(['LOD0', 'LOD1', 'LOD2']);
    expect(rig.triangles('LOD0')).toBeGreaterThan(rig.triangles('LOD1'));
    expect(rig.triangles('LOD1')).toBeGreaterThan(rig.triangles('LOD2'));
    rig.setLod('LOD2');
    expect(rig.lods.get('LOD2')?.visible).toBe(true);
    expect(rig.lods.get('LOD0')?.visible).toBe(false);
  });

  it('feed lowers the head, walk swings the legs apart, and bind restores the rest pose exactly', async () => {
    const root = await loadForm();
    const rig = bindQRig(root);
    const restJaw = worldOf(root, 'jaw');
    const restFl = worldOf(root, 'leg_fl_toe');
    const restFr = worldOf(root, 'leg_fr_toe');
    rig.setPose('feed');
    expect(worldOf(root, 'jaw').y).toBeLessThan(restJaw.y - 1);
    rig.setPose('walk');
    const fl = worldOf(root, 'leg_fl_toe');
    const fr = worldOf(root, 'leg_fr_toe');
    expect(fl.z - restFl.z).toBeGreaterThan(0.5); // forward swing
    expect(fr.z - restFr.z).toBeLessThan(-0.5); // backward swing
    rig.setPose('bind');
    expect(worldOf(root, 'jaw').distanceTo(restJaw)).toBeLessThan(1e-6);
    for (const pose of Q_POSES) expect(() => rig.setPose(pose)).not.toThrow();
  });

  it('refuses overlay joints that the export does not contain', async () => {
    const rig = bindQRig(await loadForm());
    expect(() => rig.setPose('idle', 1, { leg_fl_claw: [['x', 5]] })).toThrow(QRigBindingError);
  });

  it('age and injury: stage scale is applied and the injured posture lifts the left foreleg', async () => {
    const root = await loadForm();
    const holder = new Group();
    holder.add(root);
    const rig = bindQRig(root);
    rig.setPose('idle');
    const sound = worldOf(root, 'leg_fl_toe');
    const overlay = applyLifePresentation(holder, rig, { stage: 'juvenile', injured: true });
    expect(holder.scale.toArray()).toEqual([...STAGE_SCALE.juvenile]);
    rig.setPose('idle', 1, overlay);
    holder.scale.set(1, 1, 1);
    expect(worldOf(root, 'leg_fl_toe').y).toBeGreaterThan(sound.y + 0.2);
  });
});
