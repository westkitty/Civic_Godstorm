// Parses the canonical Section 17 asset contract out of the master plan and checks it against the
// frozen expectations. Pure functions over text: no filesystem access, so fixtures can exercise
// every failure path.

import { createHash } from 'node:crypto';
import {
  ATLAS_CELLS,
  AUTHORED_TOTAL,
  BATCH_COUNT,
  CLASS_COUNTS,
  CLASS_PREFIX,
  CONSUMER_REGISTER_SIZE,
  EXTRA_CONSUMERS,
  GODFORM_RECIPES,
  PROFILE_RULES,
  SIGNATURES,
  SOURCE_DIRECTORY_COUNTS,
  SYSTEM_MATRIX_ROWS,
  TOTAL_IDS,
  type AssetClass,
} from './expected.ts';

export interface AssetRow {
  readonly id: string;
  readonly path: string;
  readonly profile: string;
  readonly assetClass: AssetClass;
  readonly purpose: string;
  readonly dimensions: string;
  readonly consumers: readonly string[];
  readonly variants: string;
  readonly dependencies: readonly string[];
  readonly declaredIn: string;
}

export interface Batch {
  readonly id: string;
  readonly purpose: string;
  readonly count: number;
  readonly assetIds: readonly string[];
  readonly gate: string;
}

export interface ParsedContract {
  readonly section17Sha256: string;
  readonly milestoneBlockSha256: string;
  readonly section17Text: string;
  readonly milestoneBlockText: string;
  readonly assets: readonly AssetRow[];
  readonly profiles: readonly string[];
  readonly systemMatrix: readonly string[];
  readonly consumerRegister: readonly string[];
  readonly traceability: ReadonlyMap<string, readonly string[]>;
  readonly batches: readonly Batch[];
  readonly godformRecipes: readonly string[];
  readonly godformModuleMap: ReadonlyMap<string, readonly string[]>;
}

export interface CheckResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export class ContractParseError extends Error {
  override readonly name = 'ContractParseError';
}

const SECTION17_START = '## 17. Canonical asset production contract';
const CONTRACT_END = '<!-- CG_ASSET_CONTRACT_END -->';
const MILESTONE_START = '## 19. Implementation milestones and acceptance gates';
const ID_PATTERN = /CG-[SADR]-[A-Z0-9]+(?:-[A-Z0-9]+)*/g;

export const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

function requireIndex(text: string, needle: string, from = 0): number {
  const index = text.indexOf(needle, from);
  if (index < 0) throw new ContractParseError(`Missing required marker: ${needle}`);
  return index;
}

/** Section 17 as signed: heading through the end marker and its trailing newline. */
export function extractSection17(master: string): string {
  const start = requireIndex(master, SECTION17_START);
  const end = requireIndex(master, CONTRACT_END, start) + CONTRACT_END.length;
  return `${master.slice(start, end)}\n`;
}

/** Milestone block as signed: Section 19 through 19.1, trimmed, with one trailing newline. */
export function extractMilestoneBlock(document: string): string {
  const start = requireIndex(document, MILESTONE_START);
  const candidates = ['\n## 20.', '\n## 7. Repository safety']
    .map((marker) => document.indexOf(marker, start))
    .filter((index) => index > start);
  const end = candidates.length > 0 ? Math.min(...candidates) : document.length;
  return `${document.slice(start, end).trim()}\n`;
}

function sliceBetween(text: string, startMarker: string, endMarker: string): string {
  const start = requireIndex(text, startMarker);
  const end = requireIndex(text, endMarker, start + startMarker.length);
  return text.slice(start, end);
}

function tableCells(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return [];
  return trimmed
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());
}

function splitList(cell: string): string[] {
  return cell
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseAssetRows(section17: string): AssetRow[] {
  const rows: AssetRow[] = [];
  let heading = '';
  for (const line of section17.split('\n')) {
    if (line.startsWith('### ')) heading = line.slice(4).trim();
    if (!line.startsWith('| `CG-')) continue;
    const cells = tableCells(line);
    if (cells.length !== 8) {
      throw new ContractParseError(`Asset row has ${cells.length} cells, expected 8: ${line.slice(0, 80)}`);
    }
    const [idCell, pathCell, classCell, purpose, dimensions, consumersCell, variants, depsCell] = cells as [
      string, string, string, string, string, string, string, string,
    ];
    const id = idCell.replaceAll('`', '');
    const path = pathCell.replaceAll('`', '');
    const classMatch = /^(\S+) \/ (.+)$/.exec(classCell);
    if (!classMatch) throw new ContractParseError(`${id}: unparseable profile/class cell "${classCell}"`);
    const assetClass = classMatch[2] as AssetClass;
    if (!(assetClass in CLASS_COUNTS)) throw new ContractParseError(`${id}: unknown class "${assetClass}"`);
    const dependencies = depsCell.startsWith('None:') ? [] : splitList(depsCell);
    rows.push({
      id,
      path,
      profile: classMatch[1] as string,
      assetClass,
      purpose,
      dimensions,
      consumers: splitList(consumersCell),
      variants,
      dependencies,
      declaredIn: heading,
    });
  }
  return rows;
}

function parseProfiles(section17: string): string[] {
  const block = sliceBetween(section17, '### 17.3', '**Derived ancillary outputs');
  return block
    .split('\n')
    .map(tableCells)
    .filter((cells) => cells.length > 1 && /^[A-Z][A-Z-]+$/.test(cells[0] ?? '') && cells[0] !== 'Profile')
    .map((cells) => cells[0] as string);
}

function parseTraceability(section17: string, assetIds: readonly string[]): Map<string, string[]> {
  const block = sliceBetween(section17, '**Consumer-to-asset traceability.**', 'All 121 authored sources');
  const map = new Map<string, string[]>();
  for (const line of block.split('\n')) {
    const cells = tableCells(line);
    const system = cells[0];
    if (!system?.startsWith('SYS-') || cells.length !== 2) continue;
    const text = cells[1] ?? '';
    const ids = [...(text.match(ID_PATTERN) ?? [])];
    if (text.includes('CG-R-AUD-*')) {
      ids.push(...assetIds.filter((id) => id.startsWith('CG-R-AUD-')));
    }
    map.set(system, [...new Set(ids.filter((id) => id !== 'CG-R-AUD'))]);
  }
  return map;
}

function parseSystemMatrix(master: string): string[] {
  const block = sliceBetween(master, '### 6.4 Complete bidirectional system matrix', '### 6.5');
  return block
    .split('\n')
    .map(tableCells)
    .map((cells) => cells[0] ?? '')
    .filter((cell) => /^SYS-[A-Z]+$/.test(cell));
}

function parseBatches(master: string): Batch[] {
  const block = sliceBetween(master, '### 18.6 Exact source batch allocation', '## 19.');
  const batches: Batch[] = [];
  for (const line of block.split('\n')) {
    const cells = tableCells(line);
    if (!/^B\d\d$/.test(cells[0] ?? '')) continue;
    if (cells.length !== 5) throw new ContractParseError(`Batch row malformed: ${line.slice(0, 60)}`);
    batches.push({
      id: cells[0] as string,
      purpose: cells[1] as string,
      count: Number.parseInt(cells[2] as string, 10),
      assetIds: (cells[3] as string).match(ID_PATTERN) ?? [],
      gate: cells[4] as string,
    });
  }
  return batches;
}

function parseGodform(master: string, section17: string): { recipes: string[]; moduleMap: Map<string, string[]> } {
  const table = sliceBetween(master, '## 5. GODFORM', '## 6.');
  const recipes = table
    .split('\n')
    .map(tableCells)
    .map((cells) => cells[0] ?? '')
    .filter((cell) => /^GF-[A-Z]+$/.test(cell));
  const sentence = sliceBetween(section17, 'The Godform recipes map as follows:', 'These suffixes refer');
  const moduleMap = new Map<string, string[]>();
  for (const match of sentence.matchAll(/GF-([A-Z]+) -> ([^;]+)/g)) {
    const modules = (match[2] ?? '').match(/\b(?:LOCO|FEED|SENSE|TAIL|ARMOR|ORGAN|SYMB)-[A-Z*]+(?:-[A-Z]+)*/g) ?? [];
    moduleMap.set(`GF-${match[1] ?? ''}`, modules);
  }
  return { recipes, moduleMap };
}

export function parseContract(master: string): ParsedContract {
  const section17Text = extractSection17(master);
  const milestoneBlockText = extractMilestoneBlock(master);
  const assets = parseAssetRows(section17Text);
  const systemMatrix = parseSystemMatrix(master);
  const consumerRegister = [...systemMatrix, ...EXTRA_CONSUMERS];
  const { recipes, moduleMap } = parseGodform(master, section17Text);
  return {
    section17Sha256: sha256(section17Text),
    milestoneBlockSha256: sha256(milestoneBlockText),
    section17Text,
    milestoneBlockText,
    assets,
    profiles: parseProfiles(section17Text),
    systemMatrix,
    consumerRegister,
    traceability: parseTraceability(section17Text, assets.map((row) => row.id)),
    batches: parseBatches(master),
    godformRecipes: recipes,
    godformModuleMap: moduleMap,
  };
}

function expectedBasename(row: AssetRow): string {
  const rule = PROFILE_RULES[row.profile];
  return `${row.id.toLowerCase().replaceAll('-', '_')}${rule?.extension ?? ''}`;
}

function expectedDirectoryPrefix(row: AssetRow): string {
  switch (row.assetClass) {
    case 'ARENA SOURCE ASSET':
    case 'DIRECT ARENA ASSET':
      return 'assets/source/';
    case 'DERIVED ASSET':
      return row.profile.startsWith('MODEL-') ? 'assets/runtime/models/' : 'assets/runtime/ui/';
    case 'PROCEDURAL RUNTIME ASSET':
      return row.profile === 'AUDIO' ? 'src/audio/recipes/' : 'src/render/recipes/';
  }
}

function findCycle(assets: readonly AssetRow[]): string[] | null {
  const byId = new Map(assets.map((row) => [row.id, row]));
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    const current = state.get(id);
    if (current === 'done') return null;
    if (current === 'visiting') return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, 'visiting');
    stack.push(id);
    for (const dependency of byId.get(id)?.dependencies ?? []) {
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(id, 'done');
    return null;
  };
  for (const row of assets) {
    const cycle = visit(row.id);
    if (cycle) return cycle;
  }
  return null;
}

/** Runs every M00 contract check. Returns all results; callers decide exit status. */
export function checkContract(
  contract: ParsedContract,
  companions: { readonly arenaSection17?: string; readonly buildPromptMilestones?: string } = {},
): CheckResult[] {
  const results: CheckResult[] = [];
  const check = (name: string, ok: boolean, detail: string): void => {
    results.push({ name, ok, detail });
  };
  const { assets } = contract;
  const ids = assets.map((row) => row.id);
  const idSet = new Set(ids);
  const byId = new Map(assets.map((row) => [row.id, row]));

  check('signature.section17', contract.section17Sha256 === SIGNATURES.section17,
    `computed ${contract.section17Sha256}`);
  check('signature.milestones', contract.milestoneBlockSha256 === SIGNATURES.milestoneBlock,
    `computed ${contract.milestoneBlockSha256}`);
  if (companions.arenaSection17 !== undefined) {
    const arena = sha256(companions.arenaSection17);
    check('companion.arena.section17', arena === contract.section17Sha256, `arena copy ${arena}`);
  }
  if (companions.buildPromptMilestones !== undefined) {
    const prompt = sha256(companions.buildPromptMilestones);
    check('companion.buildPrompt.milestones', prompt === contract.milestoneBlockSha256, `build prompt copy ${prompt}`);
  }

  check('ids.total', ids.length === TOTAL_IDS, `${ids.length} rows, expected ${TOTAL_IDS}`);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  check('ids.unique', duplicates.length === 0, duplicates.length ? `duplicates: ${duplicates.join(', ')}` : 'all unique');
  const paths = assets.map((row) => row.path);
  const duplicatePaths = paths.filter((path, index) => paths.indexOf(path) !== index);
  check('paths.unique', duplicatePaths.length === 0, duplicatePaths.join(', ') || 'all unique');

  for (const [assetClass, expected] of Object.entries(CLASS_COUNTS)) {
    const actual = assets.filter((row) => row.assetClass === assetClass).length;
    check(`count.class.${assetClass}`, actual === expected, `${actual}/${expected}`);
  }
  for (const [profile, rule] of Object.entries(PROFILE_RULES)) {
    const actual = assets.filter((row) => row.profile === profile).length;
    check(`count.profile.${profile}`, actual === rule.count, `${actual}/${rule.count}`);
  }
  for (const [directory, expected] of Object.entries(SOURCE_DIRECTORY_COUNTS)) {
    const actual = assets.filter((row) => row.path.startsWith(directory)).length;
    check(`count.sourceDir.${directory}`, actual === expected, `${actual}/${expected}`);
  }

  const declaredProfiles = new Set(contract.profiles);
  const knownProfiles = Object.keys(PROFILE_RULES);
  check('profiles.declared',
    knownProfiles.every((profile) => declaredProfiles.has(profile)) && declaredProfiles.size === knownProfiles.length,
    `17.3 declares ${[...declaredProfiles].join(', ')}`);

  const rowProblems: string[] = [];
  for (const row of assets) {
    const rule = PROFILE_RULES[row.profile];
    if (!rule) { rowProblems.push(`${row.id}: undeclared profile ${row.profile}`); continue; }
    if (rule.assetClass !== row.assetClass) rowProblems.push(`${row.id}: class ${row.assetClass} not allowed for ${row.profile}`);
    if (!row.id.startsWith(CLASS_PREFIX[row.assetClass])) rowProblems.push(`${row.id}: prefix does not match ${row.assetClass}`);
    const basename = row.path.slice(row.path.lastIndexOf('/') + 1);
    if (basename !== expectedBasename(row)) rowProblems.push(`${row.id}: filename ${basename} != ${expectedBasename(row)}`);
    if (!row.path.startsWith(expectedDirectoryPrefix(row))) rowProblems.push(`${row.id}: path ${row.path} outside ${expectedDirectoryPrefix(row)}`);
    if (row.consumers.length === 0) rowProblems.push(`${row.id}: no consumer`);
    for (const dependency of row.dependencies) {
      if (!idSet.has(dependency)) rowProblems.push(`${row.id}: unknown dependency ${dependency}`);
    }
    if (row.assetClass === 'DERIVED ASSET' && row.profile !== 'ATLAS') {
      const source = row.id.replace(/^CG-D-/, 'CG-S-');
      if (!row.dependencies.includes(source)) rowProblems.push(`${row.id}: does not depend on its source ${source}`);
    }
    if ((row.assetClass === 'ARENA SOURCE ASSET' || row.assetClass === 'DIRECT ARENA ASSET')
      && row.dependencies.some((dependency) => !dependency.startsWith('CG-S-'))) {
      rowProblems.push(`${row.id}: authored source depends on a non-source ID`);
    }
  }
  check('rows.wellFormed', rowProblems.length === 0, rowProblems.slice(0, 20).join('; ') || `${assets.length} rows valid`);

  const cycle = findCycle(assets);
  check('dependencies.acyclic', cycle === null, cycle ? `cycle ${cycle.join(' -> ')}` : 'no cycles');

  const register = new Set(contract.consumerRegister);
  check('consumers.matrixRows', contract.systemMatrix.length === SYSTEM_MATRIX_ROWS,
    `${contract.systemMatrix.length}/${SYSTEM_MATRIX_ROWS} SYS rows in 6.4`);
  check('consumers.registerSize', register.size === CONSUMER_REGISTER_SIZE, `${register.size}/${CONSUMER_REGISTER_SIZE}`);
  const unknownConsumers = [...new Set(assets.flatMap((row) => row.consumers).filter((consumer) => !register.has(consumer)))];
  check('consumers.known', unknownConsumers.length === 0, unknownConsumers.join(', ') || 'all consumers registered');

  const traced = contract.traceability;
  check('traceability.rows', traced.size === CONSUMER_REGISTER_SIZE
    && [...register].every((system) => traced.has(system)), `${traced.size} mapped systems`);
  const traceProblems: string[] = [];
  for (const [system, mapped] of traced) {
    if (!register.has(system)) traceProblems.push(`${system}: not in register`);
    if (mapped.length === 0) traceProblems.push(`${system}: no mapped asset`);
    for (const id of mapped) if (!idSet.has(id)) traceProblems.push(`${system}: unknown ${id}`);
  }
  check('traceability.closure', traceProblems.length === 0, traceProblems.join('; ') || 'every system maps to declared IDs');
  const audio = traced.get('SYS-AUDIO') ?? [];
  check('traceability.audio', audio.length === PROFILE_RULES.AUDIO?.count, `${audio.length} audio recipes mapped`);

  const atlas = byId.get('CG-D-UI-ATLAS');
  const glyphIds = assets.filter((row) => row.profile === 'GLYPH').map((row) => row.id);
  check('atlas.contents', atlas !== undefined
    && atlas.dependencies.length === glyphIds.length
    && glyphIds.every((id) => atlas.dependencies.includes(id))
    && ATLAS_CELLS - glyphIds.length === 26,
  `${atlas?.dependencies.length ?? 0} glyphs packed, ${ATLAS_CELLS - glyphIds.length} empty cells`);

  const authored = assets.filter((row) => row.assetClass === 'ARENA SOURCE ASSET' || row.assetClass === 'DIRECT ARENA ASSET');
  const assigned = contract.batches.flatMap((batch) => batch.assetIds);
  const batchProblems: string[] = [];
  for (const batch of contract.batches) {
    if (batch.assetIds.length !== batch.count) batchProblems.push(`${batch.id}: lists ${batch.assetIds.length}, declares ${batch.count}`);
    for (const id of batch.assetIds) {
      const row = byId.get(id);
      if (!row) batchProblems.push(`${batch.id}: unknown ${id}`);
      else if (row.assetClass !== 'ARENA SOURCE ASSET' && row.assetClass !== 'DIRECT ARENA ASSET') batchProblems.push(`${batch.id}: ${id} is not authored`);
    }
  }
  const duplicateAssignments = assigned.filter((id, index) => assigned.indexOf(id) !== index);
  const unassigned = authored.filter((row) => !assigned.includes(row.id)).map((row) => row.id);
  if (duplicateAssignments.length) batchProblems.push(`assigned twice: ${duplicateAssignments.join(', ')}`);
  if (unassigned.length) batchProblems.push(`unassigned: ${unassigned.join(', ')}`);
  check('batches.allocation', contract.batches.length === BATCH_COUNT && assigned.length === AUTHORED_TOTAL
    && batchProblems.length === 0, batchProblems.join('; ') || `${contract.batches.length} batches, ${assigned.length} outputs`);

  const godformProblems: string[] = [];
  if (contract.godformRecipes.length !== GODFORM_RECIPES) godformProblems.push(`${contract.godformRecipes.length} recipes in Section 5`);
  for (const recipe of contract.godformRecipes) {
    const modules = contract.godformModuleMap.get(recipe);
    if (!modules || modules.length === 0) { godformProblems.push(`${recipe}: no module mapping`); continue; }
    for (const module of modules) {
      if (module === 'FEED-*') {
        if (!ids.some((id) => id.startsWith('CG-S-GOD-FEED-'))) godformProblems.push(`${recipe}: no FEED modules`);
        continue;
      }
      for (const prefix of ['CG-S-GOD-', 'CG-D-GOD-']) {
        if (!idSet.has(`${prefix}${module}`)) godformProblems.push(`${recipe}: missing ${prefix}${module}`);
      }
    }
  }
  check('godform.mapping', godformProblems.length === 0, godformProblems.join('; ') || `${contract.godformRecipes.length} recipes mapped to visible modules`);

  return results;
}
