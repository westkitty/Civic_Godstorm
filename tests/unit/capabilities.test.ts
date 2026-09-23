import { describe, expect, it } from 'vitest';
import { probeCapabilities, type ProbeEnvironment } from '../../src/app/capabilities.ts';

const environment = (getContext: () => unknown): ProbeEnvironment => ({
  createCanvas: () => ({ getContext }),
  hasIndexedDB: true,
  hasPointerEvents: true,
  hasWebAudio: false,
});

describe('probeCapabilities', () => {
  it('reports supported and releases the probe context when WebGL2 exists', () => {
    let released = false;
    const context = { getExtension: () => ({ loseContext: () => { released = true; } }) };
    const verdict = probeCapabilities(environment(() => context));
    expect(verdict.kind).toBe('supported');
    expect(verdict.report.webAudio).toBe(false);
    expect(released).toBe(true);
  });

  it('reports unsupported when the browser returns no WebGL2 context', () => {
    const verdict = probeCapabilities(environment(() => null));
    expect(verdict).toMatchObject({ kind: 'unsupported', missing: ['WebGL2'] });
  });

  it('reports unsupported with the reason when context creation throws', () => {
    const verdict = probeCapabilities(environment(() => { throw new Error('GPU blocklisted'); }));
    expect(verdict.kind).toBe('unsupported');
    expect(verdict.report.webgl2Detail).toContain('GPU blocklisted');
  });
});
