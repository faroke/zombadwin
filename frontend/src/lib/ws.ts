import { getToken } from './auth';

export interface LogLine {
  id: number;
  ts: number;
  source: 'out' | 'err' | 'sys';
  text: string;
}

export type ServerState = 'stopped' | 'starting' | 'running' | 'stopping';

export interface StatusSnapshot {
  state: ServerState;
  pid: number | null;
  startedAt: number | null;
  exitCode: number | null;
  installDir: string | null;
  serverName: string;
}

export type LogsEvent =
  | { type: 'snapshot'; logs: LogLine[]; status: StatusSnapshot }
  | { type: 'log'; log: LogLine }
  | { type: 'status'; status: StatusSnapshot }
  | { type: 'error'; message: string };

export interface LogsSocketHandlers {
  onEvent: (event: LogsEvent) => void;
  onOpen?: () => void;
  onClose?: (code: number, reason: string) => void;
}

export function openLogsSocket(handlers: LogsSocketHandlers): WebSocket {
  const token = getToken() ?? '';
  // Use the same origin so Vite (dev) proxies it, and prod served-from-backend works too.
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}/ws/logs?token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(url);

  ws.addEventListener('open', () => handlers.onOpen?.());
  ws.addEventListener('close', (e) => handlers.onClose?.(e.code, e.reason));
  ws.addEventListener('message', (e) => {
    try {
      const data = JSON.parse(e.data as string) as LogsEvent;
      handlers.onEvent(data);
    } catch {
      /* ignore non-JSON frames */
    }
  });
  return ws;
}
