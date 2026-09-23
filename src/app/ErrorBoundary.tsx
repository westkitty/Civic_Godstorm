import { Component, type ErrorInfo, type ReactNode } from 'react';
import { FatalScreen } from '../ui/FatalScreen.tsx';

interface Props {
  readonly children: ReactNode;
}

interface State {
  readonly error: Error | null;
}

/** Last-resort boundary: an unexpected UI failure becomes an explained, recoverable screen. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('CIVIC GODSTORM fatal UI error', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <FatalScreen
          title="The interface stopped unexpectedly"
          code="UI_FATAL"
          detail={this.state.error.message}
          actionLabel="Reload"
          onAction={() => window.location.reload()}
        />
      );
    }
    return this.props.children;
  }
}
