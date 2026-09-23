// Sole owner of the WebGLRenderer, scene, camera, map presentation and frame scheduling (master
// Section 14.4). Renders on demand. Pointer gestures are normalised here into camera motion or a
// picked cell; the UI decides what a cell activation means. Presentation never feeds game state.

import { AmbientLight, Color, OrthographicCamera, Scene, Vector2, Vector3, WebGLRenderer } from 'three';
import { MapPresenter } from './MapPresenter.ts';
import { cellCenter, type WorldSnapshot } from './worldSnapshot.ts';

export type RendererStatus =
  | { readonly kind: 'running'; readonly drawCalls: number; readonly triangles: number }
  | { readonly kind: 'context-lost' };

export interface CellActivation {
  readonly cell: number;
  readonly button: number;
  readonly shiftKey: boolean;
  readonly pointerType: string;
}

export interface RendererHostOptions {
  readonly canvas: HTMLCanvasElement;
  readonly onStatus: (status: RendererStatus) => void;
  readonly onCellActivate?: (activation: CellActivation) => void;
  /** Section 15 DPR cap for the medium tier. */
  readonly maxPixelRatio?: number;
}

/** Section 12.1: 45 degree default azimuth in 60 degree steps, 55 degree elevation. */
const CAMERA_ELEVATION = (55 * Math.PI) / 180;
const CAMERA_DISTANCE = 2000;
const DRAG_THRESHOLD_PX = 6;
const HEX_WIDTH_U = 32;
const MIN_VISIBLE_HEXES = 4;
const MAX_VISIBLE_HEXES = 40;
const UI_BACKGROUND = '#14191f';

export class RendererHost {
  private readonly canvas: HTMLCanvasElement;
  private readonly onStatus: (status: RendererStatus) => void;
  private readonly onCellActivate: ((activation: CellActivation) => void) | undefined;
  private readonly maxPixelRatio: number;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 1, CAMERA_DISTANCE * 3);
  private readonly presenter = new MapPresenter();
  private readonly resizeObserver: ResizeObserver;
  private readonly target = new Vector3(0, 0, 0);
  private azimuthStep = 0;
  private visibleHexes = 16;
  private snapshot: WorldSnapshot | null = null;
  private readonly pointers = new Map<number, { x: number; y: number; startX: number; startY: number }>();
  private dragged = false;
  private pinchDistance = 0;
  private frameRequest: number | null = null;
  private contextLost = false;
  private disposed = false;

  constructor(options: RendererHostOptions) {
    this.canvas = options.canvas;
    this.onStatus = options.onStatus;
    this.onCellActivate = options.onCellActivate;
    this.maxPixelRatio = options.maxPixelRatio ?? 1.5;
    // Throws when a context cannot be created; the caller shows the renderer error path.
    this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(new Color(UI_BACKGROUND));
    this.scene.add(new AmbientLight(0xffffff, 1), this.presenter.root);

    this.canvas.addEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerup', this.handlePointerUp);
    this.canvas.addEventListener('pointercancel', this.handlePointerCancel);
    this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', this.preventDefault);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);
    this.resize();
  }

  setSnapshot(snapshot: WorldSnapshot): void {
    this.snapshot = snapshot;
    this.presenter.setSnapshot(snapshot);
    this.requestRender();
  }

  /** Centres the camera on the average of the given cells without changing zoom through the body. */
  focusCells(cells: readonly number[]): void {
    const snapshot = this.snapshot;
    if (!snapshot || cells.length === 0) return;
    const first = cellCenter(snapshot.width, cells[0] as number);
    const span = snapshot.width * HEX_WIDTH_U;
    let x = 0;
    let z = 0;
    for (const cell of cells) {
      const center = cellCenter(snapshot.width, cell);
      const dx = center.x - first.x;
      x += dx > span / 2 ? center.x - span : dx < -span / 2 ? center.x + span : center.x;
      z += center.z;
    }
    this.target.set(x / cells.length, 0, z / cells.length);
    this.wrapTarget();
    this.updateCamera();
  }

  /** Pans by screen-relative steps (keyboard): +x right, +y down, in visible-hex units. */
  panBy(right: number, down: number): void {
    const unitsPerStep = HEX_WIDTH_U * Math.max(1, this.visibleHexes / 8);
    this.panWorld(right * unitsPerStep, down * unitsPerStep);
  }

  rotate(direction: 1 | -1): void {
    this.azimuthStep = (this.azimuthStep + direction + 6) % 6;
    this.updateCamera();
  }

  zoomBy(factor: number): void {
    this.visibleHexes = Math.min(MAX_VISIBLE_HEXES, Math.max(MIN_VISIBLE_HEXES, this.visibleHexes * factor));
    this.updateCamera();
  }

  /** Debug/test aid: CSS-pixel client coordinates of a cell's nearest wrap copy, or null. */
  clientPointOfCell(cell: number): { x: number; y: number } | null {
    const snapshot = this.snapshot;
    if (!snapshot) return null;
    const center = cellCenter(snapshot.width, cell);
    const span = snapshot.width * HEX_WIDTH_U;
    const copies = [center.x - span, center.x, center.x + span];
    const x = copies.reduce((best, value) => (Math.abs(value - this.target.x) < Math.abs(best - this.target.x) ? value : best));
    const point = new Vector3(x, 2, center.z).project(this.camera);
    if (point.x < -1 || point.x > 1 || point.y < -1 || point.y > 1) return null;
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + ((point.x + 1) / 2) * rect.width, y: rect.top + ((1 - point.y) / 2) * rect.height };
  }

  requestRender(): void {
    if (this.disposed || this.contextLost || this.frameRequest !== null) return;
    this.frameRequest = requestAnimationFrame(() => {
      this.frameRequest = null;
      this.renderFrame();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.frameRequest !== null) cancelAnimationFrame(this.frameRequest);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.canvas.removeEventListener('pointercancel', this.handlePointerCancel);
    this.canvas.removeEventListener('wheel', this.handleWheel);
    this.canvas.removeEventListener('contextmenu', this.preventDefault);
    this.presenter.dispose();
    this.renderer.dispose();
  }

  private wrapTarget(): void {
    const span = this.presenter.mapWidthU;
    if (span > 0) this.target.x = ((this.target.x % span) + span) % span;
  }

  private viewHeight(): number {
    const aspect = Math.max(0.1, this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight));
    return (this.visibleHexes * HEX_WIDTH_U) / aspect;
  }

  private updateCamera(): void {
    const azimuth = ((45 + 60 * this.azimuthStep) * Math.PI) / 180;
    const offset = new Vector3(
      Math.cos(CAMERA_ELEVATION) * Math.sin(azimuth),
      Math.sin(CAMERA_ELEVATION),
      Math.cos(CAMERA_ELEVATION) * Math.cos(azimuth),
    ).multiplyScalar(CAMERA_DISTANCE);
    this.camera.position.copy(this.target).add(offset);
    this.camera.lookAt(this.target);
    const height = this.viewHeight();
    const aspect = Math.max(0.1, this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight));
    this.camera.top = height / 2;
    this.camera.bottom = -height / 2;
    this.camera.left = (-height * aspect) / 2;
    this.camera.right = (height * aspect) / 2;
    this.camera.near = CAMERA_DISTANCE - 1500;
    this.camera.far = CAMERA_DISTANCE + 1500;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.requestRender();
  }

  /** Moves the target by screen-aligned world units on the ground plane. */
  private panWorld(right: number, down: number): void {
    const azimuth = ((45 + 60 * this.azimuthStep) * Math.PI) / 180;
    const rightVector = new Vector3(Math.cos(azimuth), 0, -Math.sin(azimuth));
    const downVector = new Vector3(Math.sin(azimuth), 0, Math.cos(azimuth));
    this.target.addScaledVector(rightVector, right).addScaledVector(downVector, down / Math.sin(CAMERA_ELEVATION));
    this.wrapTarget();
    this.updateCamera();
  }

  private resize(): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.maxPixelRatio));
    this.renderer.setSize(width, height, false);
    this.updateCamera();
  }

  private renderFrame(): void {
    if (this.disposed || this.contextLost) return;
    this.renderer.render(this.scene, this.camera);
    const { calls, triangles } = this.renderer.info.render;
    this.onStatus({ kind: 'running', drawCalls: calls, triangles });
  }

  private ndcOf(event: PointerEvent): Vector2 {
    const rect = this.canvas.getBoundingClientRect();
    return new Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.canvas.setPointerCapture?.(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY });
    if (this.pointers.size === 1) this.dragged = false;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchDistance = a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
      this.dragged = true;
    }
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const distanceNow = a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
      if (this.pinchDistance > 0 && distanceNow > 0) this.zoomBy(this.pinchDistance / distanceNow);
      this.pinchDistance = distanceNow;
      return;
    }
    if (!this.dragged && Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) < DRAG_THRESHOLD_PX) return;
    this.dragged = true;
    const unitsPerPx = this.viewHeight() / Math.max(1, this.canvas.clientHeight);
    this.panWorld(-dx * unitsPerPx, -dy * unitsPerPx);
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    const wasOnly = this.pointers.size === 1;
    this.pointers.delete(event.pointerId);
    if (!wasOnly || this.dragged) return;
    const cell = this.presenter.pick(this.ndcOf(event), this.camera);
    if (cell === null) return;
    this.onCellActivate?.({ cell, button: event.button, shiftKey: event.shiftKey, pointerType: event.pointerType });
  };

  private readonly handlePointerCancel = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId);
  };

  private readonly handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.zoomBy(event.deltaY > 0 ? 1.15 : 1 / 1.15);
  };

  private readonly preventDefault = (event: Event): void => {
    event.preventDefault();
  };

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    if (this.frameRequest !== null) cancelAnimationFrame(this.frameRequest);
    this.frameRequest = null;
    this.onStatus({ kind: 'context-lost' });
  };

  private readonly handleContextRestored = (): void => {
    this.contextLost = false;
    // Presentation is rebuilt from the last snapshot; no game state lives here.
    if (this.snapshot) this.presenter.setSnapshot(this.snapshot);
    this.resize();
  };
}
