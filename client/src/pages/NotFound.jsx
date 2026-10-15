import React from 'react';
import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';
import { Button } from '../components/ui/Button';

export function NotFound() {
  return (
    <div className="min-h-screen bg-paper flex items-center justify-center p-4">
      <div className="w-full max-w-md p-8 bg-paper rounded-[var(--radius-card)] border border-line text-center space-y-4">
        <span className="font-dot text-6xl text-slate select-none">404</span>
        <h1 className="text-xl font-bold text-ink">Page not found</h1>
        <p className="text-sm text-slate">
          The page you requested does not exist or may have moved.
        </p>
        <div className="pt-3">
          <Link to="/">
            <Button variant="primary" className="w-full justify-center">
              <Home className="w-4 h-4 mr-2" aria-hidden="true" />
              Return to queue
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default NotFound;
