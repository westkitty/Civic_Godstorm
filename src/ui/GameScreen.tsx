import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { CellActivation, RendererHost, RendererStatus } from '../render/RendererHost.ts';
import type { GameSession } from '../runtime/session.ts';
import type { Stance } from '../sim/gods/god.ts';
import { cellIndexOfAxial, axialOfIndex, HEADINGS } from '../sim/world/hex.ts';
import {
  buildWorldSnapshot,
  cellLabel,
  chosenPlan,
  computePreview,
  describeDraft,
  describeGod,
  effectiveMode,
  godCells,
  makeGodCommand,
  needsConsent,
  ownGod,
  type TargetingState,
} from './godView.ts';
import { WorldView } from './WorldView.tsx';

interface GameScreenProps {
  readonly session: GameSession;
  readonly debug: boolean;
  readonly onRendererStatus: (status: RendererStatus) => void;
  readonly onRendererFailure: (error: Error) => void;
  readonly children?: ReactNode;
}

const NO_TARGETING: TargetingState = { waypoints: [], routeMode: 'SAFE', then: null, consentGiven: false, cursor: null };
const STANCES: readonly Stance[] = ['CAREFUL', 'NORMAL', 'FORCEFUL'];

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function GameScreen({ session, debug, onRendererStatus, onRendererFailure, children }: GameScreenProps) {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const { view, drafts, lastResolution } = snapshot;
  const god = ownGod(view);
  const [selected, setSelected] = useState(false);
  const [targeting, setTargeting] = useState<TargetingState | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const hostRef = useRef<RendererHost | null>(null);
  const mapRef = useRef<HTMLElement>(null);

  const preview = useMemo(() => (god && targeting ? computePreview(view, god, targeting.waypoints) : null), [view, god, targeting]);
  const mode = effectiveMode(preview, targeting?.routeMode ?? 'SAFE');
  const plan = targeting ? chosenPlan(preview, mode) : null;
  const consentNeeded = needsConsent(plan);
  const world = useMemo(() => buildWorldSnapshot(view, selected, targeting, plan), [view, selected, targeting, plan]);
  const status = god ? describeGod(view, god) : null;

  const handleHost = useCallback((host: RendererHost | null) => {
    hostRef.current = host;
    if (debug) {
      (window as unknown as { __CG_DEBUG__?: unknown }).__CG_DEBUG__ = host
        ? { clientPointOfCell: (cell: number) => host.clientPointOfCell(cell) }
        : undefined;
    }
  }, [debug]);

  // Frame the player's God on first render.
  const framed = useRef(false);
  useEffect(() => {
    if (framed.current || !god || !hostRef.current) return;
    framed.current = true;
    hostRef.current.focusCells(godCells(view, god));
  });

  const selectGod = useCallback((focus: boolean) => {
    if (!god) return;
    setSelected(true);
    if (focus) hostRef.current?.focusCells(godCells(view, god));
  }, [god, view]);

  const startTargeting = useCallback(() => {
    if (!god) return;
    setSelected(true);
    setTargeting({ ...NO_TARGETING, cursor: god.anchor });
    // On narrow layouts the order panel sits below the map; bring the map back to choose a target.
    mapRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [god]);

  const cancelTargeting = useCallback(() => setTargeting(null), []);

  const setDestination = useCallback((cell: number, append: boolean) => {
    setTargeting((current) => {
      const base = current ?? NO_TARGETING;
      const waypoints = append ? [...base.waypoints, cell].slice(0, 12) : [cell];
      return { ...base, waypoints, consentGiven: false, cursor: cell };
    });
  }, []);

  const queue = useCallback((command: Parameters<typeof makeGodCommand>[3]) => {
    if (!god) return;
    session.addDraft(makeGodCommand(view, god, session.nextSequence(), command));
  }, [god, view, session]);

  const confirmRoute = useCallback(() => {
    if (!god || !targeting || !plan) return;
    if (consentNeeded && !targeting.consentGiven) return;
    queue({
      kind: 'GOD_MOVE',
      options: { waypoints: targeting.waypoints, routeMode: mode, then: targeting.then },
      consent: consentNeeded ? { civilianCollateral: plan.civilianCollateral, trespass: plan.trespass } : {},
    });
    setAnnouncement(`Order queued: move to ${cellLabel(view, targeting.waypoints.at(-1) ?? god.anchor)}.`);
    setTargeting(null);
  }, [god, targeting, plan, consentNeeded, mode, queue, view]);

  const endTurn = useCallback(() => {
    const record = session.endTurn();
    const godSummary = session.getSnapshot().state.lastTurn?.gods.find((g) => g.godId === god?.id);
    const rejected = record.rejections.filter((r) => r.commandId.startsWith('h'));
    setAnnouncement([
      `Turn ${record.turn} resolved.`,
      godSummary ? `Your God took ${godSummary.steps} step(s), spent ${godSummary.apSpent} AP${godSummary.fed ? ', fed' : ''}${godSummary.rested ? ', rested' : ''}${godSummary.halted ? `, halted (${godSummary.halted.replaceAll('_', ' ').toLowerCase()})` : ''}.` : '',
      rejected.length > 0 ? `${rejected.length} order(s) rejected: ${rejected.map((r) => r.reason).join('; ')}.` : '',
    ].filter(Boolean).join(' '));
    setTargeting(null);
  }, [session, god]);

  const handleCell = useCallback((activation: CellActivation) => {
    if (!god) return;
    const ownCells = godCells(view, god);
    if (activation.button === 2) {
      // Desktop right-click: route to the cell (safe route preferred; consent still explicit).
      setSelected(true);
      setTargeting({ ...NO_TARGETING, waypoints: [activation.cell], cursor: activation.cell });
      return;
    }
    if (targeting) {
      setDestination(activation.cell, activation.shiftKey);
      return;
    }
    if (ownCells.includes(activation.cell)) setSelected(true);
    else setSelected(false);
  }, [god, view, targeting, setDestination]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (isTypingTarget(event.target) || event.altKey || event.metaKey || event.ctrlKey) return;
      const host = hostRef.current;
      const onButton = event.target instanceof HTMLButtonElement;
      const key = event.key;
      if (key === 'Escape') {
        if (targeting) cancelTargeting();
        else setSelected(false);
        return;
      }
      if (targeting && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
        event.preventDefault();
        const headingByKey: Record<string, number> = { ArrowRight: 0, ArrowDown: 1, ArrowLeft: 3, ArrowUp: 4 };
        const from = targeting.cursor ?? god?.anchor ?? 0;
        const axial = axialOfIndex(view.dims, from);
        const d = HEADINGS[headingByKey[key] ?? 0] ?? { q: 0, r: 0 };
        const next = cellIndexOfAxial(view.dims, axial.q + d.q, axial.r + d.r);
        if (next >= 0) setTargeting({ ...targeting, cursor: next });
        return;
      }
      if (key === 'Enter' && !onButton) {
        event.preventDefault();
        if (targeting && targeting.cursor !== null) setDestination(targeting.cursor, event.shiftKey);
        else if (!targeting) endTurn();
        return;
      }
      if (onButton && (key === ' ' || key === 'Enter')) return;
      switch (key.toLowerCase()) {
        case 'g': selectGod(true); break;
        case 'm': startTargeting(); break;
        case 'f': if (selected) queue({ kind: 'GOD_FEED' }); break;
        case 'r': if (selected) queue({ kind: 'GOD_REST' }); break;
        case 'h': if (selected) queue({ kind: 'GOD_HOLD' }); break;
        case 'w': host?.panBy(0, -1); break;
        case 's': host?.panBy(0, 1); break;
        case 'a': host?.panBy(-1, 0); break;
        case 'd': host?.panBy(1, 0); break;
        case 'q': host?.rotate(-1); break;
        case 'e': host?.rotate(1); break;
        case '+': case '=': host?.zoomBy(1 / 1.2); break;
        case '-': host?.zoomBy(1.2); break;
        default: return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [targeting, god, view, selected, cancelTargeting, setDestination, endTurn, selectGod, startTargeting, queue]);

  const godOrderDrafts = drafts.filter((d) => d.actorId === god?.id);

  return (
    <div className="cg-game">
      <header className="cg-game__bar">
        <h1 className="cg-title cg-title--compact">CIVIC GODSTORM</h1>
        <p className="cg-turn" data-testid="turn-number">Turn {view.turn + 1}</p>
        {debug && <p className="cg-debug-badge" role="status">DEBUG TOOLS ENABLED</p>}
        <button type="button" className="cg-button cg-button--primary" onClick={endTurn} data-testid="end-turn">
          End turn (Enter)
        </button>
      </header>
      <main className="cg-game__map" ref={mapRef}>
        <WorldView
          snapshot={world}
          onStatus={onRendererStatus}
          onFailure={onRendererFailure}
          onCellActivate={handleCell}
          onHost={handleHost}
          label="Strategic map. Schematic development terrain; God and building art are marked MISSING until approved."
        />
        <p className="cg-map-legend">
          Schematic development map: terrain recipe CG-R-TERRAIN awaits CG-S-ART-DIRECTION approval. Bright cyan outline: your selected God.
          Yellow: planned route. Red: cells needing consent. Dark: unexplored.
        </p>
      </main>
      <aside className="cg-game__panel" aria-label="God and orders">
        {god && status && (
          <section className="cg-panel cg-dock" aria-labelledby="cg-dock-heading" data-testid="god-dock">
            <h2 id="cg-dock-heading">Your God</h2>
            <div className="cg-missing cg-missing--emblem" data-missing-asset="CG-R-GOD-EMBLEM">
              <span className="cg-missing__label">MISSING CG-R-GOD-EMBLEM</span>
            </div>
            <dl className="cg-facts">
              <dt>Location</dt><dd data-testid="god-location">{cellLabel(view, god.anchor)} facing {god.heading * 60}°</dd>
              <dt>Order</dt><dd data-testid="god-order">{status.order}</dd>
              <dt>Next</dt><dd>{status.next}</dd>
              <dt>Destination</dt><dd>{status.destination}</dd>
              <dt>Arrival</dt><dd>{status.arrival}</dd>
              <dt>Reserve</dt><dd data-testid="god-reserve">{status.reserve}</dd>
              <dt>Fatigue</dt><dd data-testid="god-fatigue">{status.fatigue}</dd>
              <dt>Health</dt><dd>{status.health}</dd>
              <dt>Stance</dt><dd>{god.stance.toLowerCase()}</dd>
            </dl>
            {status.danger && <p className="cg-danger" role="alert">DANGER: {status.danger}</p>}
            {godOrderDrafts.length > 0 && (
              <p className="cg-note" data-testid="god-queued">Queued for next turn: {godOrderDrafts.map((d) => describeDraft(view, d)).join('; ')}</p>
            )}
            <div className="cg-actions">
              <button type="button" className="cg-button" onClick={() => selectGod(true)} aria-pressed={selected}>
                {selected ? 'God selected' : 'Select God (G)'}
              </button>
            </div>
          </section>
        )}

        {god && selected && (
          <section className="cg-panel" aria-labelledby="cg-commands-heading" data-testid="command-strip">
            <h2 id="cg-commands-heading">Orders</h2>
            <div className="cg-actions">
              <button type="button" className="cg-button" onClick={startTargeting}>Move (M)</button>
              <button type="button" className="cg-button" onClick={() => queue({ kind: 'GOD_FEED' })}>Feed (F)</button>
              <button type="button" className="cg-button" onClick={() => queue({ kind: 'GOD_REST' })}>Rest (R)</button>
              <button type="button" className="cg-button" onClick={() => queue({ kind: 'GOD_HOLD' })}>Hold / cancel itinerary (H)</button>
            </div>
            <fieldset className="cg-stance">
              <legend>Stance</legend>
              {STANCES.map((stance) => (
                <label key={stance}>
                  <input
                    type="radio"
                    name="stance"
                    value={stance}
                    checked={god.stance === stance}
                    onChange={() => queue({ kind: 'GOD_STANCE', options: { stance } })}
                  />
                  {stance.toLowerCase()}
                </label>
              ))}
            </fieldset>
          </section>
        )}

        {god && targeting && (
          <section className="cg-panel" aria-labelledby="cg-route-heading" data-testid="route-preview">
            <h2 id="cg-route-heading">Plan route</h2>
            {targeting.waypoints.length === 0 ? (
              <p>
                Choose a destination on the map (tap or click; Shift adds a waypoint), or use the arrow keys and Enter.
                {targeting.cursor !== null && <> Cursor: <span data-testid="target-cursor">{cellLabel(view, targeting.cursor)}</span>.</>}
              </p>
            ) : (
              <>
                <p data-testid="route-destination">
                  Destination {cellLabel(view, targeting.waypoints.at(-1) ?? 0)}
                  {targeting.waypoints.length > 1 && ` via ${targeting.waypoints.length - 1} waypoint(s)`}
                </p>
                {preview?.direct.ok === false && (
                  <p role="alert" data-testid="route-failure">
                    No legal route: {preview.direct.failure === 'BUDGET_EXCEEDED' ? 'search budget exceeded, choose a closer waypoint' : 'the body cannot reach that destination from what you know'}.
                  </p>
                )}
                {preview?.direct.ok && (
                  <>
                    <fieldset className="cg-stance">
                      <legend>Route</legend>
                      {preview.safe === null ? (
                        <p>No hazards on the shortest route ({preview.direct.totalAp} AP).</p>
                      ) : (
                        <>
                          <label>
                            <input type="radio" name="route-mode" checked={mode === 'SAFE'} disabled={!preview.safe.ok}
                              onChange={() => setTargeting({ ...targeting, routeMode: 'SAFE', consentGiven: false })} />
                            safe {preview.safe.ok ? `(${preview.safe.totalAp} AP, needs no consent)` : '(no route avoids the hazards)'}
                          </label>
                          <label>
                            <input type="radio" name="route-mode" checked={mode === 'DIRECT'} data-testid="route-direct"
                              onChange={() => setTargeting({ ...targeting, routeMode: 'DIRECT', consentGiven: false })} />
                            direct ({preview.direct.totalAp} AP, needs consent)
                          </label>
                        </>
                      )}
                    </fieldset>
                    {plan && (
                      <dl className="cg-facts" data-testid="route-costs">
                        <dt>Certain cost</dt><dd>{plan.totalAp} AP, {plan.totalAp} extra nutrition</dd>
                        <dt>Estimate</dt><dd>about {preview.estimate?.turns ?? '?'} turn(s) at {preview.estimate?.apPerTurn ?? '?'} AP/turn</dd>
                        <dt>Unknown</dt><dd>{plan.uncertain.length > 0 ? `passes ${plan.uncertain.length} unobserved cell(s); may stop at what it finds` : 'fully observed'}</dd>
                      </dl>
                    )}
                    {consentNeeded && plan && (
                      <div className="cg-warning" role="alert" data-testid="route-warning">
                        <p>
                          Safety warning: this route tramples farmland at {plan.civilianCollateral.map((c) => cellLabel(view, c)).join(', ') || 'no cells'}
                          {plan.trespass.length > 0 && ` and enters foreign claims at ${plan.trespass.map((c) => cellLabel(view, c)).join(', ')}`}.
                          Fields worked by your people will be disturbed.
                          {preview.safe?.ok ? ' A safe route exists.' : ' No route avoids these cells.'}
                        </p>
                        <label>
                          <input type="checkbox" checked={targeting.consentGiven} data-testid="consent-checkbox"
                            onChange={(event) => setTargeting({ ...targeting, consentGiven: event.target.checked })} />
                          I accept the listed damage for this route only
                        </label>
                      </div>
                    )}
                    <label className="cg-select">
                      On arrival{' '}
                      <select value={targeting.then ?? ''} onChange={(event) => setTargeting({ ...targeting, then: event.target.value === '' ? null : (event.target.value as 'FEED' | 'REST') })}>
                        <option value="">hold</option>
                        <option value="FEED">feed</option>
                        <option value="REST">rest</option>
                      </select>
                    </label>
                  </>
                )}
              </>
            )}
            <div className="cg-actions">
              <button type="button" className="cg-button cg-button--primary" onClick={confirmRoute} disabled={!plan || (consentNeeded && !targeting.consentGiven)} data-testid="confirm-route">
                Confirm order
              </button>
              <button type="button" className="cg-button" onClick={cancelTargeting}>Cancel (Esc)</button>
            </div>
          </section>
        )}

        {drafts.length > 0 && (
          <section className="cg-panel" aria-labelledby="cg-drafts-heading">
            <h2 id="cg-drafts-heading">Orders for next turn</h2>
            <ul className="cg-drafts" data-testid="draft-list">
              {drafts.map((draft) => (
                <li key={draft.commandId}>
                  {describeDraft(view, draft)}{' '}
                  <button type="button" className="cg-button cg-button--small" onClick={() => session.removeDraft(draft.commandId)}>Remove</button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="cg-panel" aria-labelledby="cg-report-heading">
          <h2 id="cg-report-heading">Turn report</h2>
          <p aria-live="polite" data-testid="turn-report">{announcement || 'No turns resolved yet.'}</p>
          {lastResolution && lastResolution.rejections.some((r) => r.commandId.startsWith('h')) && (
            <ul>{lastResolution.rejections.filter((r) => r.commandId.startsWith('h')).map((r) => <li key={r.commandId}>{r.code}: {r.reason}</li>)}</ul>
          )}
        </section>
        {debug && (
          <details className="cg-panel" data-testid="debug-log">
            <summary>Debug: session command log (reveals AI commands)</summary>
            <textarea readOnly rows={6} value={JSON.stringify(session.exportLog())} data-testid="command-log" aria-label="Session command log JSON" />
          </details>
        )}
        {children}
      </aside>
    </div>
  );
}
