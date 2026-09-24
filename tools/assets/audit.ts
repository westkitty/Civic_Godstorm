// Physical asset audit shared by `test:assets` and `validate:release` (master Sections 18.2, 20.1).
// Reference completion, model/derivation completion and recipe integration are counted separately.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CheckResult, ParsedContract } from '../spec/contract.ts';
import { buildOutputs, loadContract, loadEvidence, MANIFEST_PATH, PROVENANCE_PATH } from '../spec/outputs.ts';
import { pngFacts } from './intake.ts';

export interface VerifiedFileRecord {
  readonly id: string;
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface ManifestFile {
  readonly verifiedFiles: readonly VerifiedFileRecord[];
  readonly registeredRecipes: readonly string[];
}

export interface ProvenanceRecord {
  readonly id: string;
  readonly status: string;
  readonly path?: string;
  readonly sha256?: string;
  readonly nativeWidth?: number;
  readonly nativeHeight?: number;
  readonly profileDimensions?: readonly [number, number];
  readonly dimensionWaiver?: string;
  readonly approval?: { readonly approver?: string; readonly ruling?: string };
}

export interface ProvenanceFile {
  readonly humanRulings?: readonly { readonly id: string }[];
  readonly records: readonly ProvenanceRecord[];
}

export interface AuditReport {
  readonly contract: ParsedContract;
  readonly checks: CheckResult[];
  readonly counts: {
    readonly authoredApproved: number;
    readonly authoredTotal: number;
    readonly derivedVerified: number;
    readonly derivedTotal: number;
    readonly recipesRegistered: number;
    readonly recipesTotal: number;
  };
  readonly unresolved: readonly string[];
  readonly recipeFilesPresentUnverified: readonly string[];
}

/** Problems with one APPROVED_SOURCE record against its specified row and the file bytes (empty = verified). */
export function approvedSourceProblems(
  record: ProvenanceRecord,
  row: { readonly assetClass: string; readonly path: string } | undefined,
  bytes: Buffer | null,
  rulingIds: ReadonlySet<string>,
): string[] {
  if (!row || (row.assetClass !== 'ARENA SOURCE ASSET' && row.assetClass !== 'DIRECT ARENA ASSET')) return [`${record.id}: not an authored source`];
  if (record.path !== row.path) return [`${record.id}: path ${record.path ?? '?'} != ${row.path}`];
  const problems: string[] = [];
  if (!record.approval?.approver?.startsWith('human')) problems.push(`${record.id}: approval is not a human decision`);
  if (!bytes) return [...problems, `${record.id}: file absent`];
  if (createHash('sha256').update(bytes).digest('hex') !== record.sha256) problems.push(`${record.id}: sha256 mismatch`);
  let facts: { width: number; height: number };
  try { facts = pngFacts(bytes); } catch (error) { return [...problems, `${record.id}: ${(error as Error).message}`]; }
  if (facts.width !== record.nativeWidth || facts.height !== record.nativeHeight) problems.push(`${record.id}: recorded dimensions differ from file`);
  const [pw, ph] = record.profileDimensions ?? [0, 0];
  const exact = facts.width === pw && facts.height === ph;
  if (!exact && !(record.dimensionWaiver !== undefined && rulingIds.has(record.dimensionWaiver))) {
    problems.push(`${record.id}: ${facts.width}x${facts.height} is not the ${pw}x${ph} profile and has no recorded human waiver`);
  }
  return problems;
}

function readJson<T>(root: string, path: string): T {
  return JSON.parse(readFileSync(resolve(root, path), 'utf8')) as T;
}

export function auditAssets(root: string): AuditReport {
  const { contract, results } = loadContract(root);
  const checks: CheckResult[] = [...results];
  const check = (name: string, ok: boolean, detail: string): void => {
    checks.push({ name, ok, detail });
  };
  const byId = new Map(contract.assets.map((row) => [row.id, row]));

  const stale = buildOutputs(contract, loadEvidence(root)).generated.filter((file) => {
    const target = resolve(root, file.path);
    return !existsSync(target) || readFileSync(target, 'utf8') !== file.content;
  });
  check('registries.current', stale.length === 0,
    stale.length ? `stale: ${stale.map((file) => file.path).join(', ')} (run npm run spec:compile)` : 'generated registries match master');

  const manifest = readJson<ManifestFile>(root, MANIFEST_PATH);
  const provenance = readJson<ProvenanceFile>(root, PROVENANCE_PATH);
  check('manifest.shape', Array.isArray(manifest.verifiedFiles) && Array.isArray(manifest.registeredRecipes), MANIFEST_PATH);
  check('provenance.shape', Array.isArray(provenance.records), PROVENANCE_PATH);

  const manifestProblems: string[] = [];
  for (const file of manifest.verifiedFiles) {
    const row = byId.get(file.id);
    if (!row) { manifestProblems.push(`${file.id}: not specified`); continue; }
    if (row.assetClass === 'PROCEDURAL RUNTIME ASSET') manifestProblems.push(`${file.id}: recipes belong in registeredRecipes`);
    if (file.path !== row.path) manifestProblems.push(`${file.id}: path ${file.path} != specified ${row.path}`);
    const target = resolve(root, file.path);
    if (!existsSync(target)) { manifestProblems.push(`${file.id}: file absent`); continue; }
    const bytes = readFileSync(target);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== file.sha256) manifestProblems.push(`${file.id}: sha256 mismatch`);
    if (bytes.length !== file.bytes) manifestProblems.push(`${file.id}: byte size mismatch`);
  }
  for (const id of manifest.registeredRecipes) {
    if (byId.get(id)?.assetClass !== 'PROCEDURAL RUNTIME ASSET') manifestProblems.push(`${id}: not a specified recipe`);
  }
  check('manifest.verified', manifestProblems.length === 0, manifestProblems.join('; ') || `${manifest.verifiedFiles.length} verified files`);

  const provenanceIds = new Set(provenance.records.map((record) => record.id));
  const unknownProvenance = [...provenanceIds].filter((id) => !byId.has(id));
  check('provenance.ids', unknownProvenance.length === 0, unknownProvenance.join(', ') || `${provenanceIds.size} IDs with records`);

  // A file at a canonical path with no provenance/manifest record is an unregistered occupant.
  const verifiedIds = new Set(manifest.verifiedFiles.map((file) => file.id));
  const unregistered = contract.assets
    .filter((row) => row.assetClass !== 'PROCEDURAL RUNTIME ASSET')
    .filter((row) => existsSync(resolve(root, row.path)))
    .filter((row) => !verifiedIds.has(row.id) && !provenanceIds.has(row.id))
    .map((row) => row.path);
  check('canonicalPaths.registered', unregistered.length === 0, unregistered.join(', ') || 'no unregistered files at canonical paths');

  // Section 17.2/18.2: an approved source is a human-approved file at its canonical path whose
  // hash and native dimensions match the record. Dimensions differ from the profile only under a
  // recorded human ruling.
  const rulingIds = new Set((provenance.humanRulings ?? []).map((ruling) => ruling.id));
  const sourceProblems: string[] = [];
  const approvedRecords = provenance.records.filter((record) => record.status === 'APPROVED_SOURCE');
  for (const record of approvedRecords) {
    const row = byId.get(record.id);
    const target = row ? resolve(root, row.path) : null;
    const bytes = target && existsSync(target) ? readFileSync(target) : null;
    sourceProblems.push(...approvedSourceProblems(record, row, bytes, rulingIds));
  }
  const approvedIds = new Set(approvedRecords.map((record) => record.id));
  for (const file of manifest.verifiedFiles) {
    const row = byId.get(file.id);
    const authoredFile = row?.assetClass === 'ARENA SOURCE ASSET' || row?.assetClass === 'DIRECT ARENA ASSET';
    if (authoredFile && !approvedIds.has(file.id)) sourceProblems.push(`${file.id}: in manifest without an APPROVED_SOURCE record`);
  }
  check('provenance.approvedSources', sourceProblems.length === 0,
    sourceProblems.join('; ') || `${approvedRecords.length} approved sources verified (hash, path, native dimensions, waiver)`);

  // Derived candidates (Section 18.2 DERIVED_UNVERIFIED): the recorded file must be the specified
  // path with the recorded hash, and every authored source it depends on must be approved.
  const derivedProblems: string[] = [];
  const derivedRecords = provenance.records.filter((record) => record.status === 'DERIVED_UNVERIFIED' || record.status === 'INTEGRATED_VERIFIED');
  for (const record of derivedRecords) {
    const row = byId.get(record.id);
    if (!row || row.assetClass !== 'DERIVED ASSET') { derivedProblems.push(`${record.id}: not a derived asset`); continue; }
    if (record.path !== row.path) { derivedProblems.push(`${record.id}: path ${record.path ?? '?'} != ${row.path}`); continue; }
    const target = resolve(root, row.path);
    if (!existsSync(target)) { derivedProblems.push(`${record.id}: file absent`); continue; }
    if (createHash('sha256').update(readFileSync(target)).digest('hex') !== record.sha256) derivedProblems.push(`${record.id}: sha256 mismatch (rerun the model pipeline)`);
    for (const dep of row.dependencies) {
      const depRow = byId.get(dep);
      if (depRow && (depRow.assetClass === 'ARENA SOURCE ASSET' || depRow.assetClass === 'DIRECT ARENA ASSET') && !approvedIds.has(dep)) {
        derivedProblems.push(`${record.id}: depends on unapproved source ${dep}`);
      }
    }
  }
  check('provenance.derivedCandidates', derivedProblems.length === 0,
    derivedProblems.join('; ') || `${derivedRecords.length} derived records match their files and approved sources`);

  const approved = approvedIds;
  const authored = contract.assets.filter((row) => row.assetClass === 'ARENA SOURCE ASSET' || row.assetClass === 'DIRECT ARENA ASSET');
  const derived = contract.assets.filter((row) => row.assetClass === 'DERIVED ASSET');
  const recipes = contract.assets.filter((row) => row.assetClass === 'PROCEDURAL RUNTIME ASSET');
  const registered = new Set(manifest.registeredRecipes);

  return {
    contract,
    checks,
    counts: {
      authoredApproved: authored.filter((row) => approved.has(row.id)).length,
      authoredTotal: authored.length,
      derivedVerified: derived.filter((row) => verifiedIds.has(row.id)).length,
      derivedTotal: derived.length,
      recipesRegistered: recipes.filter((row) => registered.has(row.id)).length,
      recipesTotal: recipes.length,
    },
    unresolved: contract.assets
      .filter((row) => !(verifiedIds.has(row.id) || registered.has(row.id)))
      .map((row) => row.id),
    recipeFilesPresentUnverified: recipes
      .filter((row) => !registered.has(row.id) && existsSync(resolve(root, row.path)))
      .map((row) => row.id),
  };
}

export function printAudit(report: AuditReport): boolean {
  let ok = true;
  for (const result of report.checks) {
    if (!result.ok) ok = false;
    console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}  ${result.detail}`);
  }
  const { counts } = report;
  console.log('\nCompletion (counted separately, Section 20.1):');
  console.log(`  authored sources approved   ${counts.authoredApproved}/${counts.authoredTotal}`);
  console.log(`  derived assets verified     ${counts.derivedVerified}/${counts.derivedTotal}`);
  console.log(`  recipes registered verified ${counts.recipesRegistered}/${counts.recipesTotal}`);
  if (report.recipeFilesPresentUnverified.length > 0) {
    console.log(`  recipe code present, not yet verified: ${report.recipeFilesPresentUnverified.join(', ')}`);
  }
  console.log(`  unresolved IDs              ${report.unresolved.length}`);
  return ok;
}
