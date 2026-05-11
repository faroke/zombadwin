import { useState } from 'react';
import { Dashboard } from '@/pages/Dashboard';
import { Login } from '@/pages/Login';
import { getToken } from '@/lib/auth';

export function App(): JSX.Element {
  const [authed, setAuthed] = useState<boolean>(() => getToken() !== null);
  return authed ? (
    <Dashboard onLogout={() => setAuthed(false)} />
  ) : (
    <Login onAuthenticated={() => setAuthed(true)} />
  );
}
