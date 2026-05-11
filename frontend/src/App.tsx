import { useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { getToken } from '@/lib/auth';
import { Config } from '@/pages/Config';
import { Console } from '@/pages/Console';
import { Dashboard } from '@/pages/Dashboard';
import { Install } from '@/pages/Install';
import { Login } from '@/pages/Login';
import { Mods } from '@/pages/Mods';
import { Players } from '@/pages/Players';

export function App(): JSX.Element {
  const [authed, setAuthed] = useState<boolean>(() => getToken() !== null);

  if (!authed) {
    return <Login onAuthenticated={() => setAuthed(true)} />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout onLogout={() => setAuthed(false)} />}>
          <Route index element={<Dashboard />} />
          <Route path="console" element={<Console />} />
          <Route path="install" element={<Install />} />
          <Route path="config" element={<Config />} />
          <Route path="players" element={<Players />} />
          <Route path="mods" element={<Mods />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
