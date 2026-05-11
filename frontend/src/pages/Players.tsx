import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  CheckCircle2,
  ListChecks,
  Megaphone,
  RefreshCw,
  Save,
  ShieldCheck,
  UserX,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Player {
  id: number;
  name: string;
}

interface PlayersResponse {
  ok: true;
  players: Player[];
  queriedAt: number;
}

const ACCESS_LEVELS = ['admin', 'moderator', 'overseer', 'gm', 'observer', 'none'] as const;
type AccessLevel = (typeof ACCESS_LEVELS)[number];

function Toast({ feedback }: { feedback: { ok: boolean; text: string } | null }): JSX.Element | null {
  if (!feedback) return null;
  return (
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
  );
}

export function Players(): JSX.Element {
  const qc = useQueryClient();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const list = useQuery({
    queryKey: ['players'],
    queryFn: () => api<PlayersResponse>('/api/players'),
    retry: false,
  });

  function notify(ok: boolean, text: string): void {
    setFeedback({ ok, text });
    setTimeout(() => setFeedback(null), 4000);
  }

  function mutationHandlers(label: (body: unknown) => string) {
    return {
      onSuccess: (_data: unknown, body: unknown) => {
        notify(true, `${label(body)} — done`);
        void qc.invalidateQueries({ queryKey: ['players'] });
      },
      onError: (err: Error, body: unknown) => {
        notify(
          false,
          err instanceof ApiError ? `${label(body)} failed (${err.status})` : err.message,
        );
      },
    };
  }

  const kick = useMutation({
    mutationFn: (body: { username: string; reason?: string }) =>
      api('/api/players/kick', { method: 'POST', body: JSON.stringify(body) }),
    ...mutationHandlers((b) => `Kick ${(b as { username: string }).username}`),
  });
  const ban = useMutation({
    mutationFn: (body: { username: string; reason?: string; byIp?: boolean }) =>
      api('/api/players/ban', { method: 'POST', body: JSON.stringify(body) }),
    ...mutationHandlers((b) => {
      const x = b as { username: string; byIp?: boolean };
      return `Ban ${x.username}${x.byIp ? ' (IP)' : ''}`;
    }),
  });
  const unban = useMutation({
    mutationFn: (body: { username: string }) =>
      api('/api/players/unban', { method: 'POST', body: JSON.stringify(body) }),
    ...mutationHandlers((b) => `Unban ${(b as { username: string }).username}`),
  });
  const access = useMutation({
    mutationFn: (body: { username: string; level: AccessLevel }) =>
      api('/api/players/access', { method: 'POST', body: JSON.stringify(body) }),
    ...mutationHandlers((b) => {
      const x = b as { username: string; level: AccessLevel };
      return `Set ${x.username} to ${x.level}`;
    }),
  });
  const whitelist = useMutation({
    mutationFn: (body: { username: string; add: boolean }) =>
      api('/api/players/whitelist', { method: 'POST', body: JSON.stringify(body) }),
    ...mutationHandlers((b) => {
      const x = b as { username: string; add: boolean };
      return `${x.add ? 'Add' : 'Remove'} ${x.username} ${x.add ? 'to' : 'from'} whitelist`;
    }),
  });
  const message = useMutation({
    mutationFn: (body: { message: string }) =>
      api('/api/players/message', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => notify(true, 'Message sent'),
    onError: (err: Error) =>
      notify(false, err instanceof ApiError ? `Send failed (${err.status})` : err.message),
  });
  const save = useMutation({
    mutationFn: () => api('/api/players/save', { method: 'POST' }),
    onSuccess: () => notify(true, 'Save command sent'),
    onError: (err: Error) =>
      notify(false, err instanceof ApiError ? `Save failed (${err.status})` : err.message),
  });

  const listError =
    list.error instanceof ApiError
      ? `Cannot query players (HTTP ${list.error.status}). Is the server running?`
      : list.error instanceof Error
        ? list.error.message
        : null;

  return (
    <div className="container mx-auto space-y-4 p-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Players</h1>
          <p className="text-sm text-muted-foreground">
            Connected players and admin actions (commands sent through the server's stdin).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => list.refetch()}
            disabled={list.isFetching}
          >
            <RefreshCw className={cn('mr-2 h-4 w-4', list.isFetching && 'animate-spin')} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => save.mutate()}>
            <Save className="mr-2 h-4 w-4" />
            Force save
          </Button>
        </div>
      </header>

      <Toast feedback={feedback} />

      <BroadcastBox onSend={(msg) => message.mutate({ message: msg })} disabled={message.isPending} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connected players</CardTitle>
          <CardDescription>
            Refreshed on demand. Querying takes ~1s because PZ replies via stdout.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {listError ? (
            <p className="text-sm text-destructive">{listError}</p>
          ) : list.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : list.data?.players.length === 0 ? (
            <p className="text-sm text-muted-foreground">No players currently connected.</p>
          ) : (
            <div className="space-y-2">
              {list.data?.players.map((p) => (
                <PlayerRow
                  key={`${p.id}-${p.name}`}
                  player={p}
                  onKick={(reason) => kick.mutate({ username: p.name, reason })}
                  onBan={(reason, byIp) => ban.mutate({ username: p.name, reason, byIp })}
                  onAccess={(level) => access.mutate({ username: p.name, level })}
                  onWhitelist={(add) => whitelist.mutate({ username: p.name, add })}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <OfflineActions
        onUnban={(username) => unban.mutate({ username })}
        onAccess={(username, level) => access.mutate({ username, level })}
        onWhitelist={(username, add) => whitelist.mutate({ username, add })}
      />
    </div>
  );
}

function BroadcastBox({
  onSend,
  disabled,
}: {
  onSend: (m: string) => void;
  disabled: boolean;
}): JSX.Element {
  const [draft, setDraft] = useState('');
  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Megaphone className="h-4 w-4" />
          Server-wide message
        </CardTitle>
      </CardHeader>
      <CardContent className="py-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            onSend(draft.trim());
            setDraft('');
          }}
          className="flex items-center gap-2"
        >
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Server will restart in 5 minutes for maintenance"
          />
          <Button type="submit" disabled={!draft.trim() || disabled}>
            Send
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function PlayerRow({
  player,
  onKick,
  onBan,
  onAccess,
  onWhitelist,
}: {
  player: Player;
  onKick: (reason: string) => void;
  onBan: (reason: string, byIp: boolean) => void;
  onAccess: (level: AccessLevel) => void;
  onWhitelist: (add: boolean) => void;
}): JSX.Element {
  const [reason, setReason] = useState('');
  const [level, setLevel] = useState<AccessLevel>('none');

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-3">
      <div className="flex-1">
        <div className="font-mono text-sm font-medium">{player.name}</div>
        <div className="text-xs text-muted-foreground">id {player.id}</div>
      </div>
      <Input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (optional)"
        className="w-56"
      />
      <select
        value={level}
        onChange={(e) => setLevel(e.target.value as AccessLevel)}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
      >
        {ACCESS_LEVELS.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onAccess(level)}
          title={`Set access level to ${level}`}
        >
          <ShieldCheck className="mr-1 h-3.5 w-3.5" />
          Set role
        </Button>
        <Button size="sm" variant="outline" onClick={() => onKick(reason)}>
          <UserX className="mr-1 h-3.5 w-3.5" />
          Kick
        </Button>
        <Button size="sm" variant="destructive" onClick={() => onBan(reason, false)}>
          <Ban className="mr-1 h-3.5 w-3.5" />
          Ban
        </Button>
        <Button size="sm" variant="destructive" onClick={() => onBan(reason, true)}>
          <Ban className="mr-1 h-3.5 w-3.5" />
          Ban IP
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onWhitelist(true)} title="Add to whitelist">
          <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
          WL +
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onWhitelist(false)} title="Remove from whitelist">
          <XCircle className="mr-1 h-3.5 w-3.5" />
          WL -
        </Button>
      </div>
    </div>
  );
}

function OfflineActions({
  onUnban,
  onAccess,
  onWhitelist,
}: {
  onUnban: (username: string) => void;
  onAccess: (username: string, level: AccessLevel) => void;
  onWhitelist: (username: string, add: boolean) => void;
}): JSX.Element {
  const [username, setUsername] = useState('');
  const [level, setLevel] = useState<AccessLevel>('admin');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ListChecks className="h-4 w-4" />
          Actions on offline players
        </CardTitle>
        <CardDescription>
          Unban a player, grant a role, or manage the whitelist for someone who's not connected.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            className="w-64"
          />
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value as AccessLevel)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            {ACCESS_LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={!username.trim()}
            onClick={() => onAccess(username.trim(), level)}
          >
            Set role
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!username.trim()}
            onClick={() => onUnban(username.trim())}
          >
            Unban
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!username.trim()}
            onClick={() => onWhitelist(username.trim(), true)}
          >
            Whitelist +
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!username.trim()}
            onClick={() => onWhitelist(username.trim(), false)}
          >
            Whitelist -
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
