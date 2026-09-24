// Records the Q derived models (master Sections 17.3, 18.2):
//   node tools/models/register-derived.ts [--revision c001]
// Combines each model's measured evidence into artifacts/inspection/<ID>/<revision>/validation.json
// and writes a DERIVED_UNVERIFIED provenance record. The inputs are the export meta, the silhouette,
// structure and deformation measurements, the Khronos validator report and the offline-inspector
// run. Promotion to INTEGRATED_VERIFIED (a manifest entry) is not done here. It needs every gate
// to pass and the human art decision.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const read = <T>(path: string): T => JSON.parse(readFileSync(resolve(root, path), 'utf8')) as T;
const recipe = read<{ revision: string; modules: Record<string, { slug: string; source: string }>; form: { id: string; slug: string; source: string; instances: { module: string }[] } }>('tools/models/q_recipe.json');
const i = process.argv.indexOf('--revision');
const revision = i >= 0 ? (process.argv[i + 1] ?? recipe.revision) : recipe.revision;
interface Record_ { id: string; status: string; sha256?: string; path?: string; [k: string]: unknown }
const provenance = read<{ records: Record_[]; [k: string]: unknown }>('assets/provenance.json');
const sourceRecord = (id: string): Record_ | undefined => provenance.records.find((r) => r.id === id && r.status === 'APPROVED_SOURCE');

const models = [
  ...Object.entries(recipe.modules).map(([id, m]) => ({ id, slug: m.slug, sources: [m.source] })),
  { id: recipe.form.id, slug: recipe.form.slug, sources: [recipe.form.source, 'CG-S-GOD-LIFE-Q', ...new Set(recipe.form.instances.map((x) => recipe.modules[x.module]?.source ?? ''))].filter(Boolean) },
];
const derived: Record_[] = [];
for (const model of models) {
  const dir = `artifacts/inspection/${model.id}/${revision}`;
  const glbPath = `assets/runtime/models/${model.slug}.glb`;
  const bytes = readFileSync(resolve(root, glbPath));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const meta = read<Record<string, unknown>>(`assets/runtime/models/${model.slug}.meta.json`);
  const measurements = read<{ silhouettePass: boolean; structuralPass: boolean; views: Record<string, unknown>; nonProjectable: Record<string, string>; structure: unknown; deformation?: unknown; sha256: string; identityAnchors?: unknown }>(`${dir}/measurements.json`);
  const gltf = read<{ validatorVersion: string; issues: { numErrors: number; numWarnings: number; numInfos: number; numHints: number } }>(`${dir}/gltf-validator.json`);
  const reimport = existsSync(resolve(root, dir, 'reimport.json')) ? read<{ pass: boolean }>(`${dir}/reimport.json`) : null;
  const inspector = existsSync(resolve(root, dir, 'inspector-evidence.json')) ? read<{ pass: boolean }>(`${dir}/inspector-evidence.json`) : null;
  if (measurements.sha256 !== sha256 || meta.sha256 !== sha256) throw new Error(`${model.id}: evidence was measured on a different GLB; rerun the pipeline`);
  const sources = model.sources.map((id) => {
    const rec = sourceRecord(id);
    if (!rec) throw new Error(`${model.id}: dependency ${id} is not an APPROVED_SOURCE`);
    return { id, sha256: rec.sha256, path: rec.path };
  });
  const gates = {
    silhouetteIoUAndLandmarks: measurements.silhouettePass,
    structureSkinLodMaterial: measurements.structuralPass,
    khronosValidatorClean: gltf.issues.numErrors === 0 && gltf.issues.numWarnings === 0,
    blenderReimport: reimport?.pass === true,
    offlineInspectorAndTurntable: inspector?.pass === true,
    humanArtApproval: false,
  };
  const validation = {
    id: model.id,
    revision,
    glb: { path: glbPath, sha256, bytes: bytes.length },
    sources,
    tool: meta.tool,
    recipe: meta.recipe,
    export: meta.export,
    measurements,
    gltfValidator: { version: gltf.validatorVersion, ...gltf.issues, report: `${dir}/gltf-validator.json` },
    reimport: reimport ? { report: `${dir}/reimport.json`, pass: reimport.pass } : null,
    inspector: inspector ? { report: `${dir}/inspector-evidence.json`, pass: inspector.pass } : null,
    gates,
    verdict: Object.values(gates).every(Boolean) ? 'ALL_GATES_PASS' : 'DERIVED_UNVERIFIED',
  };
  writeFileSync(resolve(root, dir, 'validation.json'), `${JSON.stringify(validation, null, 2)}\n`);
  derived.push({
    id: model.id,
    status: 'DERIVED_UNVERIFIED',
    path: glbPath,
    sha256,
    bytes: bytes.length,
    revision,
    sources: sources.map((s) => s.id),
    authoring: { blend: `assets/authoring/${model.slug}.blend`, recipe: `assets/authoring/${model.slug}.recipe.json`, meta: `assets/runtime/models/${model.slug}.meta.json` },
    validation: `${dir}/validation.json`,
    gates,
  });
  console.log(`${model.id}: ${validation.verdict} ${JSON.stringify(gates)}`);
}
const ids = new Set(derived.map((d) => d.id));
provenance.records = [...provenance.records.filter((r) => !ids.has(r.id)), ...derived].sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(resolve(root, 'assets/provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`);
