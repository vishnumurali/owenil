import * as React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { isChunkLoadError } from '@/lib/lazy-page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

interface State {
  error: Error | null;
}

/**
 * Catches errors while showing a page so the app never turns into a blank
 * screen. AppShell keys it by path, so moving to another page resets it.
 */
export class RouteErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error) {
    console.error('Page failed to render', error);
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const updated = isChunkLoadError(error);
    return (
      <Card role="alert" className="mx-auto mt-6 max-w-lg p-6 text-center">
        <AlertTriangle className="mx-auto size-8 text-warning" aria-hidden />
        <h1 className="mt-3 text-lg font-semibold">{updated ? 'Owenil was just updated' : 'This page couldn’t be shown'}</h1>
        <p className="mt-1 text-sm text-fg-muted">
          {updated ? 'Reload to get the latest version. Your data is safe.' : 'Something went wrong while showing this page. Reloading usually fixes it, and your data is safe.'}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Button onClick={() => window.location.reload()}>
            <RefreshCw /> Reload
          </Button>
          <Button variant="outline" asChild>
            <Link to="/dashboard" onClick={() => this.setState({ error: null })}>Go to dashboard</Link>
          </Button>
        </div>
      </Card>
    );
  }
}
