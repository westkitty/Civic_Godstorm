// Headless campaign driver shared by `test:campaigns`, the sim suites and the browser self-check.
// It advances real committed turns through the shared validator using the scripted baseline driver.

import { createCampaign } from './campaign.ts';
import type { CampaignState } from './core/state.ts';
import { hashState, resolveTurn } from './core/turn.ts';
import { baselineTurnCommands } from './scripted/baselinePolicy.ts';
import type { MapSizeName } from './world/hex.ts';

export interface HeadlessOptions {
  readonly seed: string;
  readonly size: MapSizeName;
  readonly civCount: number;
  readonly turns: number;
  /** Continue from a restored committed state instead of creating a new campaign. */
  readonly from?: CampaignState;
}

export interface HeadlessResult {
  readonly state: CampaignState;
  /** Hash of the initial state followed by the hash after each committed turn. */
  readonly hashes: string[];
  readonly rejections: number;
}

export function runHeadlessCampaign(options: HeadlessOptions): HeadlessResult {
  let state = options.from ?? createCampaign({ seed: options.seed, size: options.size, civCount: options.civCount });
  const hashes = [hashState(state)];
  let rejections = 0;
  for (let turn = 0; turn < options.turns; turn += 1) {
    const result = resolveTurn(state, baselineTurnCommands(state));
    rejections += result.rejections.length;
    state = result.state;
    hashes.push(result.stateHash);
  }
  return { state, hashes, rejections };
}
