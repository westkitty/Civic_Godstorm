import { useState } from 'react';
import { runSelfCheck, SELF_CHECK_OPTIONS, type SelfCheckResult } from '../runtime/selfCheck.ts';

type PanelState = { readonly kind: 'idle' } | { readonly kind: 'done'; readonly result: SelfCheckResult } | { readonly kind: 'failed'; readonly message: string };

/** Runs the deterministic kernel self-check in this browser on request. */
export function SelfCheckPanel() {
  const [state, setState] = useState<PanelState>({ kind: 'idle' });
  const run = (): void => {
    try {
      setState({ kind: 'done', result: runSelfCheck() });
    } catch (error: unknown) {
      setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
    }
  };
  return (
    <section className="cg-selfcheck" aria-labelledby="cg-selfcheck-heading">
      <h2 id="cg-selfcheck-heading">Simulation kernel</h2>
      <p className="cg-note">
        Runs the CG-XOR32-v1 golden vectors and a {SELF_CHECK_OPTIONS.turns}-turn {SELF_CHECK_OPTIONS.size} campaign (seed{' '}
        <code>{SELF_CHECK_OPTIONS.seed}</code>) in this browser. The final state hash must equal the Node reference.
      </p>
      <button type="button" className="cg-button" onClick={run}>
        Run determinism self-check
      </button>
      <div aria-live="polite" data-testid="selfcheck-result" data-selfcheck-kind={state.kind}>
        {state.kind === 'done' && (
          <dl className="cg-facts">
            <dt>Golden vectors</dt>
            <dd data-testid="selfcheck-golden">{state.result.goldenVectorsPass ? 'pass' : 'FAIL'}</dd>
            <dt>Turns resolved</dt>
            <dd>{state.result.turns}</dd>
            <dt>Final state hash</dt>
            <dd data-testid="selfcheck-final-hash">
              <code>{state.result.finalHash}</code>
            </dd>
          </dl>
        )}
        {state.kind === 'failed' && <p role="alert">Self-check failed: {state.message}</p>}
      </div>
    </section>
  );
}
