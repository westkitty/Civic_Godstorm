// Drives each offline inspector in a real browser with every network request refused, and
// records the master Section 17.3/18.4 inspection evidence:
//   node tools/inspector/capture-evidence.ts [--revision c001] [--browser <chromium executable>]
// Per model it writes, beside viewer.html:
//   turntable.mp4          6 s at 24 fps (144 rendered frames), 1024x1024, H.264
//   validation-sheet.png   2048x2048, four diagnostic views of the delivered GLB
//   inspector-evidence.json  interaction results (load, orbit, zoom, reset, cameras, poses, LODs)

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

interface InspectorWindow {
  __CG_INSPECTOR__?: {
    ready: boolean;
    error: string | null;
    joints: string[];
    lods: Record<string, number>;
    setView(v: string): void;
    setPose(p: string): void;
    setLod(l: string): void;
    setTurntable(d: number): void;
    setLife(stage: string, injured: boolean): void;
    reset(): void;
    nonBackgroundFraction(): number;
    setCanvasSize(w: number, h: number): void;
    captureFrame(): string;
  };
}

const root = resolve(import.meta.dirname, '../..');
const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const recipe = JSON.parse(readFileSync(resolve(root, 'tools/models/q_recipe.json'), 'utf8')) as {
  revision: string;
  modules: Record<string, unknown>;
  form: { id: string };
};
const revision = arg('--revision', recipe.revision);
const executablePath = arg('--browser', process.env.CG_CHROMIUM ?? '');
const ffmpeg = arg('--ffmpeg', resolve(root, '.toolchain/py/lib/python3.11/site-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2'));
const poses = Object.keys((JSON.parse(readFileSync(resolve(root, 'src/render/god/qPoses.json'), 'utf8')) as { poses: Record<string, unknown> }).poses);
const ids = [...Object.keys(recipe.modules), recipe.form.id];

const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
let failed = false;
for (const id of ids) {
  const dir = resolve(root, 'artifacts/inspection', id, revision);
  const viewer = resolve(dir, 'viewer.html');
  if (!existsSync(viewer)) throw new Error(`missing ${viewer}; run tools/inspector/build-viewers.ts`);
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  const blocked: string[] = [];
  const errors: string[] = [];
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('file:')) return route.continue();
    blocked.push(url);
    return route.abort();
  });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`file://${viewer}`);
  await page.waitForFunction(() => {
    const api = (window as unknown as InspectorWindow).__CG_INSPECTOR__;
    return Boolean(api && (api.ready || api.error));
  }, null, { timeout: 60_000 });
  const evidence: Record<string, unknown> = { id, revision, viewer: `artifacts/inspection/${id}/${revision}/viewer.html` };
  const state = await page.evaluate(() => {
    const api = (window as unknown as InspectorWindow).__CG_INSPECTOR__;
    return { ready: api?.ready, error: api?.error, joints: api?.joints.length, lods: api?.lods, coverage: api?.nonBackgroundFraction() };
  });
  evidence.load = state;

  // Real pointer interaction on the canvas: orbit drag, wheel zoom, then the Reset button.
  const canvas = page.locator('#view canvas');
  const box = await canvas.boundingBox();
  const shot = async (): Promise<string> => (await canvas.screenshot()).toString('base64');
  const before = await shot();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 180, box.y + box.height / 2 + 40, { steps: 8 });
    await page.mouse.up();
  }
  const orbited = await shot();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(100);
  }
  const zoomed = await shot();
  await page.getByRole('button', { name: 'Reset' }).click();
  const reset = await shot();
  evidence.interaction = { orbitChangedView: orbited !== before, zoomChangedView: zoomed !== orbited, resetRestoredView: reset === before };

  const cameras: Record<string, number> = {};
  for (const view of ['front', 'left', 'rear', 'top', 'three quarter']) {
    await page.getByRole('button', { name: view, exact: true }).click();
    cameras[view] = await page.evaluate(() => (window as unknown as InspectorWindow).__CG_INSPECTOR__?.nonBackgroundFraction() ?? 0);
  }
  evidence.cameras = cameras;
  const lodCoverage: Record<string, number> = {};
  for (const lod of ['LOD0', 'LOD1', 'LOD2']) {
    await page.locator(`button[data-lod="${lod}"]`).click();
    lodCoverage[lod] = await page.evaluate(() => (window as unknown as InspectorWindow).__CG_INSPECTOR__?.nonBackgroundFraction() ?? 0);
  }
  evidence.lodCoverage = lodCoverage;
  await page.locator('button[data-lod="LOD0"]').click();
  const isForm = id === recipe.form.id;
  if (isForm) {
    const poseShots: Record<string, boolean> = {};
    await page.getByRole('button', { name: 'left', exact: true }).click();
    const bindShot = await shot();
    for (const pose of poses) {
      await page.getByLabel('Pose').selectOption(pose);
      poseShots[pose] = (await shot()) !== bindShot;
    }
    await page.getByLabel('Pose').selectOption('bind');
    evidence.poseChangesPixels = poseShots;
    // Age and injury sample through the real controls, then a fixed-size four-panel record.
    const lifeShots: Record<string, boolean> = {};
    await page.getByLabel('Life stage').selectOption('juvenile');
    lifeShots.juvenile = (await shot()) !== bindShot;
    await page.getByLabel('Life stage').selectOption('ancient');
    lifeShots.ancient = (await shot()) !== bindShot;
    await page.getByLabel('Life stage').selectOption('prime');
    await page.locator('input[data-control="injured"]').check();
    lifeShots.injured = (await shot()) !== bindShot;
    await page.locator('input[data-control="injured"]').uncheck();
    evidence.lifeChangesPixels = lifeShots;
    const lifeSheet = await page.evaluate(async () => {
      const api = (window as unknown as InspectorWindow).__CG_INSPECTOR__;
      if (!api) return '';
      api.setCanvasSize(768, 768);
      const cases: [string, string, boolean][] = [['juvenile', 'juvenile', false], ['prime', 'prime', false], ['ancient', 'ancient', false], ['injured prime', 'prime', true]];
      const c = document.createElement('canvas');
      c.width = 1536;
      c.height = 1536;
      const ctx = c.getContext('2d');
      if (!ctx) return '';
      for (let i = 0; i < cases.length; i += 1) {
        const [label, stage, injured] = cases[i] ?? ['', 'prime', false];
        api.setLife(stage, injured);
        api.setView(i === 3 ? 'three_quarter' : 'left');
        const img = new Image();
        img.src = api.captureFrame();
        await img.decode();
        ctx.drawImage(img, (i % 2) * 768, Math.floor(i / 2) * 768);
        ctx.fillStyle = '#f4ecde';
        ctx.font = '24px sans-serif';
        ctx.fillText(label, (i % 2) * 768 + 12, Math.floor(i / 2) * 768 + 30);
      }
      api.setLife('prime', false);
      api.setCanvasSize(0, 0);
      return c.toDataURL('image/png');
    });
    writeFileSync(resolve(dir, 'age-injury-sample.png'), Buffer.from(lifeSheet.split(',')[1] ?? '', 'base64'));
  }

  // Evidence renders at fixed size.
  const frames = resolve(root, 'artifacts/local/frames', id);
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
  const views = await page.evaluate(() => {
    const api = (window as unknown as InspectorWindow).__CG_INSPECTOR__;
    if (!api) return [];
    api.reset();
    api.setCanvasSize(1024, 1024);
    const out: string[] = [];
    for (const v of ['front', 'left', 'top', 'three_quarter']) {
      api.setView(v);
      out.push(api.captureFrame());
    }
    api.setView('three_quarter');
    return out;
  });
  const sheet = await page.evaluate(async ({ images, labels, title }) => {
    const c = document.createElement('canvas');
    c.width = 2048;
    c.height = 2048;
    const ctx = c.getContext('2d');
    if (!ctx) return '';
    for (let i = 0; i < images.length; i += 1) {
      const img = new Image();
      img.src = images[i] ?? '';
      await img.decode();
      const x = (i % 2) * 1024;
      const y = Math.floor(i / 2) * 1024;
      ctx.drawImage(img, x, y, 1024, 1024);
      ctx.fillStyle = 'rgba(20,25,31,0.8)';
      ctx.fillRect(x, y, 1024, 44);
      ctx.fillStyle = '#f4ecde';
      ctx.font = '26px sans-serif';
      ctx.fillText(`${title} · ${labels[i] ?? ''} (orthographic, delivered GLB, LOD0, bind pose)`, x + 14, y + 31);
    }
    return c.toDataURL('image/png');
  }, { images: views, labels: ['front', 'left', 'top', 'three-quarter'], title: `${id} ${revision}` });
  writeFileSync(resolve(dir, 'validation-sheet.png'), Buffer.from(sheet.split(',')[1] ?? '', 'base64'));
  for (let i = 0; i < 144; i += 1) {
    const frame = await page.evaluate((deg) => {
      const api = (window as unknown as InspectorWindow).__CG_INSPECTOR__;
      api?.setTurntable(deg);
      return api?.captureFrame() ?? '';
    }, i * 2.5);
    writeFileSync(resolve(frames, `frame_${String(i).padStart(3, '0')}.png`), Buffer.from(frame.split(',')[1] ?? '', 'base64'));
  }
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', '24', '-i', resolve(frames, 'frame_%03d.png'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', '-threads', '1', '-an', resolve(dir, 'turntable.mp4')]);
  const probe = execFileSync(ffmpeg, ['-hide_banner', '-i', resolve(dir, 'turntable.mp4'), '-map', '0:v:0', '-c', 'copy', '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  void probe;
  evidence.turntable = { path: `artifacts/inspection/${id}/${revision}/turntable.mp4`, framesRendered: 144, fps: 24, size: [1024, 1024], codec: 'H.264 (libx264, yuv420p)' };
  evidence.validationSheet = { path: `artifacts/inspection/${id}/${revision}/validation-sheet.png`, size: [2048, 2048], views: ['front', 'left', 'top', 'three-quarter'] };
  evidence.networkRequestsBlocked = blocked;
  evidence.pageErrors = errors;
  const inter = evidence.interaction as Record<string, boolean>;
  const cams = Object.values(cameras);
  const ok = state.ready === true && !state.error && (state.coverage ?? 0) > 0.01 && blocked.length === 0 && errors.length === 0
    && inter.orbitChangedView === true && inter.zoomChangedView === true && inter.resetRestoredView === true
    && cams.every((c) => c > 0.005) && Object.values(lodCoverage).every((c) => c > 0.005)
    && (!isForm || (Object.values(evidence.poseChangesPixels as Record<string, boolean>).every(Boolean)
      && Object.values(evidence.lifeChangesPixels as Record<string, boolean>).every(Boolean)));
  evidence.pass = ok;
  if (!ok) failed = true;
  writeFileSync(resolve(dir, 'inspector-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  coverage ${(state.coverage ?? 0).toFixed(3)}  interaction ${JSON.stringify(inter)}  blocked ${blocked.length}  errors ${errors.length}`);
  await page.close();
}
await browser.close();
if (failed) process.exit(1);
