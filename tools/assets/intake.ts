// Source intake (master Sections 17.2, 18.2, 18.4).
//   node tools/assets/intake.ts            -> copy approved Arena candidates to canonical paths, write provenance
//   node tools/assets/intake.ts --check    -> fail if canonical files or provenance records differ from this plan
//
// Candidates are read byte-for-byte from a pinned Arena commit with `git show`. Nothing is resampled:
// the human resolution ruling below accepts native sheets, so the canonical file is the candidate.
// The intake plan is data. Adding an ID requires a recorded human decision.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { MANIFEST_PATH, PROVENANCE_PATH } from '../spec/outputs.ts';

export const ARENA_BRANCH = 'arena/01a0d03e-civic-godstorm';
export const ARENA_COMMIT = '6f07fd47264e8783332ea0b1e6cc315fcf839a71';

export interface HumanRuling {
  readonly id: string;
  readonly date: string;
  readonly approver: string;
  readonly channel: string;
  readonly statement: string;
  readonly interpretation: readonly string[];
}

/** Rulings given by the repository owner. The statement is kept as given (a dictated message). */
export const RULINGS: readonly HumanRuling[] = [
  {
    id: 'HR-2026-09-23-01',
    date: '2026-09-23',
    approver: 'human (repository owner)',
    channel: 'Claude Code session_013yLbaqKAEB35rbG7aTdFjV, direct message',
    statement:
      'I approve of the life stages sheet as well as I accept the um we can do the ten twenty-four sheets and um regarding the art style we\'re gonna do what it makes and we\'ll adjust from that. Um I am approving the identity option.',
    interpretation: [
      'RESOLUTION: native Arena sheets (1024x1024 REF-GOD/REF-FORM, 1264x848 REF-LIFE/REF-DIRECTION) are accepted as canonical sources without resampling. This waives the Section 17.2 exact-dimension and normalization-floor rules for the IDs recorded here only. Profile dimensions in the master are not edited.',
      'B00 STYLE: CG-S-ART-DIRECTION is accepted as the tool produced it ("do what it makes and adjust from that"). r001 is taken because it is 3:2 (0.63% aspect error). r002 is 16:9 (19.44% aspect error) and would violate the unwaived aspect rule.',
      'B01 IDENTITY: the first-God identity gate is approved. The provisionally accepted Q sheets are promoted: TORSO-Q r003, LOCO-PILLAR r002, FEED-BROWSE r001, SENSE-EYE-RING r002, TAIL-BALANCE r002, FORM-Q r004.',
      'B01 LIFE: CG-S-GOD-LIFE-Q is approved as an existing sheet. r002 is taken because its ancient panel is the restrained repair of the r001 over-accented cracks. Its 3x3 layout is used through a declared six-panel map. The duplicate panels and the empty cell are excluded, not cropped out of the file. The Arena QA note on open-eye artifacts stands. Runtime eyes follow the closed-lid SENSE-EYE-RING source.',
    ],
  },
];

export interface PanelRect {
  readonly state: string;
  readonly row: number;
  readonly col: number;
}

export interface IntakeItem {
  readonly id: string;
  readonly revision: string;
  readonly candidatePath: string;
  readonly canonicalPath: string;
  readonly profile: string;
  readonly profileDimensions: readonly [number, number];
  readonly ruling: string;
  readonly panelGrid?: { readonly rows: number; readonly cols: number; readonly panels: readonly PanelRect[]; readonly excluded: readonly string[] };
}

const god = (id: string, revision: string, profile = 'REF-GOD'): IntakeItem => {
  const slug = id.toLowerCase().replaceAll('-', '_');
  return {
    id,
    revision,
    candidatePath: `assets/candidates/${id}/${revision}/${slug}.png`,
    canonicalPath: `assets/source/god/${slug}.png`,
    profile,
    profileDimensions: [2048, 2048],
    ruling: 'HR-2026-09-23-01',
  };
};

export const INTAKE: readonly IntakeItem[] = [
  {
    id: 'CG-S-ART-DIRECTION',
    revision: 'r001',
    candidatePath: 'assets/candidates/CG-S-ART-DIRECTION/r001/cg_s_art_direction.png',
    canonicalPath: 'assets/source/art/cg_s_art_direction.png',
    profile: 'REF-DIRECTION',
    profileDimensions: [3072, 2048],
    ruling: 'HR-2026-09-23-01',
  },
  god('CG-S-GOD-TORSO-Q', 'r003'),
  god('CG-S-GOD-LOCO-PILLAR', 'r002'),
  god('CG-S-GOD-FEED-BROWSE', 'r001'),
  god('CG-S-GOD-SENSE-EYE-RING', 'r002'),
  god('CG-S-GOD-TAIL-BALANCE', 'r002'),
  god('CG-S-GOD-FORM-Q', 'r004', 'REF-FORM'),
  {
    ...god('CG-S-GOD-LIFE-Q', 'r002', 'REF-LIFE'),
    profileDimensions: [3072, 2048],
    panelGrid: {
      rows: 3,
      cols: 3,
      panels: [
        { state: 'juvenile', row: 0, col: 0 },
        { state: 'prime', row: 0, col: 1 },
        { state: 'ancient', row: 0, col: 2 },
        { state: 'injured-prime', row: 1, col: 0 },
        { state: 'recent-corpse', row: 1, col: 1 },
        { state: 'ossuary', row: 2, col: 2 },
      ],
      excluded: ['row1col2 empty', 'row2col0 duplicate injured-prime', 'row2col1 duplicate recent-corpse (mirrored)'],
    },
  },
];

export interface SourceRecord {
  readonly id: string;
  readonly status: 'APPROVED_SOURCE';
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly nativeWidth: number;
  readonly nativeHeight: number;
  readonly profile: string;
  readonly profileDimensions: readonly [number, number];
  readonly normalization: 'none';
  readonly dimensionWaiver: string;
  readonly candidate: { readonly branch: string; readonly commit: string; readonly path: string; readonly revision: string };
  readonly generator: string;
  readonly approval: { readonly decision: string; readonly approver: string; readonly date: string; readonly ruling: string };
  readonly rights: string;
  readonly panelGrid?: IntakeItem['panelGrid'];
}

/** Reads width/height from a PNG IHDR chunk and rejects anything that is not a single 8-bit RGB PNG. */
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

function readCandidate(root: string, item: IntakeItem): Buffer {
  return execFileSync('git', ['show', `${ARENA_COMMIT}:${item.candidatePath}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
}

export function buildRecord(item: IntakeItem, bytes: Buffer): SourceRecord {
  const facts = pngFacts(bytes);
  if (facts.bitDepth !== 8 || facts.colorType !== 2) throw new Error(`${item.id}: expected 8-bit RGB PNG, got depth ${facts.bitDepth} type ${facts.colorType}`);
  const [pw, ph] = item.profileDimensions;
  const aspectError = Math.abs(facts.width / facts.height - pw / ph) / (pw / ph);
  if (aspectError > 0.01) throw new Error(`${item.id}: aspect error ${(aspectError * 100).toFixed(2)}% exceeds 1%`);
  return {
    id: item.id,
    status: 'APPROVED_SOURCE',
    path: item.canonicalPath,
    sha256: sha256(bytes),
    bytes: bytes.length,
    nativeWidth: facts.width,
    nativeHeight: facts.height,
    profile: item.profile,
    profileDimensions: item.profileDimensions,
    normalization: 'none',
    dimensionWaiver: item.ruling,
    candidate: { branch: ARENA_BRANCH, commit: ARENA_COMMIT, path: item.candidatePath, revision: item.revision },
    generator: 'Arena Agent Mode generate_image (model UNKNOWN, per Arena receipt)',
    approval: { decision: 'APPROVED_SOURCE', approver: 'human (repository owner)', date: '2026-09-23', ruling: item.ruling },
    rights: 'Arena-generated for this project; commercial clearance not established (master Section 17.2, audited at M14).',
    ...(item.panelGrid ? { panelGrid: item.panelGrid } : {}),
  };
}

export interface ProvenanceDocument {
  readonly schemaVersion: number;
  readonly contract: string;
  readonly note: string;
  readonly humanRulings?: readonly HumanRuling[];
  readonly records: readonly { readonly id: string; readonly status: string }[];
}

function main(): void {
  const root = resolve(import.meta.dirname, '../..');
  const checkOnly = process.argv.includes('--check');
  const problems: string[] = [];
  const records: SourceRecord[] = [];
  for (const item of INTAKE) {
    const bytes = readCandidate(root, item);
    const record = buildRecord(item, bytes);
    records.push(record);
    const target = resolve(root, item.canonicalPath);
    const current = existsSync(target) ? readFileSync(target) : null;
    if (current && current.equals(bytes)) continue;
    if (checkOnly) { problems.push(`${item.canonicalPath} absent or different`); continue; }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    console.log(`copied ${item.id} ${item.revision} -> ${item.canonicalPath} (${record.nativeWidth}x${record.nativeHeight}, ${record.sha256.slice(0, 12)})`);
  }

  const provenancePath = resolve(root, PROVENANCE_PATH);
  const provenance = JSON.parse(readFileSync(provenancePath, 'utf8')) as ProvenanceDocument;
  const intakeIds = new Set(INTAKE.map((item) => item.id));
  const next: ProvenanceDocument = {
    ...provenance,
    humanRulings: RULINGS,
    records: [...provenance.records.filter((record) => !intakeIds.has(record.id)), ...records].sort((a, b) => a.id.localeCompare(b.id)),
  };
  const text = `${JSON.stringify(next, null, 2)}\n`;
  if (readFileSync(provenancePath, 'utf8') !== text) {
    if (checkOnly) problems.push(`${PROVENANCE_PATH} differs from the intake plan`);
    else { writeFileSync(provenancePath, text); console.log(`wrote ${PROVENANCE_PATH} (${records.length} source records)`); }
  }
  // Approved, hash-verified sources resolve their ID in the manifest (the audit re-verifies both).
  const manifestPath = resolve(root, MANIFEST_PATH);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { verifiedFiles: { id: string; path: string; sha256: string; bytes: number }[] };
  const nextManifest = {
    ...manifest,
    verifiedFiles: [
      ...manifest.verifiedFiles.filter((file) => !intakeIds.has(file.id)),
      ...records.map((record) => ({ id: record.id, path: record.path, sha256: record.sha256, bytes: record.bytes })),
    ].sort((a, b) => a.id.localeCompare(b.id)),
  };
  const manifestText = `${JSON.stringify(nextManifest, null, 2)}\n`;
  if (readFileSync(manifestPath, 'utf8') !== manifestText) {
    if (checkOnly) problems.push(`${MANIFEST_PATH} source entries differ from the intake plan`);
    else { writeFileSync(manifestPath, manifestText); console.log(`wrote ${MANIFEST_PATH}`); }
  }
  if (problems.length > 0) {
    console.error(`intake check FAILED:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`intake ${checkOnly ? 'check ' : ''}OK: ${records.length} approved sources`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main();
