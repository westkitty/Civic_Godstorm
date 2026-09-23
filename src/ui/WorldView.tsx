import { useEffect, useRef } from 'react';
import { RendererHost, type CellActivation, type RendererStatus } from '../render/RendererHost.ts';
import type { WorldSnapshot } from '../render/worldSnapshot.ts';

interface WorldViewProps {
  readonly snapshot: WorldSnapshot | null;
  readonly onStatus: (status: RendererStatus) => void;
  readonly onFailure: (error: Error) => void;
  readonly onCellActivate?: (activation: CellActivation) => void;
  readonly onHost?: (host: RendererHost | null) => void;
  readonly label: string;
}

/** Mounts the single RendererHost for the lifetime of this component and disposes it on unmount. */
export function WorldView({ snapshot, onStatus, onFailure, onCellActivate, onHost, label }: WorldViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<RendererHost | null>(null);
  const activateRef = useRef(onCellActivate);
  useEffect(() => {
    activateRef.current = onCellActivate;
  }, [onCellActivate]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let host: RendererHost;
    try {
      host = new RendererHost({ canvas, onStatus, onCellActivate: (activation) => activateRef.current?.(activation) });
    } catch (error: unknown) {
      onFailure(error instanceof Error ? error : new Error(String(error)));
      return undefined;
    }
    hostRef.current = host;
    onHost?.(host);
    return () => {
      onHost?.(null);
      hostRef.current = null;
      host.dispose();
    };
  }, [onStatus, onFailure, onHost]);

  useEffect(() => {
    if (snapshot) hostRef.current?.setSnapshot(snapshot);
  }, [snapshot]);

  return <canvas ref={canvasRef} className="cg-world__canvas" data-testid="world-canvas" aria-label={label} role="img" />;
}
