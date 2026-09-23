// npm run probe:env [-- --out <dir>]
// Records the actual toolchain/host facts that evidence must cite (master Section 15, M00).

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { resolve } from 'node:path';

function run(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n')[0] ?? '';
  } catch {
    return 'unavailable';
  }
}

const facts = {
  os: { platform: platform(), release: release(), arch: arch(), productVersion: run('sw_vers', ['-productVersion']) },
  cpu: cpus()[0]?.model ?? 'unknown',
  memoryBytes: totalmem(),
  node: process.version,
  npm: run('npm', ['--version']),
  git: run('git', ['--version']),
  commit: run('git', ['rev-parse', 'HEAD']),
  chrome: run('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--version']),
  blender: run('/Applications/Blender.app/Contents/MacOS/Blender', ['--version']),
  python: run('python3', ['--version']),
};

const outIndex = process.argv.indexOf('--out');
console.log(JSON.stringify(facts, null, 2));
if (outIndex >= 0) {
  const out = resolve(process.argv[outIndex + 1] ?? 'artifacts/local/env');
  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, 'environment.json'), `${JSON.stringify(facts, null, 2)}\n`);
}
