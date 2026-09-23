// Sole owner of the WebGLRenderer, scene, camera and frame scheduling (master Section 14.4).
// The M00 shell renders on demand only; there is no continuous loop and no simulation here.
// Presentation state never feeds back into game state.

import {
  AmbientLight,
  Color,
  OrthographicCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { createMissingPlaceholder, type MissingPlaceholder } from './recipes/cg_r_debug.ts';

export type RendererStatus =
  | { readonly kind: 'running'; readonly drawCalls: number; readonly triangles: number }
  | { readonly kind: 'context-lost' };

export interface RendererHostOptions {
  readonly canvas: HTMLCanvasElement;
  readonly onStatus: (status: RendererStatus) => void;
  /** Section 15 DPR cap for the medium tier. */
  readonly maxPixelRatio?: number;
}

/** Strategic camera defaults from master Section 12.1: azimuth 45 degrees, elevation 55 degrees. */
const CAMERA_AZIMUTH = (45 * Math.PI) / 180;
const CAMERA_ELEVATION = (55 * Math.PI) / 180;
const VIEW_HEIGHT_U = 96;
const UI_BACKGROUND = '#14191f';

/** The terrain recipe is unimplemented at M00, so the world view shows its explicit placeholder. */
const PLACEHOLDER_ASSET_ID = 'CG-R-TERRAIN';

export class RendererHost {
  private readonly canvas: HTMLCanvasElement;
  private readonly onStatus: (status: RendererStatus) => void;
  private readonly maxPixelRatio: number;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 1, 1000);
  private readonly resizeObserver: ResizeObserver;
  private placeholder: MissingPlaceholder | null = null;
  private frameRequest: number | null = null;
  private contextLost = false;
  private disposed = false;

  constructor(options: RendererHostOptions) {
    this.canvas = options.canvas;
    this.onStatus = options.onStatus;
    this.maxPixelRatio = options.maxPixelRatio ?? 1.5;
    // Throws when a context cannot be created; the caller shows the renderer error path.
    this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(new Color(UI_BACKGROUND));
    this.scene.add(new AmbientLight(0xffffff, 1));
    this.positionCamera();
    this.buildScene();

    this.canvas.addEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);
    this.resize();
  }

  /** Coalesces render requests into at most one frame. */
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
    this.placeholder?.dispose();
    this.placeholder = null;
    this.renderer.dispose();
  }

  private buildScene(): void {
    this.placeholder?.dispose();
    this.placeholder = createMissingPlaceholder(PLACEHOLDER_ASSET_ID, { width: 32, height: 6, depth: 32 });
    this.scene.add(this.placeholder.object);
  }

  private positionCamera(): void {
    const distance = 200;
    const offset = new Vector3(
      Math.cos(CAMERA_ELEVATION) * Math.sin(CAMERA_AZIMUTH),
      Math.sin(CAMERA_ELEVATION),
      Math.cos(CAMERA_ELEVATION) * Math.cos(CAMERA_AZIMUTH),
    ).multiplyScalar(distance);
    this.camera.position.copy(offset);
    this.camera.lookAt(0, 6, 0);
    this.camera.near = 1;
    this.camera.far = distance * 2;
  }

  private resize(): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.maxPixelRatio));
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    this.camera.top = VIEW_HEIGHT_U / 2;
    this.camera.bottom = -VIEW_HEIGHT_U / 2;
    this.camera.left = (-VIEW_HEIGHT_U * aspect) / 2;
    this.camera.right = (VIEW_HEIGHT_U * aspect) / 2;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  private renderFrame(): void {
    if (this.disposed || this.contextLost) return;
    this.renderer.render(this.scene, this.camera);
    const { calls, triangles } = this.renderer.info.render;
    this.onStatus({ kind: 'running', drawCalls: calls, triangles });
  }

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    if (this.frameRequest !== null) cancelAnimationFrame(this.frameRequest);
    this.frameRequest = null;
    this.onStatus({ kind: 'context-lost' });
  };

  private readonly handleContextRestored = (): void => {
    this.contextLost = false;
    // three.js re-initialises its GL state on restore; presentation resources are rebuilt
    // from code, and no game state lives here to lose.
    this.buildScene();
    this.resize();
  };
}
