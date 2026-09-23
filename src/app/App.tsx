import { useCallback, useMemo, useState } from 'react';
import { assetRegistry } from '../assets/registry.ts';
import type { RendererStatus } from '../render/RendererHost.ts';
import { FatalScreen } from '../ui/FatalScreen.tsx';
import { MissingAsset } from '../ui/MissingAsset.tsx';
import { WorldView } from '../ui/WorldView.tsx';
import { buildIdentity } from './buildIdentity.ts';
import { browserProbeEnvironment, probeCapabilities, type BootVerdict } from './capabilities.ts';

type RendererState =
  | { readonly kind: 'starting' }
  | RendererStatus
  | { readonly kind: 'failed'; readonly message: string };

function yesNo(value: boolean): string {
  return value ? 'available' : 'unavailable';
}

export function App() {
  const [verdict, setVerdict] = useState<BootVerdict>(() => probeCapabilities(browserProbeEnvironment()));
  const [renderer, setRenderer] = useState<RendererState>({ kind: 'starting' });
  const [rendererAttempt, setRendererAttempt] = useState(0);
  const unresolved = useMemo(() => assetRegistry.unresolvedIds().length, []);

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

  if (renderer.kind === 'failed') {
    return (
      <FatalScreen
        title="The 3D renderer could not start"
        code="RENDERER_START_FAILED"
        detail="WebGL2 was reported, but creating the game renderer failed. No campaign state exists yet, so nothing was lost."
        actionLabel="Try again"
        onAction={() => {
          setRenderer({ kind: 'starting' });
          setRendererAttempt((attempt) => attempt + 1);
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
    <div className="cg-shell">
      <header className="cg-shell__header">
        <h1 className="cg-title">CIVIC GODSTORM</h1>
        <p className="cg-subtitle">Architecture foundation build. Not yet a playable campaign.</p>
      </header>
      <main className="cg-shell__main">
        <section className="cg-panel cg-title-surface" aria-labelledby="cg-title-surface-heading">
          <h2 id="cg-title-surface-heading">Title art</h2>
          <MissingAsset assetId="CG-A-ART-TITLE" className="cg-title-surface__art" />
        </section>
        <section className="cg-panel cg-world" aria-labelledby="cg-world-heading">
          <h2 id="cg-world-heading">World view</h2>
          <WorldView key={rendererAttempt} onStatus={handleStatus} onFailure={handleFailure} />
        </section>
        <section className="cg-panel cg-status" aria-labelledby="cg-status-heading">
          <h2 id="cg-status-heading">Build status</h2>
          <dl className="cg-facts">
            <dt>Build</dt>
            <dd data-testid="build-identity">
              {buildIdentity.version} ({buildIdentity.commit})
            </dd>
            <dt>Contract</dt>
            <dd>{buildIdentity.contract}</dd>
            <dt>Asset specification</dt>
            <dd data-testid="asset-summary">
              {assetRegistry.totalSpecified} IDs specified; {unresolved} unresolved
            </dd>
            <dt>Renderer</dt>
            <dd data-testid="renderer-status" data-renderer-kind={renderer.kind} aria-live="polite">
              {rendererText}
            </dd>
            <dt>WebGL2</dt>
            <dd>{verdict.report.webgl2Detail}</dd>
            <dt>Storage / input / audio APIs</dt>
            <dd>
              IndexedDB {yesNo(verdict.report.indexedDB)}; Pointer Events {yesNo(verdict.report.pointerEvents)}; Web
              Audio {yesNo(verdict.report.webAudio)}
            </dd>
          </dl>
          <p className="cg-note">
            Checker panels labelled MISSING mark assets that have not been produced, approved or verified. They are
            development placeholders, never final art.
          </p>
        </section>
      </main>
    </div>
  );
}
