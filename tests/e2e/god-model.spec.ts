// M03 on-map proof: the player's God is drawn with the derived FORM-Q model (hash-checked, labelled
// as an unapproved candidate), at the size-I scale, with its feet on the terrain and its plan view
// inside its footprint cells (Section 3.1: at most 5% decorative overhang). The measurements come
// from the rendered skinned instance, not from the simulation.
import { expect, test, type Page } from '@playwright/test';

interface RenderedGod {
  godId: number;
  modelStatus: string;
  modelId: string;
  heightU: number;
  lowestPointU: number;
  terrainTopU: number;
  verticesSampled: number;
  outsideFootprintFraction: number;
}
interface Debug {
  godModel(): { id: string; status: string; state: string };
  renderedGods(): RenderedGod[];
}

async function open(page: Page): Promise<void> {
  await page.goto('./?debug=1');
  await expect(page.getByTestId('renderer-status')).toHaveAttribute('data-renderer-kind', 'running');
  await page.waitForFunction(() => {
    const d = (window as unknown as { __CG_DEBUG__?: Debug }).__CG_DEBUG__;
    return d !== undefined && d.godModel().state !== 'pending' && (d.godModel().state === 'failed' || d.renderedGods().length > 0);
  }, null, { timeout: 30_000 });
}

test('the God is drawn with its hash-checked body model at size-I scale, standing in its footprint', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  const model = await page.evaluate(() => (window as unknown as { __CG_DEBUG__: Debug }).__CG_DEBUG__.godModel());
  expect(model.id).toBe('CG-D-GOD-FORM-Q');
  expect(model.state).toBe('loaded');
  await expect(page.getByTestId('god-model-status')).toContainText(model.status === 'VERIFIED' ? 'verified' : 'Unapproved candidate CG-D-GOD-FORM-Q');
  const gods = await page.evaluate(() => (window as unknown as { __CG_DEBUG__: Debug }).__CG_DEBUG__.renderedGods());
  expect(gods).toHaveLength(1);
  const god = gods[0] as RenderedGod;
  // Section 3.1: a size-I primary mass is about 12 U high.
  expect(god.heightU).toBeGreaterThan(10.5);
  expect(god.heightU).toBeLessThan(13.5);
  // Contact: the lowest skinned point sits on the terrain top (idle pose, small tolerance for soft pads).
  expect(Math.abs(god.lowestPointU - god.terrainTopU)).toBeLessThan(0.6);
  // Plan view inside the TWO-cell footprint.
  expect(god.verticesSampled).toBeGreaterThan(500);
  expect(god.outsideFootprintFraction).toBeLessThanOrEqual(0.05);
  expect(errors).toEqual([]);
  if (info.project.name.includes('desktop')) {
    await page.getByTestId('world-canvas').screenshot({ path: info.outputPath('god-on-map.png') });
  }
});

test('a missing or corrupt model file is never shown: the MISSING placeholder stays', async ({ page }) => {
  await page.route('**/*.glb', (route) => route.fulfill({ status: 200, body: Buffer.from('not a glb') }));
  await open(page);
  const state = await page.evaluate(() => (window as unknown as { __CG_DEBUG__: Debug }).__CG_DEBUG__.godModel().state);
  expect(state).toBe('failed');
  const gods = await page.evaluate(() => (window as unknown as { __CG_DEBUG__: Debug }).__CG_DEBUG__.renderedGods());
  expect(gods).toHaveLength(0);
});
