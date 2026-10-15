import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from './Button';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-paper flex items-center justify-center p-4">
          <div className="w-full max-w-md p-6 bg-paper rounded-[var(--radius-card)] border border-line shadow-sm text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-coral-tint text-coral flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-ink">Something went wrong</h1>
              <p className="text-sm text-slate mt-1">
                An unexpected error occurred. Reload the page to resume your session.
              </p>
            </div>
            <div className="pt-2">
              <Button
                variant="primary"
                onClick={this.handleReload}
                className="w-full justify-center"
              >
                <RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" />
                Reload page
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
