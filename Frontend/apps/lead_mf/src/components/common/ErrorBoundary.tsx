import { Component, type ReactNode } from 'react';
import styles from './ErrorBoundary.module.css';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: any) {
    console.error('[lead_mf] Uncaught error in micro-frontend:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className={styles.panel}>
          <h2 className={styles.heading}>Lead Management Error</h2>
          <p className={styles.message}>{this.state.error?.message || 'An error occurred while rendering the Lead Management micro-frontend.'}</p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false })}
            className={styles.retryBtn}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
