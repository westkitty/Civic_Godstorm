// Age and injury sample for the first Q God (M03). This is the approved-source subset of
// CG-R-GOD-AGE and CG-R-GOD-DAMAGE (master Section 17.8): proportion-safe stage scaling, wear
// colour, one locomotor injury posture and one visible flank scar. No new anatomy is added.
// Stage proportions are measured from the canonical CG-S-GOD-LIFE-Q r005 sheet (Arena 15c6f1b, 3x2
// panels, silhouette bounding boxes: juvenile 193x154 px, prime 371x256 px, ancient 372x270 px,
// width x height). The injured-prime panel shows a wounded near foreleg and one scar. r005 draws
// the body with a domed carapace that FORM-Q r004 does not have. Owner ruling OR-2026-09-25-02 calls
// r005 continuity drift to be replaced, so these proportions are provisional until a corrected
// LIFE-Q exists (see docs/evidence/M03.md).
import { BufferAttribute, Color, Vector3, type Mesh, type MeshStandardMaterial, type Object3D } from 'three';
import type { AxisRotation, QRig } from './qRig.ts';

export type LifeStage = 'juvenile' | 'prime' | 'ancient';
export const LIFE_STAGES: readonly LifeStage[] = ['juvenile', 'prime', 'ancient'];

/** Whole-body scale per stage: x (width) uses the geometric mean of the measured length and height ratios. */
export const STAGE_SCALE: Record<LifeStage, readonly [number, number, number]> = {
  juvenile: [0.559, 0.602, 0.52],
  prime: [1, 1, 1],
  ancient: [1.029, 1.055, 1.003],
};
/** Relative head scale: the r005 juvenile panel shows no enlarged head, so no stage changes it. */
const STAGE_HEAD_SCALE: Record<LifeStage, number> = { juvenile: 1, prime: 1, ancient: 1 };
/** Multiplier on the vertex colour: ancient wear darkens and desaturates slightly. */
const STAGE_TINT: Record<LifeStage, string> = { juvenile: '#f2fbf8', prime: '#ffffff', ancient: '#e6e1d4' };

/** Guarding posture of the injured left foreleg (model-space degrees, applied after the pose). */
export const INJURED_FORELEG_OVERLAY: Readonly<Record<string, readonly AxisRotation[]>> = {
  leg_fl_upper: [['x', -8]],
  leg_fl_lower: [['x', 20]],
  leg_fl_foot: [['x', -14]],
};

/**
 * Flank scar: a short diagonal streak on the left flank. It is defined in the side (y, z) plane and
 * applied to outward-facing left-side vertices (x below `minX`), so it lands on the actual flank
 * surface whatever the fitted body width is (bind-pose model space, U).
 */
const SCAR = { from: new Vector3(0, 15.8, 3.4), to: new Vector3(0, 11.8, -0.8), radius: 0.6, minX: -3 };
const SCAR_COLOR = new Color('#e1ceac').convertSRGBToLinear();

export interface LifePresentation {
  readonly stage: LifeStage;
  readonly injured: boolean;
}

function segmentDistance(p: Vector3, a: Vector3, b: Vector3): number {
  const ab = b.clone().sub(a);
  const t = Math.min(1, Math.max(0, p.clone().sub(a).dot(ab) / ab.lengthSq()));
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

/**
 * Applies stage scale, head proportion, wear tint and (when injured) the scar to one God instance.
 * Geometry and materials are cloned first so that no other instance sharing the loaded GLB is
 * changed. Returns the pose overlay to pass to `rig.setPose`.
 */
export function applyLifePresentation(
  instanceRoot: Object3D,
  rig: QRig,
  life: LifePresentation,
): Readonly<Record<string, readonly AxisRotation[]>> {
  const [sx, sy, sz] = STAGE_SCALE[life.stage];
  instanceRoot.scale.set(sx, sy, sz);
  rig.bones.get('head')?.scale.setScalar(STAGE_HEAD_SCALE[life.stage]);
  const tint = new Color(STAGE_TINT[life.stage]).convertSRGBToLinear();
  for (const mesh of rig.lods.values()) {
    const material = (mesh as Mesh).material;
    const cloned = Array.isArray(material) ? material.map((m) => m.clone()) : material.clone();
    for (const m of Array.isArray(cloned) ? cloned : [cloned]) (m as MeshStandardMaterial).color?.copy(tint);
    (mesh as Mesh).material = cloned;
    if (life.injured) {
      const geometry = mesh.geometry.clone();
      const position = geometry.getAttribute('position');
      const color = geometry.getAttribute('color');
      if (color) {
        const colors = new BufferAttribute(new Float32Array(color.array.length), color.itemSize, color.normalized);
        const p = new Vector3();
        const c = new Color();
        for (let i = 0; i < position.count; i += 1) {
          p.fromBufferAttribute(position, i);
          c.setRGB(color.getX(i), color.getY(i), color.getZ(i));
          if (p.x < SCAR.minX) {
            const d = segmentDistance(p.setX(0), SCAR.from, SCAR.to);
            if (d < SCAR.radius) c.lerp(SCAR_COLOR, 0.75 * (1 - d / SCAR.radius));
          }
          colors.setXYZ(i, c.r, c.g, c.b);
          if (color.itemSize === 4) colors.setW(i, color.getW(i));
        }
        geometry.setAttribute('color', colors);
      }
      mesh.geometry = geometry;
    }
  }
  return life.injured ? INJURED_FORELEG_OVERLAY : {};
}
