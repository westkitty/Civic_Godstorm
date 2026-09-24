// Khronos glTF-Validator over every delivered Q GLB (master Section 18.4):
//   node tools/models/gltf-validate.ts [--revision c001]
// Writes the validator's actual report to artifacts/inspection/<ID>/<revision>/gltf-validator.json.
// Any error or warning fails; infos and hints are kept in the report.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

interface ValidatorReport {
  validatorVersion: string;
  issues: { numErrors: number; numWarnings: number; numInfos: number; numHints: number; messages: { code: string; message: string; severity: number }[] };
  info?: Record<string, unknown>;
}
const validator = createRequire(import.meta.url)('gltf-validator') as {
  validateBytes(data: Uint8Array, options?: Record<string, unknown>): Promise<ValidatorReport>;
};

const root = resolve(import.meta.dirname, '../..');
const recipe = JSON.parse(readFileSync(resolve(root, 'tools/models/q_recipe.json'), 'utf8')) as {
  revision: string;
  modules: Record<string, { slug: string }>;
  form: { id: string; slug: string };
};
const i = process.argv.indexOf('--revision');
const revision = i >= 0 ? (process.argv[i + 1] ?? recipe.revision) : recipe.revision;
const models = [...Object.entries(recipe.modules).map(([id, m]) => ({ id, slug: m.slug })), { id: recipe.form.id, slug: recipe.form.slug }];
let failed = false;
for (const model of models) {
  const bytes = new Uint8Array(readFileSync(resolve(root, 'assets/runtime/models', `${model.slug}.glb`)));
  const report = await validator.validateBytes(bytes, { maxIssues: 1000, writeTimestamp: false });
  const out = resolve(root, 'artifacts/inspection', model.id, revision);
  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, 'gltf-validator.json'), `${JSON.stringify(report, null, 2)}\n`);
  const { numErrors, numWarnings, numInfos, numHints } = report.issues;
  const ok = numErrors === 0 && numWarnings === 0;
  failed ||= !ok;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${model.id}  glTF-Validator ${report.validatorVersion}: ${numErrors} errors, ${numWarnings} warnings, ${numInfos} infos, ${numHints} hints`);
  for (const m of report.issues.messages.filter((x) => x.severity <= 1).slice(0, 5)) console.log(`      ${m.code}: ${m.message}`);
}
if (failed) process.exit(1);
