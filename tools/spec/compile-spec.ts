// M00 specification compiler.
//   node tools/spec/compile-spec.ts          -> verify contract, write generated registries
//   node tools/spec/compile-spec.ts --check  -> verify contract, fail if generated files are stale
// Generated files are requirements, never success claims. Evidence registries
// (assets/provenance.json, assets/manifest.json) are only seeded when absent, never overwritten.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildOutputs, loadContract, loadEvidence, type GeneratedFile } from './outputs.ts';

const root = resolve(import.meta.dirname, '../..');
const checkOnly = process.argv.includes('--check');

const { contract, results } = loadContract(root);
let failed = false;
for (const result of results) {
  if (!result.ok) failed = true;
  console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}  ${result.detail}`);
}
if (failed) {
  console.error('\nSpecification compilation FAILED: the contract does not satisfy the frozen expectations.');
  process.exit(1);
}

const { generated, seeds } = buildOutputs(contract, loadEvidence(root));
const stale: string[] = [];
const write = (file: GeneratedFile): void => {
  const target = resolve(root, file.path);
  const current = existsSync(target) ? readFileSync(target, 'utf8') : null;
  if (current === file.content) return;
  if (checkOnly) {
    stale.push(file.path);
    return;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, file.content);
  console.log(`wrote ${file.path}`);
};
generated.forEach(write);

for (const seed of seeds) {
  const target = resolve(root, seed.path);
  if (existsSync(target)) continue;
  if (checkOnly) {
    stale.push(seed.path);
    continue;
  }
  writeFileSync(target, seed.content);
  console.log(`seeded ${seed.path}`);
}

if (stale.length > 0) {
  console.error(`\nGenerated registries are stale or missing: ${stale.join(', ')}. Run npm run spec:compile.`);
  process.exit(1);
}
console.log(`\nSpecification OK: ${contract.assets.length} IDs, ${results.length} checks passed${checkOnly ? ' (check mode)' : ''}.`);
