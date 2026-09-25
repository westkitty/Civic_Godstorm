import { useCallback, useMemo, useState } from 'react';
import { assetRegistry } from '../assets/registry.ts';
import type { RendererStatus } from '../render/RendererHost.ts';
import { GameSession } from '../runtime/session.ts';
import { SEED_PATTERN } from '../sim/core/rng.ts';
import { FatalScreen } from '../ui/FatalScreen.tsx';
import { GameScreen } from '../ui/GameScreen.tsx';
import { MissingAsset } from '../ui/MissingAsset.tsx';
import { SelfCheckPanel } from '../ui/SelfCheckPanel.tsx';
import { buildIdentity } from './buildIdentity.ts';
import { browserProbeEnvironment, probeCapabilities, type BootVerdict } from './capabilities.ts';

type RendererState =
  | { readonly kind: 'starting' }
  | RendererStatus
  | { readonly kind: 'failed'; readonly message: string };

/** M02 prototype campaign: small map, two civilizations; `?seed=` selects the world. */
export const DEFAULT_SEED = 'cg-demo';

function yesNo(value: boolean): string {
  return value ? 'available' : 'unavailable';
}

function readParams(): { seed: string; debug: boolean } {
  const params = new URLSearchParams(window.location.search);
  const seed = params.get('seed') ?? DEFAULT_SEED;
  return { seed: SEED_PATTERN.test(seed) ? seed : DEFAULT_SEED, debug: params.get('debug') === '1' };
}

export function App() {
  const [verdict, setVerdict] = useState<BootVerdict>(() => probeCapabilities(browserProbeEnvironment()));
  const [renderer, setRenderer] = useState<RendererState>({ kind: 'starting' });
  const [attempt, setAttempt] = useState(0);
  const params = useMemo(() => readParams(), []);
  const unresolved = useMemo(() => assetRegistry.unresolvedIds().length, []);
  const session = useMemo(() => {
    try {
      return { ok: true as const, session: new GameSession({ seed: params.seed, size: 'small', civCount: 2 }) };
    } catch (error: unknown) {
      return { ok: false as const, message: error instanceof Error ? error.message : String(error) };
    }
  }, [params.seed]);

  const handleStatus = useCallback((status: RendererStatus) => setRenderer(status), []);
  const handleFailure = useCallback((error: Error) => {
    console.error('Renderer failed to start', error);
    setRenderer({ kind: 'failed', message: error.message || 'Unknown renderer error' });
  }, []);

  if (verdict.kind === 'unsupported') {
    return (
      <FatalScreen
        title="This browser cannot run CIVIC GODSTORM"
        code="WEBGL2_UNAVAILABLE"
        detail="The game renders its world with WebGL2, which this browser or device did not provide. No reduced fake-3D mode exists."
        actionLabel="Check again"
        onAction={() => setVerdict(probeCapabilities(browserProbeEnvironment()))}
      >
        <p>Try a current Chromium, Firefox or Safari release with hardware acceleration enabled.</p>
        <p className="cg-fatal__code">Probe result: {verdict.report.webgl2Detail}</p>
      </FatalScreen>
    );
  }

  if (!session.ok) {
    return (
      <FatalScreen title="No valid world could be generated" code="WORLD_GENERATION_FAILED" detail={session.message}
        actionLabel="Use the default seed" onAction={() => { window.location.search = ''; }} />
    );
  }

  if (renderer.kind === 'failed') {
    return (
      <FatalScreen
        title="The 3D renderer could not start"
        code="RENDERER_START_FAILED"
        detail="WebGL2 was reported, but creating the game renderer failed. The campaign has not advanced, so nothing was lost."
        actionLabel="Try again"
        onAction={() => {
          setRenderer({ kind: 'starting' });
          setAttempt((value) => value + 1);
        }}
      >
        <p className="cg-fatal__code">Renderer message: {renderer.message}</p>
      </FatalScreen>
    );
  }

  const rendererText =
    renderer.kind === 'running'
      ? `running, ${renderer.drawCalls} draw calls, ${renderer.triangles} triangles`
      : renderer.kind === 'context-lost'
        ? 'context lost; waiting for the browser to restore it (no game state affected)'
        : 'starting';

  return (
    <GameScreen key={attempt} session={session.session} debug={params.debug} onRendererStatus={handleStatus} onRendererFailure={handleFailure}>
      <details className="cg-panel" data-testid="diagnostics">
        <summary>Development diagnostics</summary>
        <h2>Build status</h2>
        <dl className="cg-facts">
          <dt>Build</dt>
          <dd data-testid="build-identity">{buildIdentity.version} ({buildIdentity.commit})</dd>
          <dt>Contract</dt>
          <dd>{buildIdentity.contract}</dd>
          <dt>Seed</dt>
          <dd data-testid="campaign-seed">{params.seed}</dd>
          <dt>Asset specification</dt>
          <dd data-testid="asset-summary">{assetRegistry.totalSpecified} IDs specified; {unresolved} unresolved</dd>
          <dt>Renderer</dt>
          <dd data-testid="renderer-status" data-renderer-kind={renderer.kind} aria-live="polite">{rendererText}</dd>
          <dt>WebGL2</dt>
          <dd>{verdict.report.webgl2Detail}</dd>
          <dt>Storage / input / audio APIs</dt>
          <dd>
            IndexedDB {yesNo(verdict.report.indexedDB)}; Pointer Events {yesNo(verdict.report.pointerEvents)}; Web Audio{' '}
            {yesNo(verdict.report.webAudio)}
          </dd>
        </dl>
        <p className="cg-note">
          Checker panels labelled MISSING mark assets that have not been produced, approved or verified. They are development
          placeholders, never final art.
        </p>
        <SelfCheckPanel />
        <h2>Title art</h2>
        <MissingAsset assetId="CG-A-ART-TITLE" />
      </details>
    </GameScreen>
  );
}
