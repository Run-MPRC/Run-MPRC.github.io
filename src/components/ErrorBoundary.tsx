import React from 'react';
import { captureException } from '../services/monitoring/sentry';
import {
  clientFailureEvents,
  reportClientFailure,
} from '../services/monitoring/clientDiagnostics';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    reportClientFailure(clientFailureEvents.renderFailed);
    try {
      captureException(error);
    } catch {
      // Best-effort monitoring must not replace the recovery UI.
    }
  }

  handleReset = () => {
    this.setState({ hasError: false });
  };

  render() {
    const { hasError } = this.state;
    const { children } = this.props;
    if (!hasError) return children;
    return (
      <div className="container mx-auto p-6 max-w-xl text-center">
        <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
        <p
          className="text-gray-700 mb-4"
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          Try again, and contact an MPRC officer if this keeps happening.
        </p>
        <div className="flex gap-2 justify-center">
          <button
            type="button"
            onClick={this.handleReset}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
          >
            Try again
          </button>
          <a
            href="/"
            className="border px-4 py-2 rounded hover:bg-gray-50"
          >
            Go home
          </a>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
