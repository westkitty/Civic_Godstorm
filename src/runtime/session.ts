// Game session (master Section 14.3 runtime/): holds the committed campaign, the human player's
// command drafts for the next turn and the resolved command log. It resolves turns through the pure
// kernel and exposes the human player's ObservationView. It owns no rules of its own.

import { createCampaign, type NewCampaignOptions } from '../sim/campaign.ts';
import type { Command, Rejection } from '../sim/core/commands.ts';
import type { CampaignState } from '../sim/core/state.ts';
import { hashState, resolveTurn } from '../sim/core/turn.ts';
import { buildObservationView, type ObservationView } from '../sim/observation/observation.ts';
import { baselineCommands } from '../sim/scripted/baselinePolicy.ts';

export interface ResolvedTurnRecord {
  readonly turn: number;
  readonly commands: Command[];
  readonly rejections: Rejection[];
  readonly stateHash: string;
}

export interface CommandLog {
  readonly format: 'cg-command-log-1';
  readonly options: NewCampaignOptions;
  readonly initialHash: string;
  readonly turns: ResolvedTurnRecord[];
}

export interface SessionSnapshot {
  readonly version: number;
  readonly state: CampaignState;
  readonly view: ObservationView;
  readonly drafts: readonly Command[];
  readonly lastResolution: ResolvedTurnRecord | null;
}

/** Commands issued automatically for non-human civilizations. M02: the scripted development driver
 * manages AI settlements and AI Gods hold; the observation-limited AI arrives with M08. */
export function automatedCommands(state: CampaignState): Command[] {
  return state.civs.filter((civ) => civ.controller === 'AI').flatMap((civ) => baselineCommands(state, civ.id));
}

export class GameSession {
  private state: CampaignState;
  private drafts: Command[] = [];
  private readonly log: CommandLog;
  private version = 0;
  private snapshot: SessionSnapshot;
  private readonly listeners = new Set<() => void>();
  readonly humanCivId: number;

  constructor(options: NewCampaignOptions) {
    this.state = createCampaign(options);
    const human = this.state.civs.find((civ) => civ.controller === 'HUMAN');
    if (!human) throw new Error('campaign has no human civilization');
    this.humanCivId = human.id;
    this.log = { format: 'cg-command-log-1', options, initialHash: hashState(this.state), turns: [] };
    this.snapshot = this.makeSnapshot(null);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SessionSnapshot => this.snapshot;

  /** Next sequence number for a human draft (stable, per turn). */
  nextSequence(): number {
    return this.drafts.reduce((max, command) => Math.max(max, command.sequence), 0) + 1;
  }

  /** Adds a draft; a new God order for the same actor replaces the previous God order draft. */
  addDraft(command: Command): void {
    const isOrder = (c: Command): boolean => c.kind === 'GOD_MOVE' || c.kind === 'GOD_FEED' || c.kind === 'GOD_REST' || c.kind === 'GOD_HOLD';
    this.drafts = this.drafts.filter((c) => !(c.actorId === command.actorId && (c.kind === command.kind || (isOrder(c) && isOrder(command)))));
    this.drafts.push(command);
    this.publish(this.snapshot.lastResolution);
  }

  removeDraft(commandId: string): void {
    this.drafts = this.drafts.filter((command) => command.commandId !== commandId);
    this.publish(this.snapshot.lastResolution);
  }

  endTurn(): ResolvedTurnRecord {
    const commands = [...this.drafts, ...automatedCommands(this.state)];
    const result = resolveTurn(this.state, commands);
    this.state = result.state;
    const record: ResolvedTurnRecord = { turn: result.state.turn, commands, rejections: [...result.rejections], stateHash: result.stateHash };
    this.log.turns.push(record);
    this.drafts = [];
    this.publish(record);
    return record;
  }

  exportLog(): CommandLog {
    return structuredClone(this.log);
  }

  private makeSnapshot(lastResolution: ResolvedTurnRecord | null): SessionSnapshot {
    return {
      version: this.version,
      state: this.state,
      view: buildObservationView(this.state, this.humanCivId),
      drafts: [...this.drafts],
      lastResolution,
    };
  }

  private publish(lastResolution: ResolvedTurnRecord | null): void {
    this.version += 1;
    this.snapshot = this.makeSnapshot(lastResolution);
    for (const listener of this.listeners) listener();
  }
}

/** Replays a command log headlessly; returns every committed hash (initial first). */
export function replayCommandLog(log: CommandLog): string[] {
  let state = createCampaign(log.options);
  const hashes = [hashState(state)];
  for (const turn of log.turns) {
    const result = resolveTurn(state, turn.commands);
    state = result.state;
    hashes.push(result.stateHash);
  }
  return hashes;
}
