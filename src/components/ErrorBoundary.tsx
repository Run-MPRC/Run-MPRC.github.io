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
  error: Error | null;
}

class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    captureException(error);
    reportClientFailure(clientFailureEvents.renderFailed);
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    const { children } = this.props;
    if (!error) return children;
    return (
      <div className="container mx-auto p-6 max-w-xl text-center">
        <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
        <p className="text-gray-700 mb-4">
          We hit an unexpected error rendering this page. The team has been notified.
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
        {process.env.NODE_ENV === 'development' && (
          <pre className="mt-6 text-left text-xs text-red-700 bg-red-50 p-3 rounded overflow-auto max-h-64">
            {error.message}
            {'\n\n'}
            {error.stack}
          </pre>
        )}
      </div>
    );
  }
}

export default ErrorBoundary;
