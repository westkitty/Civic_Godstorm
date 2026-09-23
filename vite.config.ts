import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Build identity is derived from the repository, never from wall-clock time, so identical
// sources produce identical bundles.
function gitCommit(): string {
  try {
    const sha = execSync('git rev-parse --short=12 HEAD', { encoding: 'utf8' }).trim();
    const dirty = execSync('git status --porcelain', { encoding: 'utf8' }).trim().length > 0;
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return 'unknown';
  }
}

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  // Static GitHub Pages path (master Section 14.6); relative to the repository site.
  base: '/Civic_Godstorm/',
  plugins: [react()],
  define: {
    __CG_BUILD__: JSON.stringify({ version: pkg.version, commit: gitCommit(), contract: 'CG-V1.0.0' }),
  },
  build: {
    target: 'es2023',
    sourcemap: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
});
