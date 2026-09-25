// Builds the offline inspectors (master Section 17.3):
//   node tools/inspector/build-viewers.ts [--revision c001]
// For every Q MODEL-* ID it writes artifacts/inspection/<ID>/<revision>/viewer.html. That single
// file embeds the delivered GLB bytes (base64) and the bundled inspector, with no external
// scripts, styles, fonts or network requests.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'vite';

const root = resolve(import.meta.dirname, '../..');
const recipe = JSON.parse(readFileSync(resolve(root, 'tools/models/q_recipe.json'), 'utf8')) as {
  revision: string;
  modules: Record<string, { slug: string }>;
  form: { id: string; slug: string };
};
const revisionIndex = process.argv.indexOf('--revision');
const revision = revisionIndex >= 0 ? (process.argv[revisionIndex + 1] ?? recipe.revision) : recipe.revision;

const bundleDir = resolve(root, 'artifacts/local/inspector-bundle');
await build({
  configFile: false,
  logLevel: 'warn',
  root,
  build: {
    outDir: bundleDir,
    emptyOutDir: true,
    minify: true,
    sourcemap: false,
    target: 'es2023',
    lib: { entry: resolve(root, 'src/inspector/main.ts'), formats: ['iife'], name: 'CGInspector', fileName: () => 'inspector.js' },
  },
});
const bundle = readFileSync(resolve(bundleDir, 'inspector.js'), 'utf8');
if (/https?:\/\/(?!www\.w3\.org)/.test(bundle.replace(/\/\/[^\n]*\n/g, ''))) {
  console.warn('note: bundle contains URL strings (library comments/constants); no request is issued by the inspector');
}

const escapeScript = (text: string): string => text.replaceAll('</script', '<\\/script');
const models = [
  ...Object.entries(recipe.modules).map(([id, spec]) => ({ id, slug: spec.slug, poses: false })),
  { id: recipe.form.id, slug: recipe.form.slug, poses: true },
];

for (const model of models) {
  const glb = readFileSync(resolve(root, 'assets/runtime/models', `${model.slug}.glb`));
  const sha256 = createHash('sha256').update(glb).digest('hex');
  const embedded = { id: model.id, revision, sha256, glbBase64: glb.toString('base64'), poses: model.poses };
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src data: blob:">
<title>${model.id} ${revision} inspector</title>
<style>
  :root { color-scheme: dark; --bg: #14191f; --fg: #f4ecde; --muted: #9aa3ab; --accent: #49a69d; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.4 system-ui, sans-serif; display: grid; grid-template-rows: auto 1fr auto; height: 100vh; }
  header { padding: 8px 16px; border-bottom: 1px solid #2a3139; }
  h1 { font-size: 15px; margin: 0; }
  #status { color: var(--muted); font-size: 12px; margin: 2px 0 0; }
  #view { min-height: 0; }
  #view canvas { width: 100%; height: 100%; display: block; touch-action: none; }
  #controls { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 16px; border-top: 1px solid #2a3139; }
  fieldset { border: 1px solid #2f3740; border-radius: 6px; margin: 0; padding: 4px 8px 8px; display: flex; flex-wrap: wrap; gap: 6px; }
  legend { color: var(--muted); font-size: 12px; }
  button, select { background: #1f262d; color: var(--fg); border: 1px solid #3a444e; border-radius: 4px; padding: 5px 9px; font: inherit; min-height: 32px; }
  button:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  button[aria-pressed="true"] { border-color: var(--accent); }
</style>
</head>
<body>
<header><h1>${model.id} · revision ${revision}</h1><p id="status" role="status">Loading embedded GLB…</p></header>
<main id="view" aria-label="Model view"></main>
<nav id="controls" aria-label="Inspector controls"></nav>
<script>window.__CG_MODEL__ = ${JSON.stringify(embedded)};</script>
<script>${escapeScript(bundle)}</script>
</body>
</html>
`;
  const out = resolve(root, 'artifacts/inspection', model.id, revision);
  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, 'viewer.html'), html);
  console.log(`${model.id}: viewer.html (${(html.length / 1024).toFixed(0)} KiB, glb ${sha256.slice(0, 12)})`);
}
