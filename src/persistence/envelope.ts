// Versioned save envelope (master Section 13.3). Pure encode/decode; IndexedDB storage, rotation and
// compressed export arrive with the persistence milestone work. Saves are taken only at committed
// turn boundaries and are verified before use.

import { canonicalize } from '../sim/core/canonical.ts';
import { sha256Text } from '../sim/core/sha256.ts';
import type { CampaignState } from '../sim/core/state.ts';
import { hashState } from '../sim/core/turn.ts';
import { RULES_HASH, SIMULATION_VERSION } from '../sim/data/rules.ts';

export const SAVE_FORMAT_VERSION = 1;
/** Section 13.3: imports are bounded; decoded payload limit. */
export const MAX_PAYLOAD_BYTES = 100 * 1024 * 1024;

export interface SaveEnvelope {
  readonly formatVersion: number;
  readonly simulationVersion: string;
  readonly contentHash: string;
  readonly campaignId: string;
  readonly turn: number;
  readonly stateHash: string;
  readonly payloadLength: number;
  readonly checksum: string;
}

export interface SaveFile {
  readonly envelope: SaveEnvelope;
  readonly payload: string;
}

export class SaveRejected extends Error {
  override readonly name = 'SaveRejected';
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function encodeSave(state: CampaignState): SaveFile {
  const payload = canonicalize(state);
  return {
    envelope: {
      formatVersion: SAVE_FORMAT_VERSION,
      simulationVersion: SIMULATION_VERSION,
      contentHash: RULES_HASH,
      campaignId: state.campaignId,
      turn: state.turn,
      stateHash: hashState(state),
      payloadLength: payload.length,
      checksum: sha256Text(payload),
    },
    payload,
  };
}

export function serializeSaveFile(file: SaveFile): string {
  return canonicalize(file);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates envelope, checksum, versions and state hash before returning a campaign. */
export function decodeSave(text: string): CampaignState {
  if (text.length > MAX_PAYLOAD_BYTES) throw new SaveRejected('TOO_LARGE', 'save exceeds the decoded size limit');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SaveRejected('MALFORMED', 'save is not valid JSON');
  }
  if (!isRecord(parsed) || !isRecord(parsed.envelope) || typeof parsed.payload !== 'string') {
    throw new SaveRejected('MALFORMED', 'save lacks envelope or payload');
  }
  const envelope = parsed.envelope as unknown as SaveEnvelope;
  const payload = parsed.payload;
  if (typeof envelope.formatVersion !== 'number') throw new SaveRejected('MALFORMED', 'missing formatVersion');
  if (envelope.formatVersion > SAVE_FORMAT_VERSION) {
    throw new SaveRejected('FUTURE_VERSION', `save format ${envelope.formatVersion} is newer than this build supports`);
  }
  if (envelope.formatVersion !== SAVE_FORMAT_VERSION) throw new SaveRejected('UNSUPPORTED_VERSION', 'no migration for this format');
  if (envelope.payloadLength !== payload.length) throw new SaveRejected('CORRUPT', 'payload length mismatch');
  if (envelope.checksum !== sha256Text(payload)) throw new SaveRejected('CORRUPT', 'checksum mismatch');
  if (envelope.contentHash !== RULES_HASH || envelope.simulationVersion !== SIMULATION_VERSION) {
    throw new SaveRejected('RULES_MISMATCH', 'save was made with different rules data; migration required');
  }
  const state = JSON.parse(payload) as CampaignState;
  if (hashState(state) !== envelope.stateHash) throw new SaveRejected('CORRUPT', 'state hash mismatch');
  if (state.turn !== envelope.turn || state.campaignId !== envelope.campaignId) {
    throw new SaveRejected('CORRUPT', 'envelope does not describe payload');
  }
  return state;
}
