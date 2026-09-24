// Runtime binding for the first Q God (M03): LOD selection and the seven ordinary pose
// controllers from qPoses.json. Joint names are never assumed. `bindQRig` checks every joint a
// pose names against the skeleton that was actually loaded, and it refuses to bind otherwise
// (master Section 18.4).

import type { Bone} from 'three';
import { Quaternion, Vector3, type Mesh, type Object3D, type SkinnedMesh } from 'three';
import poseData from './qPoses.json';

export type QPoseName = keyof typeof poseData.poses;
export const LOD_NAMES = ['LOD0', 'LOD1', 'LOD2'] as const;
export type LodName = (typeof LOD_NAMES)[number];

export type AxisRotation = readonly [string, number];
interface PoseSpec {
  readonly rootOffsetU: readonly number[];
  readonly rotations: Readonly<Record<string, readonly AxisRotation[]>>;
}

export class QRigBindingError extends Error {
  override readonly name = 'QRigBindingError';
}

/** Validates the pose data file once at load; a malformed entry is an error, not a silent no-op. */
function parsePoses(raw: unknown): Record<string, PoseSpec> {
  const out: Record<string, PoseSpec> = {};
  for (const [name, value] of Object.entries(raw as Record<string, { rootOffsetU?: unknown; rotations?: unknown }>)) {
    const offset = value.rootOffsetU;
    if (!Array.isArray(offset) || offset.length !== 3 || !offset.every((n) => typeof n === 'number')) throw new QRigBindingError(`pose ${name}: bad rootOffsetU`);
    const rotations: Record<string, AxisRotation[]> = {};
    for (const [joint, list] of Object.entries((value.rotations ?? {}) as Record<string, unknown>)) {
      if (!Array.isArray(list)) throw new QRigBindingError(`pose ${name}/${joint}: rotations must be a list`);
      rotations[joint] = list.map((entry: unknown) => {
        if (!Array.isArray(entry) || entry.length !== 2 || !['x', 'y', 'z'].includes(entry[0] as string) || typeof entry[1] !== 'number') {
          throw new QRigBindingError(`pose ${name}/${joint}: each rotation is [axis, degrees]`);
        }
        return [entry[0] as string, entry[1]] as const;
      });
    }
    out[name] = { rootOffsetU: offset, rotations };
  }
  return out;
}

const POSES = parsePoses(poseData.poses);
export const Q_POSES = Object.keys(POSES) as QPoseName[];

export interface QRig {
  readonly root: Object3D;
  readonly bones: ReadonlyMap<string, Bone>;
  readonly lods: ReadonlyMap<LodName, SkinnedMesh | Mesh>;
  readonly jointNames: readonly string[];
  setLod(lod: LodName): void;
  /**
   * Applies a pose (weight 0..1 blends from the bind pose). `overlay` adds model-space joint
   * rotations after the pose (for example an injured limb's guarding posture).
   */
  setPose(pose: QPoseName | 'bind', weight?: number, overlay?: Readonly<Record<string, readonly AxisRotation[]>>): void;
  triangles(lod: LodName): number;
}

const AXES: Record<string, Vector3> = { x: new Vector3(1, 0, 0), y: new Vector3(0, 1, 0), z: new Vector3(0, 0, 1) };

function lodOf(name: string): LodName | null {
  for (const lod of LOD_NAMES) if (name === lod || name.endsWith(`_${lod}`)) return lod;
  return null;
}

/** Joints named by any pose that are absent from `jointNames` (empty means bindable). */
export function missingPoseJoints(jointNames: readonly string[]): string[] {
  const have = new Set(jointNames);
  const missing = new Set<string>();
  for (const pose of Object.values(POSES)) {
    for (const joint of Object.keys(pose.rotations)) if (!have.has(joint)) missing.add(joint);
  }
  return [...missing].sort();
}

export function bindQRig(root: Object3D, options: { readonly poses: boolean } = { poses: true }): QRig {
  const bones = new Map<string, Bone>();
  const lods = new Map<LodName, SkinnedMesh | Mesh>();
  root.traverse((node) => {
    if ((node as Bone).isBone) bones.set(node.name, node as Bone);
    const mesh = node as Mesh;
    if (mesh.isMesh) {
      const lod = lodOf(mesh.name) ?? lodOf(mesh.geometry.name) ?? lodOf(mesh.parent?.name ?? '');
      if (lod) lods.set(lod, mesh);
    }
  });
  for (const lod of LOD_NAMES) if (!lods.has(lod)) throw new QRigBindingError(`GLB has no ${lod} mesh`);
  const jointNames = [...bones.keys()].sort();
  const missing = options.poses ? missingPoseJoints(jointNames) : [];
  if (missing.length > 0) throw new QRigBindingError(`pose joints absent from the exported skeleton: ${missing.join(', ')}`);

  const rest = new Map<string, { q: Quaternion; p: Vector3 }>();
  for (const [name, bone] of bones) rest.set(name, { q: bone.quaternion.clone(), p: bone.position.clone() });
  // Bones in parent-first order so each pose rotation composes onto an already-posed parent.
  const ordered: Bone[] = [];
  const visit = (node: Object3D): void => {
    if ((node as Bone).isBone) ordered.push(node as Bone);
    node.children.forEach(visit);
  };
  visit(root);
  const rootBone = bones.get('root');

  const worldQ = new Quaternion();
  const parentQ = new Quaternion();
  const rootQ = new Quaternion();
  const delta = new Quaternion();
  const step = new Quaternion();

  const resetToBind = (): void => {
    for (const [name, bone] of bones) {
      const r = rest.get(name);
      if (r) { bone.quaternion.copy(r.q); bone.position.copy(r.p); }
    }
  };

  return {
    root,
    bones,
    lods,
    jointNames,
    setLod(lod) {
      for (const [name, mesh] of lods) mesh.visible = name === lod;
    },
    setPose(pose, weight = 1, overlay = {}) {
      resetToBind();
      if ((pose !== 'bind' || Object.keys(overlay).length > 0) && !options.poses) throw new QRigBindingError('this model has no pose controllers');
      for (const joint of Object.keys(overlay)) if (!bones.has(joint)) throw new QRigBindingError(`overlay joint ${joint} absent from the exported skeleton`);
      {
        const spec: PoseSpec | undefined = pose === 'bind' ? { rootOffsetU: [0, 0, 0], rotations: {} } : POSES[pose];
        if (!spec) throw new QRigBindingError(`unknown pose ${pose}`);
        const rotationsOf = (name: string): readonly AxisRotation[] => [
          ...(pose === 'bind' ? [] : (spec.rotations[name] ?? []).map(([a, d]) => [a, d * weight] as const)),
          ...(overlay[name] ?? []),
        ];
        root.updateMatrixWorld(true);
        root.getWorldQuaternion(rootQ);
        for (const bone of ordered) {
          const rotations = rotationsOf(bone.name);
          if (rotations.length === 0) continue;
          delta.identity();
          for (const [axis, degrees] of rotations) {
            const vector = AXES[axis];
            if (!vector) throw new QRigBindingError(`bad axis ${axis}`);
            delta.premultiply(step.setFromAxisAngle(vector, (degrees * Math.PI) / 180));
          }
          // Rotate about a model-space axis through the joint: world' = D * world, expressed in the
          // parent's (posed) frame.
          bone.parent?.updateMatrixWorld(true);
          bone.getWorldQuaternion(worldQ);
          const modelQ = rootQ.clone().invert().multiply(worldQ);
          const posedModelQ = delta.clone().multiply(modelQ);
          bone.parent?.getWorldQuaternion(parentQ);
          const parentModelQ = rootQ.clone().invert().multiply(parentQ);
          bone.quaternion.copy(parentModelQ.invert().multiply(posedModelQ));
          bone.updateMatrixWorld(true);
        }
        if (rootBone && pose !== 'bind' && spec.rootOffsetU.length === 3) {
          const offset = new Vector3(spec.rootOffsetU[0], spec.rootOffsetU[1], spec.rootOffsetU[2]).multiplyScalar(weight);
          // offset is model-space; convert into the root bone's parent frame
          rootBone.parent?.getWorldQuaternion(parentQ);
          offset.applyQuaternion(parentQ.clone().invert().multiply(rootQ));
          rootBone.position.add(offset);
        }
      }
      root.updateMatrixWorld(true);
    },
    triangles(lod) {
      const mesh = lods.get(lod);
      if (!mesh) return 0;
      const index = mesh.geometry.getIndex();
      return index ? index.count / 3 : mesh.geometry.getAttribute('position').count / 3;
    },
  };
}
