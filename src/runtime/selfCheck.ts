// Determinism self-check runnable in any runtime (Node or browser). It executes the Section 16.7
// golden vectors and a fixed headless campaign; the resulting hashes must equal the committed
// Node-produced fixture in every target browser.

import { xor32Next } from '../sim/core/rng.ts';
import { runHeadlessCampaign } from '../sim/headless.ts';

export const GOLDEN_VECTORS = [270369, 67634689, 2647435461, 307599695, 2398689233] as const;

export const SELF_CHECK_OPTIONS = { seed: 'cg-selfcheck', size: 'small', civCount: 2, turns: 30 } as const;

export interface SelfCheckResult {
  readonly goldenVectorsPass: boolean;
  readonly initialHash: string;
  readonly finalHash: string;
  readonly turns: number;
}

export function runSelfCheck(): SelfCheckResult {
  let state = 1;
  const outputs: number[] = [];
  for (let i = 0; i < GOLDEN_VECTORS.length; i += 1) {
    state = xor32Next(state);
    outputs.push(state);
  }
  const campaign = runHeadlessCampaign(SELF_CHECK_OPTIONS);
  return {
    goldenVectorsPass: outputs.every((value, i) => value === GOLDEN_VECTORS[i]),
    initialHash: campaign.hashes[0] ?? '',
    finalHash: campaign.hashes.at(-1) ?? '',
    turns: campaign.state.turn,
  };
}
