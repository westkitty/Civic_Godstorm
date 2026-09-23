import { useEffect, useRef } from 'react';
import { RendererHost, type RendererStatus } from '../render/RendererHost.ts';

interface WorldViewProps {
  readonly onStatus: (status: RendererStatus) => void;
  readonly onFailure: (error: Error) => void;
}

/** Mounts the single RendererHost for the lifetime of this component and disposes it on unmount. */
export function WorldView({ onStatus, onFailure }: WorldViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let host: RendererHost;
    try {
      host = new RendererHost({ canvas, onStatus });
    } catch (error: unknown) {
      onFailure(error instanceof Error ? error : new Error(String(error)));
      return undefined;
    }
    return () => host.dispose();
  }, [onStatus, onFailure]);
  return (
    <canvas
      ref={canvasRef}
      className="cg-world__canvas"
      data-testid="world-canvas"
      aria-label="World view. Development placeholder for the unimplemented terrain recipe CG-R-TERRAIN."
      role="img"
    />
  );
}
