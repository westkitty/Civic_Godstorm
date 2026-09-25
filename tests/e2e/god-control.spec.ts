// M02 exit journeys: direct God control through real pointer, keyboard and touch input, then a
// headless replay of the session's command log must reproduce every committed state hash.
import { expect, test, type Page } from '@playwright/test';
import { replayCommandLog, type CommandLog } from '../../src/runtime/session.ts';
import type { CampaignState } from '../../src/sim/core/state.ts';
import { resolveTurn } from '../../src/sim/core/turn.ts';
import { createCampaign } from '../../src/sim/campaign.ts';
import { previewRoute } from '../../src/sim/gods/planner.ts';
import { buildObservationView, observedKnowledge } from '../../src/sim/observation/observation.ts';
import { distance } from '../../src/sim/world/hex.ts';

const GOD_CELL = 612;
const AROUND_CITY = 804;

async function open(page: Page): Promise<void> {
  await page.goto('./?debug=1');
  await expect(page.getByTestId('renderer-status')).toHaveAttribute('data-renderer-kind', 'running');
}

async function pointOf(page: Page, cell: number): Promise<{ x: number; y: number }> {
  await page.getByTestId('world-canvas').scrollIntoViewIfNeeded();
  const point = await page.evaluate((c) => (window as unknown as { __CG_DEBUG__: { clientPointOfCell(c: number): { x: number; y: number } | null } }).__CG_DEBUG__.clientPointOfCell(c), cell);
  if (!point) throw new Error(`cell ${cell} is off screen`);
  return point;
}

async function clickCell(page: Page, cell: number, button: 'left' | 'right' = 'left'): Promise<void> {
  const { x, y } = await pointOf(page, cell);
  await page.mouse.click(x, y, { button });
}

async function readLog(page: Page): Promise<CommandLog> {
  await page.getByText('Debug: session command log').click();
  return JSON.parse(await page.getByTestId('command-log').inputValue()) as CommandLog;
}

function stateFromLog(log: CommandLog): CampaignState {
  let state = createCampaign(log.options);
  for (const turn of log.turns) state = resolveTurn(state, turn.commands).state;
  return state;
}

/** A nearby destination whose shortest route tramples the player's own farmland (legal, but warned). */
function consentTarget(state: CampaignState): number {
  const god = state.gods.find((g) => g.ownerId === state.civs[0]?.id);
  if (!god) throw new Error('no god');
  const view = buildObservationView(state, god.ownerId);
  const knowledge = observedKnowledge(view, god.id);
  for (let cell = 0; cell < view.observation.visibility.length; cell += 1) {
    if (view.observation.visibility[cell] !== 2 || distance(view.dims, cell, god.anchor) > 5) continue;
    const preview = previewRoute(knowledge, god, [cell]);
    if (preview.direct.ok && preview.direct.civilianCollateral.length > 0) return cell;
  }
  throw new Error('no consent-requiring destination in view');
}

function expectReplayMatches(log: CommandLog): void {
  const hashes = replayCommandLog(log);
  expect(hashes[0]).toBe(log.initialHash);
  expect(hashes.slice(1)).toEqual(log.turns.map((turn) => turn.stateHash));
}

test('pointer journey: select, route around the city, feed, rest, cancel, override a warning; replay matches', async ({ page }) => {
  await open(page);

  // Select the God by clicking its body on the map.
  await clickCell(page, GOD_CELL);
  await expect(page.getByRole('button', { name: 'God selected' })).toBeVisible();

  // Route around the capital to the far side, feeding on arrival.
  await page.getByRole('button', { name: 'Move (M)' }).click();
  await clickCell(page, AROUND_CITY);
  await expect(page.getByTestId('route-destination')).toContainText('(36, 16)');
  await page.getByLabel('On arrival').selectOption('FEED');
  await page.getByTestId('confirm-route').click();
  await expect(page.getByTestId('draft-list')).toContainText('then feed');
  await page.getByTestId('end-turn').click();
  await expect(page.getByTestId('god-order')).toContainText('Moving');
  // Unobserved cells were estimated at 1 AP; true terrain can cost more, and a FEED that no longer fits
  // the arrival turn's AP runs the next turn.
  for (let turn = 0; turn < 4 && /^(Moving|Feeding)/.test(await page.getByTestId('god-order').innerText()); turn += 1) {
    await page.getByTestId('end-turn').click();
  }
  await expect(page.getByTestId('turn-report')).toContainText('fed');
  await expect(page.getByTestId('god-location')).toContainText('(36, 16)');

  // Rest for a turn.
  await page.getByRole('button', { name: 'Rest (R)' }).click();
  await page.getByTestId('end-turn').click();
  await expect(page.getByTestId('turn-report')).toContainText('rested');

  // Start a long itinerary, let it run one turn, then cancel it.
  await page.getByRole('button', { name: 'Move (M)' }).click();
  await clickCell(page, GOD_CELL);
  await page.getByTestId('confirm-route').click();
  await page.getByTestId('end-turn').click();
  const midRoute = await page.getByTestId('god-location').innerText();
  await page.getByRole('button', { name: 'Hold / cancel itinerary (H)' }).click();
  await page.getByTestId('end-turn').click();
  await page.getByTestId('end-turn').click();
  await expect(page.getByTestId('god-order')).toHaveText('Holding position');
  await expect(page.getByTestId('god-location')).toHaveText(midRoute);

  // A route through farmland is legal but warned; confirming needs explicit consent.
  const target = consentTarget(stateFromLog(await readLog(page)));
  await page.getByRole('button', { name: 'Move (M)' }).click();
  await clickCell(page, target);
  await expect(page.getByTestId('route-warning')).toContainText('tramples farmland');
  if (await page.getByTestId('route-direct').isVisible()) await page.getByTestId('route-direct').check();
  await expect(page.getByTestId('confirm-route')).toBeDisabled();
  await page.getByTestId('consent-checkbox').check();
  await expect(page.getByTestId('confirm-route')).toBeEnabled();
  await page.getByTestId('confirm-route').click();
  await expect(page.getByTestId('draft-list')).toContainText('consent given');
  await page.getByTestId('end-turn').click();
  await expect(page.getByTestId('turn-report')).not.toContainText('rejected');

  const log = await readLog(page);
  expect(log.turns.length).toBeGreaterThanOrEqual(7);
  expect(log.turns.flatMap((t) => t.rejections)).toEqual([]);
  expectReplayMatches(log);
});

test('keyboard journey: G, M, arrows and Enter order a move and end the turn', async ({ page }) => {
  await open(page);
  await page.keyboard.press('g');
  await expect(page.getByRole('button', { name: 'God selected' })).toBeVisible();
  await page.keyboard.press('m');
  await expect(page.getByTestId('target-cursor')).toHaveText('(36, 12)');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('route-destination')).toBeVisible();
  await page.getByTestId('confirm-route').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('draft-list')).toContainText('Move God');
  await page.locator('body').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('turn-number')).toHaveText('Turn 2');
  await expect(page.getByTestId('god-location')).not.toHaveText('(36, 12) facing 0°');
  expectReplayMatches(await readLog(page));
});

test.describe('touch', () => {
  test.use({ hasTouch: true });

  test('touch journey: tap select, tap destination, confirm button, end turn', async ({ page, browserName }) => {
    test.skip(browserName === 'firefox', 'Playwright Firefox does not support touch emulation');
    await open(page);
    const god = await pointOf(page, GOD_CELL);
    await page.touchscreen.tap(god.x, god.y);
    await expect(page.getByRole('button', { name: 'God selected' })).toBeVisible();
    await page.getByRole('button', { name: 'Move (M)' }).tap();
    const dest = await pointOf(page, AROUND_CITY);
    await page.touchscreen.tap(dest.x, dest.y);
    await expect(page.getByTestId('route-destination')).toContainText('(36, 16)');
    await page.getByTestId('confirm-route').tap();
    await page.getByTestId('end-turn').tap();
    await expect(page.getByTestId('god-order')).toContainText('Moving');
    expectReplayMatches(await readLog(page));
  });
});
