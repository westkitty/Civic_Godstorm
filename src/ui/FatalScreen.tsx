import { useEffect, useRef, type ReactNode } from 'react';

interface FatalScreenProps {
  readonly title: string;
  readonly code: string;
  readonly detail: string;
  readonly actionLabel: string;
  readonly onAction: () => void;
  readonly children?: ReactNode;
}

/** Accessible blocking error surface: announced as an alert, with a focused recovery action. */
export function FatalScreen({ title, code, detail, actionLabel, onAction, children }: FatalScreenProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  return (
    <main className="cg-fatal" aria-labelledby="cg-fatal-title">
      <div role="alert" className="cg-fatal__panel">
        <p className="cg-eyebrow">CIVIC GODSTORM</p>
        <h1 id="cg-fatal-title" ref={headingRef} tabIndex={-1}>
          {title}
        </h1>
        <p>{detail}</p>
        {children}
        <p className="cg-fatal__code">
          Error code: <code>{code}</code>
        </p>
        <button type="button" className="cg-button" onClick={onAction}>
          {actionLabel}
        </button>
      </div>
    </main>
  );
}
