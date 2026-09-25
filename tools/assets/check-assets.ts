// npm run test:assets [-- --out <dir>]
// Development asset gate: the contract, registries and any physical files must be consistent.
// Missing assets are reported, not failures, because development milestones permit them.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { auditAssets, printAudit } from './audit.ts';

const root = resolve(import.meta.dirname, '../..');
const outIndex = process.argv.indexOf('--out');
const report = auditAssets(root);
const ok = printAudit(report);

if (outIndex >= 0) {
  const out = resolve(process.argv[outIndex + 1] ?? 'artifacts/local/assets');
  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, 'asset-audit.json'), `${JSON.stringify({ checks: report.checks, counts: report.counts, unresolved: report.unresolved }, null, 2)}\n`);
  console.log(`report written to ${out}/asset-audit.json`);
}

if (!ok) {
  console.error('\ntest:assets FAILED');
  process.exit(1);
}
console.log('\ntest:assets PASSED (development gate; missing assets permitted before M09)');
