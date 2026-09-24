// Offline model inspector (master Sections 17.3 and 18.4). It is bundled into a single viewer.html
// that embeds the delivered GLB bytes and all rendering code, with no network access at all.
// Controls: orbit (drag), zoom (wheel/pinch), reset, reference cameras, pose, LOD and turntable.
// window.__CG_INSPECTOR__ exposes the same controls to the automated inspection and turntable tools.

import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  HemisphereLight,
  OrthographicCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { applyLifePresentation, LIFE_STAGES, type LifeStage } from '../render/god/qLife.ts';
import type { AxisRotation } from '../render/god/qRig.ts';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { bindQRig, LOD_NAMES, Q_POSES, type LodName, type QPoseName, type QRig } from '../render/god/qRig.ts';

interface EmbeddedModel {
  readonly id: string;
  readonly revision: string;
  readonly sha256: string;
  readonly glbBase64: string;
  readonly poses: boolean;
}

type ViewName = 'front' | 'left' | 'rear' | 'top' | 'three_quarter';
const VIEWS: Record<ViewName, [Vector3, Vector3]> = {
  front: [new Vector3(0, 0, 1), new Vector3(0, 1, 0)],
  left: [new Vector3(-1, 0, 0), new Vector3(0, 1, 0)],
  rear: [new Vector3(0, 0, -1), new Vector3(0, 1, 0)],
  top: [new Vector3(0, 1, 0), new Vector3(0, 0, 1)],
  three_quarter: [new Vector3(-0.62, 0.45, 0.64).normalize(), new Vector3(0, 1, 0)],
};

declare global {
  interface Window {
    __CG_MODEL__?: EmbeddedModel;
    __CG_INSPECTOR__?: InspectorApi;
  }
}

export interface InspectorApi {
  readonly ready: boolean;
  readonly error: string | null;
  readonly id: string;
  readonly joints: readonly string[];
  readonly lods: Record<string, number>;
  setView(view: ViewName): void;
  setPose(pose: QPoseName | 'bind'): void;
  setLod(lod: LodName): void;
  setTurntable(degrees: number): void;
  /** Age/injury sample (complete God only): rebuilds the instance from the embedded GLB. */
  setLife(stage: LifeStage, injured: boolean): void;
  reset(): void;
  renderNow(): void;
  nonBackgroundFraction(): number;
  /** Fixes the drawing buffer size (evidence capture); 0 restores layout-driven sizing. */
  setCanvasSize(width: number, height: number): void;
  captureFrame(): string;
}

function decode(base64: string): ArrayBuffer {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function start(): void {
  const embedded = window.__CG_MODEL__;
  const status = document.getElementById('status') as HTMLElement;
  const canvasHost = document.getElementById('view') as HTMLElement;
  const controlsHost = document.getElementById('controls') as HTMLElement;
  if (!embedded) {
    status.textContent = 'No embedded model.';
    return;
  }
  const model: EmbeddedModel = embedded;
  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setPixelRatio(1);
  canvasHost.appendChild(renderer.domElement);
  const background = new Color('#2b2f33');
  const scene = new Scene();
  scene.background = background;
  scene.add(new HemisphereLight('#dfe8ee', '#3a3128', 1.1));
  scene.add(new AmbientLight('#ffffff', 0.25));
  const key = new DirectionalLight('#fff6e8', 2.2);
  key.position.set(-30, 50, 40);
  scene.add(key);
  const fill = new DirectionalLight('#cfe0ff', 0.6);
  fill.position.set(40, 20, -30);
  scene.add(fill);
  const camera = new OrthographicCamera(-10, 10, 10, -10, 0.1, 1000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;

  let rig: QRig | null = null;
  let content: Object3D | null = null;
  let template: Object3D | null = null;
  let pose: QPoseName | 'bind' = 'bind';
  let lod: LodName = 'LOD0';
  let overlay: Readonly<Record<string, readonly AxisRotation[]>> = {};
  const mount = (stage: LifeStage, injured: boolean): void => {
    if (!template) return;
    if (content) scene.remove(content);
    const instance = cloneSkinned(template);
    const holder = new Group();
    holder.add(instance);
    content = holder;
    content.rotation.y = (spin * Math.PI) / 180;
    scene.add(content);
    rig = bindQRig(instance, { poses: model.poses });
    overlay = model.poses ? applyLifePresentation(holder, rig, { stage, injured }) : {};
    rig.setLod(lod);
    rig.setPose(pose, 1, overlay);
  };
  let centre = new Vector3();
  let radius = 10;
  let spin = 0;
  const api: { -readonly [K in keyof InspectorApi]: InspectorApi[K] } = {
    ready: false,
    error: null,
    id: model.id,
    joints: [],
    lods: {},
    setView: (view) => {
      const [dir, up] = VIEWS[view];
      camera.position.copy(centre).addScaledVector(dir, radius * 4);
      camera.up.copy(up);
      controls.target.copy(centre);
      camera.lookAt(centre);
      controls.update();
      api.renderNow();
    },
    setPose: (next) => {
      pose = next;
      rig?.setPose(pose, 1, overlay);
      api.renderNow();
    },
    setLod: (next) => {
      lod = next;
      rig?.setLod(lod);
      api.renderNow();
    },
    setLife: (stage, injured) => {
      mount(stage, injured);
      api.renderNow();
    },
    setTurntable: (degrees) => {
      spin = degrees;
      if (content) content.rotation.y = (degrees * Math.PI) / 180;
      api.renderNow();
    },
    reset: () => {
      spin = 0;
      pose = 'bind';
      lod = 'LOD0';
      mount('prime', false);
      api.setTurntable(0);
      camera.zoom = 1;
      camera.updateProjectionMatrix();
      api.setView('three_quarter');
    },
    renderNow: () => renderer.render(scene, camera),
    setCanvasSize: (width, height) => {
      fixedSize = width > 0 && height > 0 ? [width, height] : null;
      resize();
    },
    captureFrame: () => {
      api.renderNow();
      return renderer.domElement.toDataURL('image/png');
    },
    nonBackgroundFraction: () => {
      api.renderNow();
      const gl = renderer.getContext();
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const bg = background.clone().convertLinearToSRGB();
      const [br, bgc, bb] = [bg.r * 255, bg.g * 255, bg.b * 255];
      let hit = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (Math.abs((px[i] ?? 0) - br) + Math.abs((px[i + 1] ?? 0) - bgc) + Math.abs((px[i + 2] ?? 0) - bb) > 24) hit += 1;
      }
      return hit / (w * h);
    },
  };
  window.__CG_INSPECTOR__ = api;

  let fixedSize: [number, number] | null = null;
  const resize = (): void => {
    const w = fixedSize ? fixedSize[0] : canvasHost.clientWidth || 800;
    const h = fixedSize ? fixedSize[1] : canvasHost.clientHeight || 800;
    renderer.setSize(w, h, false);
    const aspect = w / h;
    camera.left = -radius * 1.15 * aspect;
    camera.right = radius * 1.15 * aspect;
    camera.top = radius * 1.15;
    camera.bottom = -radius * 1.15;
    camera.far = radius * 12;
    camera.updateProjectionMatrix();
    api.renderNow();
  };

  new GLTFLoader().parse(decode(model.glbBase64), '', (gltf) => {
    template = gltf.scene;
    const box = new Box3().setFromObject(template);
    centre = box.getCenter(new Vector3());
    radius = Math.max(box.getSize(new Vector3()).length() / 2, 1);
    const grid = new GridHelper(radius * 4, 16, '#5a6168', '#3b4046');
    grid.position.y = box.min.y;
    scene.add(grid);
    try {
      mount('prime', false);
      const bound = rig;
      if (bound) {
        api.joints = bound.jointNames;
        for (const name of LOD_NAMES) api.lods[name] = bound.triangles(name);
      }
    } catch (error) {
      api.error = (error as Error).message;
    }
    buildControls();
    resize();
    api.reset();
    api.ready = api.error === null;
    status.textContent = api.error ? `Rig binding failed: ${api.error}` : `${model.id} ${model.revision} · sha256 ${model.sha256.slice(0, 12)} · joints ${api.joints.length} · LOD triangles ${Object.values(api.lods).join(' / ')}`;
  }, (error: unknown) => {
    api.error = error instanceof Error ? error.message : JSON.stringify(error);
    status.textContent = `GLB failed to load: ${api.error}`;
  });

  controls.addEventListener('change', () => api.renderNow());
  window.addEventListener('resize', resize);
  let spinning = false;
  const tick = (): void => {
    if (spinning) api.setTurntable((spin + 1) % 360);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  function buildControls(): void {
    const group = (label: string): HTMLElement => {
      const fs = el('fieldset');
      fs.appendChild(el('legend', label));
      controlsHost.appendChild(fs);
      return fs;
    };
    const views = group('Camera');
    for (const view of Object.keys(VIEWS) as ViewName[]) {
      const b = el('button', view.replace('_', ' '), { type: 'button', 'data-view': view });
      b.addEventListener('click', () => api.setView(view));
      views.appendChild(b);
    }
    const reset = el('button', 'Reset', { type: 'button', 'data-action': 'reset' });
    reset.addEventListener('click', () => api.reset());
    views.appendChild(reset);
    const spinBtn = el('button', 'Turntable', { type: 'button', 'aria-pressed': 'false', 'data-action': 'spin' });
    spinBtn.addEventListener('click', () => {
      spinning = !spinning;
      spinBtn.setAttribute('aria-pressed', String(spinning));
    });
    views.appendChild(spinBtn);
    if (rig && model.poses) {
      const poses = group('Pose');
      const select = el('select', '', { 'aria-label': 'Pose', 'data-control': 'pose' });
      for (const pose of ['bind', ...Q_POSES]) select.appendChild(el('option', pose, { value: pose }));
      select.addEventListener('change', () => api.setPose(select.value as QPoseName | 'bind'));
      poses.appendChild(select);
      const life = group('Age and injury sample');
      const stage = el('select', '', { 'aria-label': 'Life stage', 'data-control': 'stage' });
      for (const name of LIFE_STAGES) stage.appendChild(el('option', name, { value: name }));
      stage.value = 'prime';
      const injuredLabel = el('label', ' Injured (left foreleg, flank scar)');
      const injured = el('input', '', { type: 'checkbox', 'data-control': 'injured' });
      injuredLabel.prepend(injured);
      const apply = (): void => api.setLife(stage.value as LifeStage, injured.checked);
      stage.addEventListener('change', apply);
      injured.addEventListener('change', apply);
      life.append(stage, injuredLabel);
    }
    if (rig) {
      const lods = group('Level of detail');
      for (const level of LOD_NAMES) {
        const b = el('button', `${level} (${api.lods[level] ?? 0} tris)`, { type: 'button', 'data-lod': level });
        b.addEventListener('click', () => api.setLod(level));
        lods.appendChild(b);
      }
    }
  }
}

start();
