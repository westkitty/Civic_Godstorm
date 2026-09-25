// Source intake and reconciliation against the Arena ledger (master Sections 17.2, 18.2, 18.4).
//   node tools/assets/intake.ts            -> copy canonical Arena sources, write provenance and manifest source entries
//   node tools/assets/intake.ts --check    -> fail if any canonical file, provenance or manifest entry differs
//
// The Arena branch is the only author of source bytes. This tool reads the pinned commit's
// `assets/arena_receipts.json` and its `assets/source/**` blobs with `git show`; it never resamples.
// An ID is taken only when its receipt says CANONICAL_SOURCE_PRESENT, its promotion names a
// recorded human ruling, its promoted candidate is not REJECTED and every hash in that chain matches
// the actual bytes. File existence alone never approves anything. IDs the ledger leaves blocked or
// unresolved stay absent. Moving the pin requires re-reading the Arena ledger, not editing lists here.
//
// If the pinned commit is not in the local object store: git fetch origin arena/01a0d03e-civic-godstorm

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { MANIFEST_PATH, PROVENANCE_PATH, SPECIFICATION_PATH } from '../spec/outputs.ts';

export const ARENA_BRANCH = 'arena/01a0d03e-civic-godstorm';
export const ARENA_COMMIT = '15c6f1b232d339e7195d17477737f7183faa06a1';
export const RECEIPTS_PATH = 'assets/arena_receipts.json';
/** SHA-256 of the ledger blob at ARENA_COMMIT; a different ledger is a different reconciliation. */
export const RECEIPTS_SHA256 = '09ff3e26dbad22bc8e22f086c0c39d57599b0dc6ed36103413efeeaac9f61739';
export const SOURCE_ROOT = 'assets/source';

/** Canonical file dimensions per authored profile (master Section 17.3). */
export const PROFILE_DIMENSIONS: Readonly<Record<string, readonly [number, number]>> = {
  'REF-GOD': [2048, 2048],
  'REF-FORM': [2048, 2048],
  'REF-LIFE': [3072, 2048],
  'REF-PROP': [2048, 2048],
  'REF-INF': [3072, 2048],
  'REF-MOTIF': [2048, 2048],
  'REF-GLYPH': [512, 512],
  'REF-DIRECTION': [3072, 2048],
  'DIRECT-TITLE': [2048, 1024],
};

const RIGHTS = 'Arena-generated for this project; commercial clearance not established (master Section 17.2, audited at M14).';

// ---- Arena ledger shape (only the fields this tool reads) ----

export interface ArenaCandidate {
  readonly revision: string;
  readonly path: string;
  readonly sha256: string;
  readonly status: string;
  readonly native_dimensions?: string;
  readonly generation_tool?: string;
  readonly model?: string;
}

export interface ArenaReceipt {
  readonly canonical_path: string;
  readonly id_status: string;
  readonly candidates?: readonly ArenaCandidate[];
  readonly approval?: { readonly approver?: string; readonly date?: string; readonly decision?: string } | null;
  readonly promotion?: {
    readonly authority: string;
    readonly date: string;
    readonly operation: string;
    readonly normalization_tool?: string;
    readonly source_candidate: string;
    readonly source_candidate_sha256: string;
    readonly canonical_dimensions: string;
    readonly canonical_sha256: string;
    readonly deviation?: string;
  };
  readonly blocked_reason?: string;
  readonly canonical_state?: string;
}

export interface ArenaRuling {
  readonly id: string;
  readonly ruling: { readonly date?: string; readonly authority?: string; readonly decision?: string };
}

export interface ArenaLedger {
  readonly specification_version: string;
  readonly receipts: Readonly<Record<string, ArenaReceipt>>;
  readonly human_rulings: readonly ArenaRuling[];
}

export interface SpecRow {
  readonly id: string;
  readonly class: string;
  readonly profile: string;
  readonly path: string;
  readonly batch: string | null;
}

// ---- Output records ----

export interface SourceRecord {
  readonly id: string;
  readonly status: 'APPROVED_SOURCE';
  readonly batch: string | null;
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  /** Canonical file dimensions (after the recorded normalization). */
  readonly width: number;
  readonly height: number;
  readonly profile: string;
  readonly profileDimensions: readonly [number, number];
  /** Human ruling accepting a canonical file that differs from the profile dimensions. */
  readonly dimensionWaiver?: string;
  readonly deviation?: string;
  readonly normalization: { readonly operation: string; readonly tool: string };
  readonly candidate: {
    readonly branch: string;
    readonly commit: string;
    readonly path: string;
    readonly revision: string;
    readonly sha256: string;
    readonly nativeDimensions: string;
    readonly ledgerStatus: string;
  };
  readonly generator: string;
  readonly approval: { readonly approver: string; readonly date: string; readonly decision: string; readonly rulings: readonly string[] };
  readonly rights: string;
}

export interface AbsentRecord {
  readonly id: string;
  readonly status: 'BLOCKED' | 'REJECTED';
  readonly batch: string | null;
  readonly ledgerStatus: string;
  readonly reason: string;
  readonly candidatesRejected: readonly string[];
}

export interface ExpectedSource {
  readonly record: SourceRecord;
  readonly bytes: Buffer;
}

/** Reads width/height from a PNG IHDR chunk and rejects anything that is not a single-frame PNG. */
export function pngFacts(bytes: Buffer): { width: number; height: number; bitDepth: number; colorType: number } {
  const signature = '89504e470d0a1a0a';
  if (bytes.subarray(0, 8).toString('hex') !== signature) throw new Error('not a PNG');
  if (bytes.subarray(12, 16).toString('latin1') !== 'IHDR') throw new Error('PNG without leading IHDR');
  if (bytes.includes(Buffer.from('acTL', 'latin1'))) throw new Error('animated PNG (more than one image frame)');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bitDepth: bytes[24] ?? 0, colorType: bytes[25] ?? 0 };
}

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Ruling IDs named by a promotion authority: literal ledger IDs or `#N` (1-based ledger order). */
export function referencedRulings(authority: string, rulings: readonly ArenaRuling[]): string[] {
  const ids = new Set<string>();
  for (const ruling of rulings) if (authority.includes(ruling.id)) ids.add(ruling.id);
  for (const match of authority.matchAll(/#(\d+)/g)) {
    const ruling = rulings[Number(match[1]) - 1];
    if (ruling) ids.add(ruling.id);
  }
  return [...ids].sort();
}

const isHuman = (text: string | undefined): boolean => text?.startsWith('human') ?? false;

export interface IntakeDecision {
  readonly accept: readonly { readonly id: string; readonly row: SpecRow; readonly receipt: ArenaReceipt; readonly candidate: ArenaCandidate; readonly rulings: readonly string[] }[];
  readonly absent: readonly AbsentRecord[];
  readonly problems: readonly string[];
}

/**
 * Pure selection from ledger + specification. Every authored ID must be either accepted with a
 * complete human-approved chain, or recorded absent with the ledger's reason. Anything else is a
 * problem (the intake refuses to guess).
 */
export function decideIntake(ledger: ArenaLedger, spec: readonly SpecRow[]): IntakeDecision {
  const accept: IntakeDecision['accept'][number][] = [];
  const absent: AbsentRecord[] = [];
  const problems: string[] = [];
  const authored = spec.filter((row) => row.class === 'ARENA SOURCE ASSET' || row.class === 'DIRECT ARENA ASSET');
  const authoredIds = new Set(authored.map((row) => row.id));
  for (const id of Object.keys(ledger.receipts)) if (!authoredIds.has(id)) problems.push(`${id}: ledger receipt for an ID that is not an authored source`);

  for (const row of authored) {
    const receipt = ledger.receipts[row.id];
    if (!receipt) { problems.push(`${row.id}: no Arena receipt`); continue; }
    if (receipt.canonical_path !== row.path) { problems.push(`${row.id}: receipt path ${receipt.canonical_path} != specified ${row.path}`); continue; }
    const rejected = (receipt.candidates ?? []).filter((c) => c.status === 'REJECTED').map((c) => c.revision);
    if (receipt.id_status !== 'CANONICAL_SOURCE_PRESENT') {
      const blocked = receipt.id_status === 'BLOCKED';
      absent.push({
        id: row.id,
        status: blocked ? 'BLOCKED' : 'REJECTED',
        batch: row.batch,
        ledgerStatus: receipt.id_status,
        reason: receipt.blocked_reason ?? receipt.canonical_state ?? receipt.id_status,
        candidatesRejected: rejected,
      });
      continue;
    }
    const promotion = receipt.promotion;
    if (!promotion) { problems.push(`${row.id}: CANONICAL_SOURCE_PRESENT without a promotion record`); continue; }
    const candidates = (receipt.candidates ?? []).filter((c) => c.sha256 === promotion.source_candidate_sha256);
    const candidate = candidates[0];
    if (candidates.length !== 1 || !candidate) { problems.push(`${row.id}: promoted candidate hash matches ${candidates.length} candidates`); continue; }
    if (candidate.path !== promotion.source_candidate) problems.push(`${row.id}: promoted candidate path disagrees with its receipt`);
    if (candidate.status === 'REJECTED') problems.push(`${row.id}: promoted candidate ${candidate.revision} is REJECTED`);
    const rulings = referencedRulings(promotion.authority, ledger.human_rulings);
    if (rulings.length === 0) problems.push(`${row.id}: promotion authority "${promotion.authority}" names no recorded ruling`);
    for (const id of rulings) {
      if (!isHuman(ledger.human_rulings.find((r) => r.id === id)?.ruling.authority)) problems.push(`${row.id}: ruling ${id} is not a human decision`);
    }
    if (!isHuman(receipt.approval?.approver ?? undefined)) problems.push(`${row.id}: receipt approval is not a human decision`);
    if (!PROFILE_DIMENSIONS[row.profile]) problems.push(`${row.id}: unknown authored profile ${row.profile}`);
    accept.push({ id: row.id, row, receipt, candidate, rulings });
  }
  return { accept, absent, problems };
}

function parseDimensions(text: string): [number, number] {
  const match = /^(\d+)x(\d+)$/.exec(text.trim());
  if (!match) throw new Error(`unparseable dimensions "${text}"`);
  return [Number(match[1]), Number(match[2])];
}

/** Builds the provenance record for one accepted ID and checks the bytes against every recorded fact. */
export function buildRecord(item: IntakeDecision['accept'][number], canonical: Buffer, candidateBytes: Buffer): { record: SourceRecord; problems: string[] } {
  const { row, receipt, candidate, rulings } = item;
  const promotion = receipt.promotion;
  if (!promotion) throw new Error(`${row.id}: no promotion`);
  const problems: string[] = [];
  if (sha256(canonical) !== promotion.canonical_sha256) problems.push(`${row.id}: canonical bytes do not match receipt canonical_sha256`);
  if (sha256(candidateBytes) !== candidate.sha256) problems.push(`${row.id}: candidate bytes do not match receipt sha256`);
  const facts = pngFacts(canonical);
  if (facts.bitDepth !== 8 || facts.colorType !== 2) problems.push(`${row.id}: expected 8-bit RGB PNG, got depth ${facts.bitDepth} type ${facts.colorType}`);
  const [rw, rh] = parseDimensions(promotion.canonical_dimensions);
  if (facts.width !== rw || facts.height !== rh) problems.push(`${row.id}: file ${facts.width}x${facts.height} != receipt ${promotion.canonical_dimensions}`);
  const profileDimensions = PROFILE_DIMENSIONS[row.profile] ?? [0, 0];
  const [pw, ph] = profileDimensions;
  const aspectError = Math.abs(facts.width / facts.height - pw / ph) / (pw / ph);
  if (aspectError > 0.01) problems.push(`${row.id}: aspect error ${(aspectError * 100).toFixed(2)}% exceeds 1%`);
  const exact = facts.width === pw && facts.height === ph;
  if (!exact && !promotion.deviation) problems.push(`${row.id}: ${facts.width}x${facts.height} differs from ${row.profile} without a disclosed deviation`);
  const record: SourceRecord = {
    id: row.id,
    status: 'APPROVED_SOURCE',
    batch: row.batch,
    path: row.path,
    sha256: sha256(canonical),
    bytes: canonical.length,
    width: facts.width,
    height: facts.height,
    profile: row.profile,
    profileDimensions: [pw, ph],
    ...(exact ? {} : { dimensionWaiver: rulings[rulings.length - 1] ?? 'NONE', deviation: promotion.deviation ?? '' }),
    normalization: { operation: promotion.operation, tool: promotion.normalization_tool ?? 'none recorded' },
    candidate: {
      branch: ARENA_BRANCH,
      commit: ARENA_COMMIT,
      path: candidate.path,
      revision: candidate.revision,
      sha256: candidate.sha256,
      nativeDimensions: candidate.native_dimensions ?? 'UNKNOWN',
      ledgerStatus: candidate.status,
    },
    generator: `${candidate.generation_tool ?? 'UNKNOWN'} (model ${candidate.model ?? 'UNKNOWN'}, per Arena receipt)`,
    approval: {
      approver: receipt.approval?.approver ?? '',
      date: promotion.date,
      decision: `CANONICAL_SOURCE_PRESENT under ${promotion.authority}`,
      rulings,
    },
    rights: RIGHTS,
  };
  return { record, problems };
}

/** The earlier Claude-session ruling. Kept as history; the Arena ledger's later owner rulings supersede it. */
export const HISTORICAL_RULINGS = [
  {
    id: 'HR-2026-09-23-01',
    date: '2026-09-23',
    approver: 'human (repository owner)',
    channel: 'Claude Code session_013yLbaqKAEB35rbG7aTdFjV, direct message',
    statement:
      'I approve of the life stages sheet as well as I accept the um we can do the ten twenty-four sheets and um regarding the art style we\'re gonna do what it makes and we\'ll adjust from that. Um I am approving the identity option.',
    status: 'SUPERSEDED',
    supersededBy: [
      'B00_BLOCK_FINAL (2026-09-24): CG-S-ART-DIRECTION stays absent; the earlier intake of r001 is withdrawn.',
      'CANONICAL_PROMOTION_NORMALIZE_WITHIN_BOUNDS (2026-09-24) and AS_IS_PROMOTION_HELD_LANDSCAPE_NINE (2026-09-24): canonical B01 bytes are the Arena-promoted files, not the native candidates this ruling accepted.',
      'LIFE-Q: the Arena ledger records r002 as REJECTED; r005 is the canonical source. The r002 3x3 panel map is withdrawn.',
    ],
    historicalIntake: 'Arena commit 6f07fd47264e8783332ea0b1e6cc315fcf839a71: ART-DIRECTION r001, TORSO-Q r003, LOCO-PILLAR r002, FEED-BROWSE r001, SENSE-EYE-RING r002, TAIL-BALANCE r002, FORM-Q r004, LIFE-Q r002 (native bytes).',
  },
] as const;

/**
 * Owner decisions given to the implementation session after the Arena pin (2026-09-25). They are
 * recorded verbatim; the Arena ledger at ARENA_COMMIT predates them, so they are not yet reflected
 * in its receipts. They change no bytes here: the Arena workflow owns any replacement source.
 */
export const OWNER_RULINGS = [
  {
    id: 'OR-2026-09-25-01',
    topic: 'B00 / M03 prerequisite',
    ruling: 'Reopen B00: lift B00_BLOCK_FINAL and require a new compliant art-direction board before M03 can be accepted.',
    effect: 'CG-S-ART-DIRECTION stays absent until Arena delivers a compliant board; M03 cannot be accepted before it is approved.',
  },
  {
    id: 'OR-2026-09-25-02',
    topic: 'Q anatomy - LIFE-Q vs FORM-Q',
    ruling: 'FORM-Q r004 is anatomically authoritative. Q does not have the LIFE-Q shell; LIFE-Q r005 is continuity drift and must be corrected/replaced to match FORM-Q.',
    effect: 'CG-S-GOD-LIFE-Q r005 remains the Arena canonical file but no longer scores or shapes FORM-Q; a corrected LIFE-Q is required from Arena.',
  },
  {
    id: 'OR-2026-09-25-03',
    topic: 'FORM-Q top view authority',
    ruling: 'The FORM-Q top view is binding. Reshape the 3D body until it satisfies the top-view reference while preserving the already-passing front/rear identity.',
    effect: 'Executed as the single bounded M03 repair pass (revision c003).',
  },
  {
    id: 'OR-2026-09-25-04',
    topic: 'Six M03 c002 models / human art gate',
    ruling: 'The model direction is visually acceptable in principle, but final c002 approval remains conditional on seeing the actual c002 outputs.',
    effect: 'No model is INTEGRATED_VERIFIED; human art approval remains pending.',
  },
  {
    id: 'OR-2026-09-25-05',
    topic: 'Git / checkpoint sequencing',
    ruling: 'Keep the working tree uncommitted until my decisions above are applied; then commit and push the resolved M03 state in one bounded change.',
    effect: 'One commit and push after the rulings are applied.',
  },
] as const;

export interface ProvenanceDocument {
  readonly schemaVersion: number;
  readonly contract: string;
  readonly note: string;
  readonly arenaIntake?: unknown;
  readonly humanRulings?: readonly { readonly id: string }[];
  readonly ownerRulings?: unknown;
  readonly historicalRulings?: unknown;
  readonly records: readonly { readonly id: string; readonly status: string }[];
}

function gitShow(root: string, path: string): Buffer {
  try {
    return execFileSync('git', ['show', `${ARENA_COMMIT}:${path}`], { cwd: root, maxBuffer: 1 << 27, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    throw new Error(`cannot read ${ARENA_COMMIT.slice(0, 7)}:${path} (git fetch origin ${ARENA_BRANCH}?): ${(error as Error).message.split('\n')[0] ?? ''}`, { cause: error });
  }
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(entry.parentPath, entry.name));
}

export interface IntakePlan {
  readonly ledgerSha256: string;
  readonly sources: readonly ExpectedSource[];
  readonly absent: readonly AbsentRecord[];
  readonly rulings: readonly ArenaRuling[];
  readonly problems: readonly string[];
}

export function planIntake(root: string): IntakePlan {
  const ledgerBytes = gitShow(root, RECEIPTS_PATH);
  const ledgerSha256 = sha256(ledgerBytes);
  const problems: string[] = [];
  if (ledgerSha256 !== RECEIPTS_SHA256) problems.push(`${RECEIPTS_PATH} at ${ARENA_COMMIT.slice(0, 7)} hashes ${ledgerSha256}, pinned ${RECEIPTS_SHA256}`);
  const ledger = JSON.parse(ledgerBytes.toString('utf8')) as ArenaLedger;
  const spec = (JSON.parse(readFileSync(resolve(root, SPECIFICATION_PATH), 'utf8')) as { assets: SpecRow[] }).assets;
  const decision = decideIntake(ledger, spec);
  problems.push(...decision.problems);
  const sources: ExpectedSource[] = [];
  for (const item of decision.accept) {
    const bytes = gitShow(root, item.row.path);
    const built = buildRecord(item, bytes, gitShow(root, item.candidate.path));
    problems.push(...built.problems);
    sources.push({ record: built.record, bytes });
  }
  const used = new Set(sources.flatMap((s) => s.record.approval.rulings));
  for (const s of sources) if (s.record.dimensionWaiver) used.add(s.record.dimensionWaiver);
  const rulings = ledger.human_rulings.filter((r) => used.has(r.id) || r.id === 'B00_BLOCK_FINAL' || r.id === 'CLOSURE_FRESH_PASS_LIFE_S_AUTHORIZED');
  return { ledgerSha256, sources, absent: decision.absent, rulings, problems };
}

function main(): void {
  const root = resolve(import.meta.dirname, '../..');
  const checkOnly = process.argv.includes('--check');
  const plan = planIntake(root);
  const problems = [...plan.problems];
  if (problems.length > 0) {
    console.error(`intake FAILED before touching files:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }

  // Canonical files: exactly the accepted set, byte-identical to the pinned Arena blobs.
  const expected = new Map(plan.sources.map((s) => [s.record.path, s.bytes]));
  for (const [path, bytes] of expected) {
    const target = resolve(root, path);
    const current = existsSync(target) ? readFileSync(target) : null;
    if (current?.equals(bytes)) continue;
    if (checkOnly) { problems.push(`${path}: ${current ? 'bytes differ from' : 'absent at'} Arena ${ARENA_COMMIT.slice(0, 7)}`); continue; }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
  for (const file of listFiles(resolve(root, SOURCE_ROOT))) {
    const path = relative(root, file);
    if (expected.has(path)) continue;
    if (checkOnly) { problems.push(`${path}: not a canonical Arena source at ${ARENA_COMMIT.slice(0, 7)}`); continue; }
    rmSync(file);
    console.log(`removed ${path} (not canonical in the Arena ledger)`);
  }

  const provenancePath = resolve(root, PROVENANCE_PATH);
  const provenance = JSON.parse(readFileSync(provenancePath, 'utf8')) as ProvenanceDocument;
  const authoredIds = new Set([...plan.sources.map((s) => s.record.id), ...plan.absent.map((a) => a.id)]);
  const next: ProvenanceDocument = {
    schemaVersion: provenance.schemaVersion,
    contract: provenance.contract,
    note: provenance.note,
    arenaIntake: {
      branch: ARENA_BRANCH,
      commit: ARENA_COMMIT,
      receipts: RECEIPTS_PATH,
      receiptsSha256: plan.ledgerSha256,
      tool: 'tools/assets/intake.ts',
      approvedSources: plan.sources.length,
      absent: plan.absent.map((a) => `${a.id} ${a.status}`),
    },
    humanRulings: plan.rulings.map((r) => ({ id: r.id, date: r.ruling.date ?? '', authority: r.ruling.authority ?? '', decision: r.ruling.decision ?? '', source: `${ARENA_COMMIT}:${RECEIPTS_PATH}` })),
    ownerRulings: OWNER_RULINGS,
    historicalRulings: HISTORICAL_RULINGS,
    records: [
      ...provenance.records.filter((record) => !authoredIds.has(record.id) && !record.id.startsWith('CG-S-') && !record.id.startsWith('CG-A-')),
      ...plan.sources.map((s) => s.record),
      ...plan.absent,
    ].sort((a, b) => a.id.localeCompare(b.id)),
  };
  const text = `${JSON.stringify(next, null, 2)}\n`;
  if (readFileSync(provenancePath, 'utf8') !== text) {
    if (checkOnly) problems.push(`${PROVENANCE_PATH} differs from the Arena reconciliation`);
    else writeFileSync(provenancePath, text);
  }

  // Manifest: every accepted source is a verified file fact; nothing else authored is listed.
  const manifestPath = resolve(root, MANIFEST_PATH);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { verifiedFiles: { id: string; path: string; sha256: string; bytes: number }[] };
  const nextManifest = {
    ...manifest,
    verifiedFiles: [
      ...manifest.verifiedFiles.filter((file) => !file.id.startsWith('CG-S-') && !file.id.startsWith('CG-A-')),
      ...plan.sources.map(({ record }) => ({ id: record.id, path: record.path, sha256: record.sha256, bytes: record.bytes })),
    ].sort((a, b) => a.id.localeCompare(b.id)),
  };
  const manifestText = `${JSON.stringify(nextManifest, null, 2)}\n`;
  if (readFileSync(manifestPath, 'utf8') !== manifestText) {
    if (checkOnly) problems.push(`${MANIFEST_PATH} source entries differ from the Arena reconciliation`);
    else writeFileSync(manifestPath, manifestText);
  }

  if (problems.length > 0) {
    console.error(`intake check FAILED:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  const absent = plan.absent.map((a) => `${a.id} ${a.status}`).join(', ');
  console.log(`intake ${checkOnly ? 'check ' : ''}OK: Arena ${ARENA_COMMIT.slice(0, 7)}, ${plan.sources.length} canonical sources verified; absent: ${absent || 'none'}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main();
