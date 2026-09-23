import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test('boots the shell with a rendering WebGL2 world view and honest asset status', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./');

  await expect(page.getByRole('heading', { level: 1, name: 'CIVIC GODSTORM' })).toBeVisible();
  await expect(page.getByTestId('renderer-status')).toHaveAttribute('data-renderer-kind', 'running');
  await expect(page.getByTestId('renderer-status')).toContainText('draw calls');
  await expect(page.getByTestId('asset-summary')).toHaveText('285 IDs specified; 285 unresolved');
  await expect(page.getByText('MISSING CG-A-ART-TITLE')).toBeVisible();
  await expect(page.getByRole('img', { name: /CG-R-TERRAIN/ })).toBeVisible();

  // The canvas must contain actual rendered pixels, not only the clear colour.
  const canvas = page.getByTestId('world-canvas');
  const shot = await canvas.screenshot();
  const distinct = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const surface = new OffscreenCanvas(image.width, image.height);
    const context = surface.getContext('2d');
    if (!context) return 0;
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, image.width, image.height);
    const colours = new Set<number>();
    for (let index = 0; index < data.length; index += 16) {
      colours.add(((data[index] ?? 0) << 16) | ((data[index + 1] ?? 0) << 8) | (data[index + 2] ?? 0));
      if (colours.size > 64) break;
    }
    return colours.size;
  }, shot.toString('base64'));
  expect(distinct).toBeGreaterThan(8);
  expect(errors).toEqual([]);
});

test('exposes labelled sections without horizontal overflow', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByTestId('renderer-status')).toHaveAttribute('data-renderer-kind', 'running');
  for (const name of ['Title art', 'World view', 'Build status']) {
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('shows an accessible requirement screen when WebGL2 is unavailable', async ({ page, browserName }) => {
  await page.addInitScript(() => {
    const original = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext')?.value as
      (this: HTMLCanvasElement, ...args: unknown[]) => unknown;
    HTMLCanvasElement.prototype.getContext = function patched(this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
      if (kind === 'webgl2') return null;
      return original.call(this, kind, ...rest);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto('./');
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('This browser cannot run CIVIC GODSTORM');
  await expect(alert).toContainText('WEBGL2_UNAVAILABLE');
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  // macOS WebKit (like Safari by default) moves focus to buttons with Option-Tab, not Tab.
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect(page.getByRole('button', { name: 'Check again' })).toBeFocused();
  await expect(page.getByTestId('world-canvas')).toHaveCount(0);
});

test('reports a renderer start failure with a recovery action', async ({ page }) => {
  await page.addInitScript(() => {
    // WebGL2 exists for the capability probe (which never calls getParameter), but the renderer's
    // start-up capability queries fail.
    WebGL2RenderingContext.prototype.getParameter = function injected(): never {
      throw new Error('Injected GPU failure');
    };
  });
  const errors = collectErrors(page);
  await page.goto('./');
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('The 3D renderer could not start');
  await expect(alert).toContainText('RENDERER_START_FAILED');
  await expect(alert).toContainText('Injected GPU failure');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('runs the kernel self-check in the browser and matches the Node reference hash', async ({ page }) => {
  const fixture = JSON.parse(readFileSync(resolve(import.meta.dirname, '../fixtures/selfcheck.json'), 'utf8')) as { finalHash: string };
  await page.goto('./');
  await page.getByRole('button', { name: 'Run determinism self-check' }).click();
  await expect(page.getByTestId('selfcheck-result')).toHaveAttribute('data-selfcheck-kind', 'done', { timeout: 30_000 });
  await expect(page.getByTestId('selfcheck-golden')).toHaveText('pass');
  await expect(page.getByTestId('selfcheck-final-hash')).toHaveText(fixture.finalHash);
});
