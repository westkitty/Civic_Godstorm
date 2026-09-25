// npm run validate:release
// Release asset gate (master Sections 17.10, 18.2, M09/M14): every required ID must be approved,
// derived and verified, with no placeholders. Until then this command must fail.

import { resolve } from 'node:path';
import { auditAssets, printAudit } from './audit.ts';

const root = resolve(import.meta.dirname, '../..');
const report = auditAssets(root);
const consistent = printAudit(report);
const complete = report.unresolved.length === 0 && report.counts.authoredApproved === report.counts.authoredTotal;

if (!consistent || !complete) {
  console.error('\nvalidate:release FAILED: release requires zero unresolved IDs and all authored sources approved.');
  if (report.unresolved.length > 0) console.error(`First unresolved IDs: ${report.unresolved.slice(0, 8).join(', ')} ...`);
  process.exit(1);
}
console.log('\nvalidate:release PASSED');
