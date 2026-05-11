import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  ChevronRight,
  Edit2,
  Plus,
  Server as ServerIcon,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

interface ProfileSummary {
  name: string;
  hasIni: boolean;
  hasSandbox: boolean;
  hasSave: boolean;
  iniBytes: number | null;
  iniModifiedAt: number | null;
}

interface ProfilesResponse {
  activeServer: string;
  profiles: ProfileSummary[];
}

interface ServerStatus {
  state: 'stopped' | 'starting' | 'running' | 'stopping';
}

export function Servers(): JSX.Element {
  const qc = useQueryClient();
  const profiles = useQuery({
    queryKey: ['profiles'],
    queryFn: () => api<ProfilesResponse>('/api/servers'),
  });
  const status = useQuery({
    queryKey: ['server-status'],
    queryFn: () => api<ServerStatus>('/api/server/status'),
    refetchInterval: 3000,
  });

  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);

  function notify(ok: boolean, text: string): void {
    setFeedback({ ok, text });
    setTimeout(() => setFeedback(null), 4000);
  }

  const create = useMutation({
    mutationFn: (name: string) =>
      api('/api/servers', { method: 'POST', body: JSON.stringify({ name }) }),
    onSuccess: (_, name) => {
      notify(true, `Profile "${name}" created.`);
      setNewName('');
      void qc.invalidateQueries({ queryKey: ['profiles'] });
    },
    onError: (err: Error) =>
      notify(false, err instanceof ApiError ? `Create failed (${err.status})` : err.message),
  });

  const setActive = useMutation({
    mutationFn: (name: string) =>
      api('/api/servers/active', { method: 'POST', body: JSON.stringify({ name }) }),
    onSuccess: (_, name) => {
      notify(true, `Active profile is now "${name}".`);
      // Most editors keyed by active profile must refetch.
      void qc.invalidateQueries({ queryKey: ['profiles'] });
      void qc.invalidateQueries({ queryKey: ['config-ini'] });
      void qc.invalidateQueries({ queryKey: ['config-sandbox'] });
      void qc.invalidateQueries({ queryKey: ['mods'] });
      void qc.invalidateQueries({ queryKey: ['players'] });
      void qc.invalidateQueries({ queryKey: ['saves'] });
    },
    onError: (err: Error) =>
      notify(false, err instanceof ApiError ? `Switch failed (${err.status})` : err.message),
  });

  const remove = useMutation({
    mutationFn: (name: string) => api(`/api/servers/${encodeURIComponent(name)}`, { method: 'DELETE' }),
    onSuccess: (_, name) => {
      notify(true, `Profile "${name}" deleted.`);
      void qc.invalidateQueries({ queryKey: ['profiles'] });
    },
    onError: (err: Error) =>
      notify(false, err instanceof ApiError ? `Delete failed (${err.status})` : err.message),
  });

  const rename = useMutation({
    mutationFn: (vars: { from: string; to: string }) =>
      api(`/api/servers/${encodeURIComponent(vars.from)}/rename`, {
        method: 'POST',
        body: JSON.stringify({ newName: vars.to }),
      }),
    onSuccess: (_, vars) => {
      notify(true, `Renamed "${vars.from}" → "${vars.to}".`);
      setRenaming(null);
      void qc.invalidateQueries({ queryKey: ['profiles'] });
    },
    onError: (err: Error) =>
      notify(false, err instanceof ApiError ? `Rename failed (${err.status})` : err.message),
  });

  const isRunning = status.data?.state !== 'stopped';

  return (
    <div className="container mx-auto space-y-4 p-6">
      <header>
        <h1 className="text-2xl font-bold">Server profiles</h1>
        <p className="text-sm text-muted-foreground">
          Each profile keeps its own <code>.ini</code>, <code>SandboxVars.lua</code>, mods and
          saves. One profile is active at a time — its config is what Start launches.
          {isRunning && (
            <span className="ml-1 text-amber-400">
              Server is currently running, switching/renaming/deleting is disabled.
            </span>
          )}
        </p>
      </header>

      {feedback && (
        <div
          className={cn(
            'rounded-md border px-3 py-2 text-sm',
            feedback.ok
              ? 'border-primary/40 bg-primary/10 text-primary'
              : 'border-destructive/40 bg-destructive/10 text-destructive',
          )}
        >
          {feedback.text}
        </div>
      )}

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Plus className="h-4 w-4" />
            New profile
          </CardTitle>
          <CardDescription>
            A name with letters, digits, <code>_</code> or <code>-</code> (1-32 chars). PZ creates
            the matching INI on the next Start.
          </CardDescription>
        </CardHeader>
        <CardContent className="py-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!newName.trim()) return;
              create.mutate(newName.trim());
            }}
            className="flex items-center gap-2"
          >
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="my-server"
              className="font-mono"
              maxLength={32}
            />
            <Button type="submit" disabled={!newName.trim() || create.isPending}>
              Create
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ServerIcon className="h-4 w-4" />
            Profiles ({profiles.data?.profiles.length ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {profiles.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : profiles.data?.profiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">No profiles.</p>
          ) : (
            profiles.data?.profiles.map((p) => {
              const isActive = profiles.data?.activeServer === p.name;
              const isRenaming = renaming?.from === p.name;
              return (
                <div
                  key={p.name}
                  className={cn(
                    'flex flex-wrap items-center gap-2 rounded-md border bg-card p-3 text-sm',
                    isActive ? 'border-primary/60' : 'border-border',
                  )}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    {isActive ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    {isRenaming ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (renaming.to.trim()) rename.mutate(renaming);
                        }}
                        className="flex items-center gap-2"
                      >
                        <Input
                          value={renaming.to}
                          onChange={(e) =>
                            setRenaming((r) => (r ? { ...r, to: e.target.value } : null))
                          }
                          autoFocus
                          className="h-7 font-mono"
                          maxLength={32}
                        />
                        <Button type="submit" size="sm" disabled={!renaming.to.trim()}>
                          Save
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setRenaming(null)}
                        >
                          Cancel
                        </Button>
                      </form>
                    ) : (
                      <span className="truncate font-mono font-medium">{p.name}</span>
                    )}
                    <ProfileTags profile={p} />
                  </div>
                  {!isRenaming && (
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isActive || isRunning || setActive.isPending}
                        onClick={() => setActive.mutate(p.name)}
                      >
                        Set active
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Rename"
                        disabled={isRunning}
                        onClick={() => setRenaming({ from: p.name, to: p.name })}
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Delete"
                        disabled={isActive || isRunning}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Delete profile "${p.name}"? This removes the INI/SandboxVars but keeps the save directory.`,
                            )
                          ) {
                            remove.mutate(p.name);
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ProfileTags({ profile }: { profile: ProfileSummary }): JSX.Element {
  const tags: Array<{ label: string; on: boolean }> = [
    { label: 'INI', on: profile.hasIni },
    { label: 'Sandbox', on: profile.hasSandbox },
    { label: 'Save', on: profile.hasSave },
  ];
  return (
    <div className="flex shrink-0 items-center gap-1">
      {tags.map((t) => (
        <span
          key={t.label}
          className={cn(
            'rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wider',
            t.on
              ? 'border-primary/40 bg-primary/10 text-primary'
              : 'border-border text-muted-foreground/70',
          )}
        >
          {t.label}
        </span>
      ))}
    </div>
  );
}
