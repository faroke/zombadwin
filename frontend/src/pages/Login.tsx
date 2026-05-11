import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { setToken } from '@/lib/auth';

interface LoginProps {
  onAuthenticated: () => void;
}

export function Login({ onAuthenticated }: LoginProps): JSX.Element {
  const [token, setTokenInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const cleanToken = token.trim();
    if (!cleanToken) return;
    setBusy(true);
    setError(null);
    try {
      // Probe an authenticated route to validate the token before persisting it.
      const res = await fetch('/api/server/status', {
        headers: { Authorization: `Bearer ${cleanToken}` },
      });
      if (res.status === 401) {
        setError('Invalid token.');
        return;
      }
      // 404 or 200 both mean auth passed (route may not exist yet).
      setToken(cleanToken);
      onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            <CardTitle>zombadwin</CardTitle>
          </div>
          <CardDescription>
            Paste the bearer token from the backend startup log to sign in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <Input
              type="password"
              placeholder="Bearer token"
              value={token}
              onChange={(e) => setTokenInput(e.target.value)}
              autoFocus
              required
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={busy || !token} className="w-full">
              {busy ? 'Checking…' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
