import { useState } from 'react';
import { IniEditor } from '@/components/IniEditor';
import { SandboxEditor } from '@/components/SandboxEditor';
import { cn } from '@/lib/utils';

type Tab = 'ini' | 'sandbox';

const TABS: Array<{ id: Tab; label: string; description: string }> = [
  { id: 'ini', label: 'Server (INI)', description: 'servertest.ini — connection, players, RCON, mods' },
  { id: 'sandbox', label: 'Sandbox vars', description: 'SandboxVars.lua — gameplay difficulty and world rules' },
];

export function Config(): JSX.Element {
  const [tab, setTab] = useState<Tab>('ini');
  const active = TABS.find((t) => t.id === tab);

  return (
    <div className="container mx-auto p-6">
      <header className="mb-4">
        <h1 className="text-2xl font-bold">Server configuration</h1>
        <p className="text-sm text-muted-foreground">{active?.description}</p>
      </header>

      <div className="mb-4 inline-flex rounded-md border border-border bg-card p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'rounded px-4 py-1.5 text-sm font-medium transition-colors',
              tab === t.id
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'ini' ? <IniEditor /> : <SandboxEditor />}
    </div>
  );
}
