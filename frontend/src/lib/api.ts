import { getToken } from './auth';

interface ApiErrorBody {
  error?: string;
  message?: string;
  issues?: Array<{ message?: string; path?: Array<string | number>; code?: string }>;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`API error ${status}`);
  }
}

/**
 * Pulls a human-readable message out of an unknown error.
 *
 * Backend errors are surfaced as ApiError(status, body) where the body is the
 * JSON returned by the route. Most of our 4xx responses look like:
 *   { error: 'invalid_body', issues: [{ message: 'name must be …', path: [..] }] }
 *   { error: 'name_in_use', message: 'Profile "x" already exists' }
 * This helper extracts the most specific message available so the UI shows the
 * actual reason instead of a generic "HTTP 400".
 */
export function apiErrorMessage(err: unknown, fallback = 'Request failed'): string {
  if (err instanceof ApiError) {
    const body = err.body as ApiErrorBody | undefined;
    if (body?.issues && body.issues.length > 0) {
      const msg = body.issues
        .map((i) => i.message)
        .filter(Boolean)
        .join('; ');
      if (msg) return msg;
    }
    if (body?.message) return body.message;
    if (body?.error) return `${body.error} (HTTP ${err.status})`;
    return `${fallback} (HTTP ${err.status})`;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(path, { ...init, headers });
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}
