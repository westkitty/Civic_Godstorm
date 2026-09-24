// Schematic development map presentation (CG-R-DEBUG family). The production terrain recipe
// CG-R-TERRAIN is later milestone work (its CG-S-ART-DIRECTION source is now approved), so this draws flat, clearly
// schematic hex prisms from observed knowledge plus the code-defined CG-R-FOG and CG-R-FOOTPRINTS
// overlays. Three horizontal copies present the east-west wrap; state is never duplicated.

import {
  Box3,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  MeshBasicMaterial,
  Raycaster,
  Vector3,
  type Camera,
  type Mesh,
  type Object3D,
  type SkinnedMesh,
  type Vector2,
} from 'three';
import type { LoadedGodModel } from './god/godAsset.ts';
import { applyLifePresentation } from './god/qLife.ts';
import { bindQRig } from './god/qRig.ts';
import { createMissingPlaceholder, type MissingPlaceholder } from './recipes/cg_r_debug.ts';
import { cellCenter, HEX_RADIUS, type WorldSnapshot } from './worldSnapshot.ts';

/** Schematic biome colours derived from the Section 17.2 palette tokens. */
const BIOME_COLORS = ['#244a61', '#3f7390', '#7f9a6a', '#55745c', '#3f5a4a', '#5e7f7c', '#b98549', '#c9c3b3', '#6b5a55'];
const UNKNOWN = new Color('#0b0f14');
const FARM = new Color('#d8b25a');
const COLORS = {
  selected: '#7ffff0',
  route: '#e4c86e',
  swept: '#f4ecde',
  warning: '#e7675d',
  waypoint: '#ffffff',
  cursor: '#6fb7ff',
  foreignGod: '#c85b50',
};

const COPIES = [-1, 0, 1];

/** Section 3.1: primary-mass height per size; the FORM-Q fixture is size II (22 U). */
const SIZE_HEIGHT_U: Record<1 | 2 | 3, number> = { 1: 12, 2: 22, 3: 36 };
const FIXTURE_HEIGHT_U = 22;

/** Measured on the rendered instance (not the simulation): scale, contact and footprint fit. */
export interface GodRenderFact {
  readonly godId: number;
  readonly modelStatus: 'VERIFIED' | 'CANDIDATE';
  readonly modelId: string;
  readonly heightU: number;
  readonly lowestPointU: number;
  readonly terrainTopU: number;
  readonly verticesSampled: number;
  readonly outsideFootprintFraction: number;
}

function insideHex(dx: number, dz: number): boolean {
  // pointy-top hex of circumradius HEX_RADIUS centred at the origin
  const ax = Math.abs(dx);
  const az = Math.abs(dz);
  const inradius = (HEX_RADIUS * Math.sqrt(3)) / 2;
  return ax <= inradius && az <= HEX_RADIUS - ax / Math.sqrt(3) + 1e-6;
}

function prismHeight(biome: number, elevation: number): number {
  if (biome <= 1) return 0.6;
  return 2 + Math.max(0, Math.floor((elevation - 90) / 25)) * 1.5;
}

export class MapPresenter {
  readonly root = new Group();
  private terrain: InstancedMesh | null = null;
  private readonly terrainGeometry = new CylinderGeometry(HEX_RADIUS * 0.97, HEX_RADIUS * 0.97, 1, 6);
  private readonly terrainMaterial = new MeshBasicMaterial({ color: 0xffffff });
  private readonly overlayGroup = new Group();
  private readonly placeholderGroup = new Group();
  private placeholders: MissingPlaceholder[] = [];
  private overlayResources: { geometry: BufferGeometry; material: LineBasicMaterial }[] = [];
  private snapshot: WorldSnapshot | null = null;
  private readonly raycaster = new Raycaster();
  private godModel: LoadedGodModel | null = null;
  private godRenderFacts: GodRenderFact[] = [];

  constructor() {
    this.terrainGeometry.translate(0, 0.5, 0);
    this.root.add(this.overlayGroup, this.placeholderGroup);
  }

  get mapWidthU(): number {
    return (this.snapshot?.width ?? 0) * 32;
  }

  setSnapshot(snapshot: WorldSnapshot): void {
    const previous = this.snapshot;
    this.snapshot = snapshot;
    if (!this.terrain || previous?.width !== snapshot.width || previous.height !== snapshot.height) this.buildTerrain(snapshot);
    this.paintTerrain(snapshot);
    this.buildPlaceholders(snapshot);
    this.buildOverlays(snapshot);
  }

  /** Supplies the loaded God model; own Gods are then drawn with it instead of the placeholder. */
  setGodModel(model: LoadedGodModel | null): void {
    this.godModel = model;
    if (this.snapshot) this.buildPlaceholders(this.snapshot);
  }

  get renderedGods(): readonly GodRenderFact[] {
    return this.godRenderFacts;
  }

  /** Cell under a normalised device coordinate, or null. */
  pick(ndc: Vector2, camera: Camera): number | null {
    if (!this.terrain || !this.snapshot) return null;
    this.raycaster.setFromCamera(ndc, camera);
    const hit = this.raycaster.intersectObject(this.terrain, false)[0];
    if (hit?.instanceId === undefined) return null;
    return hit.instanceId % (this.snapshot.width * this.snapshot.height);
  }

  dispose(): void {
    this.clearPlaceholders();
    this.clearOverlays();
    this.terrain?.dispose();
    this.terrainGeometry.dispose();
    this.terrainMaterial.dispose();
    this.root.removeFromParent();
  }

  private buildTerrain(snapshot: WorldSnapshot): void {
    this.terrain?.removeFromParent();
    this.terrain?.dispose();
    const cells = snapshot.width * snapshot.height;
    this.terrain = new InstancedMesh(this.terrainGeometry, this.terrainMaterial, cells * COPIES.length);
    this.terrain.name = 'schematic-terrain';
    this.root.add(this.terrain);
  }

  private paintTerrain(snapshot: WorldSnapshot): void {
    const terrain = this.terrain;
    if (!terrain) return;
    const cells = snapshot.width * snapshot.height;
    const matrix = new Matrix4();
    const color = new Color();
    const farmCells = new Set<number>();
    snapshot.farmOwner.forEach((owner, cell) => {
      if (owner >= 0) farmCells.add(cell);
    });
    for (let cell = 0; cell < cells; cell += 1) {
      const visibility = snapshot.visibility[cell] ?? 0;
      const biome = snapshot.biome[cell] ?? -1;
      const known = visibility > 0 && biome >= 0;
      const height = known ? prismHeight(biome, snapshot.elevation[cell] ?? 0) : 0.4;
      if (!known) color.copy(UNKNOWN);
      else {
        color.set(farmCells.has(cell) ? FARM : (BIOME_COLORS[biome] ?? '#ff00ff'));
        if (visibility === 1) color.lerp(UNKNOWN, 0.55);
      }
      const { x, z } = cellCenter(snapshot.width, cell);
      COPIES.forEach((copy, copyIndex) => {
        matrix.makeScale(1, height, 1).setPosition(x + copy * snapshot.width * 32, 0, z);
        terrain.setMatrixAt(copyIndex * cells + cell, matrix);
        terrain.setColorAt(copyIndex * cells + cell, color);
      });
    }
    terrain.instanceMatrix.needsUpdate = true;
    if (terrain.instanceColor) terrain.instanceColor.needsUpdate = true;
    terrain.computeBoundingSphere();
  }

  private topOf(cell: number): number {
    const snapshot = this.snapshot;
    if (!snapshot) return 0;
    const biome = snapshot.biome[cell] ?? -1;
    return snapshot.visibility[cell] && biome >= 0 ? prismHeight(biome, snapshot.elevation[cell] ?? 0) : 0.4;
  }

  private clearPlaceholders(): void {
    // Wrap-copy clones share the original's geometry/materials, which each placeholder disposes once.
    // God instances own cloned materials/colour geometry (qLife) that are released here.
    for (const child of [...this.placeholderGroup.children]) {
      if (child.name.startsWith('god-')) {
        child.traverse((node) => {
          const mesh = node as Mesh;
          if (!mesh.isMesh) return;
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const material of materials) material.dispose();
        });
      }
      child.removeFromParent();
    }
    for (const placeholder of this.placeholders) placeholder.dispose();
    this.placeholders = [];
  }

  private buildPlaceholders(snapshot: WorldSnapshot): void {
    this.clearPlaceholders();
    for (const settlement of snapshot.settlements) {
      const placeholder = createMissingPlaceholder('CG-D-BLD-HALL', { width: 10, height: 7, depth: 10 });
      const { x, z } = cellCenter(snapshot.width, settlement.cell);
      this.placeCopies(placeholder, x, this.topOf(settlement.cell), z, 0);
    }
    this.godRenderFacts = [];
    for (const god of snapshot.gods) {
      const centers = god.cells.map((cell) => cellCenter(snapshot.width, cell));
      const first = centers[0];
      const last = centers[centers.length - 1];
      if (!first || !last) continue;
      // Unwrap every cell toward the first so a body straddling the seam stays contiguous.
      const span = snapshot.width * 32;
      const unwrap = (x: number): number => (x - first.x > span / 2 ? x - span : first.x - x > span / 2 ? x + span : x);
      const top = Math.max(...god.cells.map((cell) => this.topOf(cell)));
      if (god.body && god.body.family === 'Q' && this.godModel) {
        const cx = centers.reduce((sum, c) => sum + unwrap(c.x), 0) / centers.length;
        const cz = centers.reduce((sum, c) => sum + c.z, 0) / centers.length;
        this.placeGod(god, god.body, cx, cz, top, centers.map((c) => ({ x: unwrap(c.x), z: c.z })));
        continue;
      }
      const lastX = unwrap(last.x);
      const length = Math.hypot(lastX - first.x, last.z - first.z) + 24;
      const placeholder = createMissingPlaceholder('CG-R-GOD-ASSEMBLY', { width: 18, height: 12, depth: length });
      const angle = Math.atan2(lastX - first.x, last.z - first.z);
      this.placeCopies(placeholder, (first.x + lastX) / 2, top, (first.z + last.z) / 2, angle);
    }
  }

  /**
   * One skinned instance per wrap copy. The body centre sits on the footprint centroid; model +Z
   * maps to heading 0 by a +90 degree Y rotation (Section 16.2), and each heading step turns 60 degrees.
   */
  private placeGod(
    god: WorldSnapshot['gods'][number],
    body: NonNullable<WorldSnapshot['gods'][number]['body']>,
    cx: number,
    cz: number,
    top: number,
    cells: readonly { x: number; z: number }[],
  ): void {
    const model = this.godModel;
    if (!model) return;
    const width = (this.snapshot?.width ?? 0) * 32;
    const sizeScale = SIZE_HEIGHT_U[body.size] / FIXTURE_HEIGHT_U;
    let measured: Object3D | null = null;
    for (const copy of COPIES) {
      const outer = new Group();
      outer.name = `god-${god.id}${copy === 0 ? '' : `-wrap${copy}`}`;
      const life = new Group();
      const instance = model.instantiate();
      life.add(instance);
      outer.add(life);
      const rig = bindQRig(instance);
      rig.setLod('LOD0');
      const overlay = applyLifePresentation(life, rig, { stage: body.stage, injured: body.injured });
      rig.setPose(body.pose, 1, overlay);
      outer.scale.setScalar(sizeScale);
      outer.rotation.y = Math.PI / 2 - (god.heading * Math.PI) / 3;
      outer.position.set(cx + copy * width, top, cz);
      this.placeholderGroup.add(outer);
      if (copy === 0) measured = outer;
    }
    if (!measured) return;
    measured.updateMatrixWorld(true);
    const box = new Box3().setFromObject(measured, true);
    // Plan-view fit: sample skinned LOD2 vertices and test them against the footprint hexes.
    let outside = 0;
    let sampled = 0;
    const v = new Vector3();
    measured.traverse((node) => {
      const mesh = node as SkinnedMesh;
      if (!mesh.isSkinnedMesh || !mesh.name.endsWith('LOD2')) return;
      const position = mesh.geometry.getAttribute('position');
      for (let i = 0; i < position.count; i += 1) {
        mesh.getVertexPosition(i, v);
        v.applyMatrix4(mesh.matrixWorld);
        sampled += 1;
        if (!cells.some((c) => insideHex(v.x - c.x, v.z - c.z))) outside += 1;
      }
    });
    this.godRenderFacts.push({
      godId: god.id,
      modelStatus: model.resolution.status === 'VERIFIED' ? 'VERIFIED' : 'CANDIDATE',
      modelId: model.resolution.id,
      heightU: box.max.y - box.min.y,
      lowestPointU: box.min.y,
      terrainTopU: top,
      verticesSampled: sampled,
      outsideFootprintFraction: sampled ? outside / sampled : 1,
    });
  }

  private placeCopies(placeholder: MissingPlaceholder, x: number, y: number, z: number, angle: number): void {
    const width = (this.snapshot?.width ?? 0) * 32;
    placeholder.object.position.set(x, y, z);
    placeholder.object.rotation.y = angle;
    this.placeholderGroup.add(placeholder.object);
    this.placeholders.push(placeholder);
    for (const copy of [-1, 1]) {
      const clone = placeholder.object.clone(true);
      clone.position.x += copy * width;
      this.placeholderGroup.add(clone);
    }
  }

  private clearOverlays(): void {
    for (const child of [...this.overlayGroup.children]) child.removeFromParent();
    for (const resource of this.overlayResources) {
      resource.geometry.dispose();
      resource.material.dispose();
    }
    this.overlayResources = [];
  }

  /** Hex outlines for a set of cells, raised slightly above the terrain. */
  private outline(cells: readonly number[], colorHex: string, lift: number, inset: number): void {
    const snapshot = this.snapshot;
    if (!snapshot || cells.length === 0) return;
    const positions: number[] = [];
    const radius = HEX_RADIUS * inset;
    for (const cell of cells) {
      const { x, z } = cellCenter(snapshot.width, cell);
      const y = this.topOf(cell) + lift;
      for (let k = 0; k < 6; k += 1) {
        const a0 = (Math.PI / 3) * k;
        const a1 = (Math.PI / 3) * (k + 1);
        positions.push(x + radius * Math.sin(a0), y, z + radius * Math.cos(a0), x + radius * Math.sin(a1), y, z + radius * Math.cos(a1));
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    const material = new LineBasicMaterial({ color: colorHex, depthTest: false });
    this.overlayResources.push({ geometry, material });
    for (const copy of COPIES) {
      const lines = new LineSegments(geometry, material);
      lines.position.x = copy * snapshot.width * 32;
      lines.renderOrder = 2;
      this.overlayGroup.add(lines);
    }
  }

  private buildOverlays(snapshot: WorldSnapshot): void {
    this.clearOverlays();
    const { overlay } = snapshot;
    this.outline(overlay.routeSwept, COLORS.swept, 0.3, 0.8);
    this.outline(overlay.routeAnchors, COLORS.route, 0.5, 0.55);
    this.outline(overlay.warningCells, COLORS.warning, 0.7, 0.9);
    this.outline(overlay.selectedGodCells, COLORS.selected, 0.9, 0.95);
    this.outline(overlay.waypoints, COLORS.waypoint, 1.1, 0.35);
    this.outline(snapshot.gods.filter((g) => !g.own).flatMap((g) => g.cells), COLORS.foreignGod, 0.9, 0.95);
    if (overlay.cursor !== null) this.outline([overlay.cursor], COLORS.cursor, 1.3, 1);
  }
}
