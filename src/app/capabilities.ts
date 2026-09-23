// Browser capability probe. WebGL2 is mandatory (master AD-03): without it the game shows an honest
// requirement screen instead of a degraded fake 3D build. Other APIs are reported so later
// milestones can gate their own features.

export interface CapabilityReport {
  readonly webgl2: boolean;
  readonly webgl2Detail: string;
  readonly indexedDB: boolean;
  readonly pointerEvents: boolean;
  readonly webAudio: boolean;
}

export type BootVerdict =
  | { readonly kind: 'supported'; readonly report: CapabilityReport }
  | { readonly kind: 'unsupported'; readonly report: CapabilityReport; readonly missing: readonly string[] };

export interface ProbeEnvironment {
  createCanvas(): { getContext(kind: 'webgl2'): unknown };
  readonly hasIndexedDB: boolean;
  readonly hasPointerEvents: boolean;
  readonly hasWebAudio: boolean;
}

interface LoseContext {
  loseContext(): void;
}

function releaseProbeContext(context: unknown): void {
  const gl = context as { getExtension?: (name: string) => unknown };
  const lose = gl.getExtension?.('WEBGL_lose_context') as LoseContext | null | undefined;
  lose?.loseContext();
}

export function probeCapabilities(env: ProbeEnvironment): BootVerdict {
  let webgl2 = false;
  let webgl2Detail: string;
  try {
    const context = env.createCanvas().getContext('webgl2');
    webgl2 = context !== null && context !== undefined;
    webgl2Detail = webgl2 ? 'WebGL2 context created' : 'Browser returned no WebGL2 context';
    if (webgl2) releaseProbeContext(context);
  } catch (error: unknown) {
    webgl2Detail = `WebGL2 context creation threw: ${error instanceof Error ? error.message : String(error)}`;
  }
  const report: CapabilityReport = {
    webgl2,
    webgl2Detail,
    indexedDB: env.hasIndexedDB,
    pointerEvents: env.hasPointerEvents,
    webAudio: env.hasWebAudio,
  };
  return webgl2 ? { kind: 'supported', report } : { kind: 'unsupported', report, missing: ['WebGL2'] };
}

export function browserProbeEnvironment(): ProbeEnvironment {
  return {
    createCanvas: () => document.createElement('canvas'),
    hasIndexedDB: typeof indexedDB !== 'undefined',
    hasPointerEvents: typeof PointerEvent !== 'undefined',
    hasWebAudio: typeof AudioContext !== 'undefined',
  };
}
