import { useEffect, useMemo, useRef, useState } from 'react';
import { ServerControls } from '@/components/ServerControls';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { type LogLine, openLogsSocket, type StatusSnapshot } from '@/lib/ws';

const MAX_LINES_IN_DOM = 4000;

interface ConsoleState {
  status: StatusSnapshot;
  logs: LogLine[];
  connected: boolean;
}

const initialStatus: StatusSnapshot = {
  state: 'stopped',
  pid: null,
  startedAt: null,
  exitCode: null,
  installDir: null,
  serverName: '',
};

export function Console(): JSX.Element {
  const [state, setState] = useState<ConsoleState>({
    status: initialStatus,
    logs: [],
    connected: false,
  });
  const [command, setCommand] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);
  const [autoscroll, setAutoscroll] = useState(true);
  const logBoxRef = useRef<HTMLDivElement>(null);

  // Stable refs for the WS handlers so we don't re-open on each render.
  useEffect(() => {
    let stopped = false;
    let reconnectTimer: number | null = null;

    function connect(): WebSocket {
      const ws = openLogsSocket({
        onOpen: () => setState((s) => ({ ...s, connected: true })),
        onClose: () => {
          setState((s) => ({ ...s, connected: false }));
          if (!stopped) {
            reconnectTimer = window.setTimeout(connect, 2000);
          }
        },
        onEvent: (ev) => {
          setState((s) => {
            if (ev.type === 'snapshot') {
              return { ...s, status: ev.status, logs: ev.logs };
            }
            if (ev.type === 'status') {
              return { ...s, status: ev.status };
            }
            if (ev.type === 'log') {
              const next = [...s.logs, ev.log];
              if (next.length > MAX_LINES_IN_DOM) {
                next.splice(0, next.length - MAX_LINES_IN_DOM);
              }
              return { ...s, logs: next };
            }
            return s;
          });
        },
      });
      return ws;
    }

    const ws = connect();
    return () => {
      stopped = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      ws.close();
    };
  }, []);

  useEffect(() => {
    if (autoscroll && logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
    }
  }, [state.logs, autoscroll]);

  function handleScroll(): void {
    const el = logBoxRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoscroll(atBottom);
  }

  async function sendCommand(): Promise<void> {
    const cmd = command.trim();
    if (!cmd) return;
    setCommand('');
    setHistory((h) => (h.at(-1) === cmd ? h : [...h, cmd]));
    setHistoryIdx(null);
    try {
      await api('/api/server/command', {
        method: 'POST',
        body: JSON.stringify({ command: cmd }),
      });
    } catch (err) {
      // The error will surface as a sys log if the backend chose to log it;
      // otherwise we still keep the UI usable.
      console.warn('command failed', err);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'ArrowUp') {
      if (history.length === 0) return;
      e.preventDefault();
      const idx = historyIdx === null ? history.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(idx);
      setCommand(history[idx] ?? '');
    } else if (e.key === 'ArrowDown') {
      if (historyIdx === null) return;
      e.preventDefault();
      const idx = historyIdx + 1;
      if (idx >= history.length) {
        setHistoryIdx(null);
        setCommand('');
      } else {
        setHistoryIdx(idx);
        setCommand(history[idx] ?? '');
      }
    }
  }

  const canSendCommand = state.status.state === 'running' || state.status.state === 'starting';
  const uptime = useUptime(state.status.startedAt);

  return (
    <div className="container mx-auto space-y-4 p-6">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold">Console</h2>
          <StatusBadge state={state.status.state} />
          {state.status.pid && (
            <span className="text-xs text-muted-foreground">pid {state.status.pid}</span>
          )}
          {uptime && <span className="text-xs text-muted-foreground">up {uptime}</span>}
          {!state.connected && (
            <span className="text-xs text-orange-400">log stream disconnected</span>
          )}
        </div>
        <ServerControls state={state.status.state} />
      </header>

      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between border-b border-border py-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Live output — {state.logs.length} lines
          </CardTitle>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setAutoscroll(true);
              if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
            }}
          >
            {autoscroll ? 'Autoscroll: on' : 'Jump to bottom'}
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <div
            ref={logBoxRef}
            onScroll={handleScroll}
            className="h-[60vh] overflow-y-auto bg-black/60 p-3 font-mono text-xs leading-5"
          >
            {state.logs.length === 0 ? (
              <p className="text-muted-foreground">No output yet. Start the server to see logs.</p>
            ) : (
              state.logs.map((line) => (
                <div
                  key={line.id}
                  className={cn(
                    'whitespace-pre-wrap',
                    line.source === 'err' && 'text-red-400',
                    line.source === 'sys' && 'text-amber-300',
                    line.source === 'out' && 'text-zinc-100',
                  )}
                >
                  {line.text}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void sendCommand();
        }}
        className="flex items-center gap-2"
      >
        <span className="font-mono text-sm text-muted-foreground">{'>'}</span>
        <Input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            canSendCommand
              ? 'Type a command (kick player, save, additem, quit…) and press Enter'
              : 'Server must be running to send commands'
          }
          disabled={!canSendCommand}
          className="font-mono"
        />
        <Button type="submit" disabled={!canSendCommand || !command.trim()}>
          Send
        </Button>
      </form>
    </div>
  );
}

function useUptime(startedAt: number | null): string | null {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const i = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(i);
  }, [startedAt]);
  return useMemo(() => {
    if (!startedAt) return null;
    const s = Math.floor((Date.now() - startedAt) / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m${String(sec).padStart(2, '0')}s`;
  }, [startedAt]);
}
