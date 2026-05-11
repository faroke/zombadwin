const TOKEN_KEY = 'zombadwin.token';

export function getToken(): string | null {
  const raw = localStorage.getItem(TOKEN_KEY);
  // Defensive trim: leading/trailing whitespace from copy-paste would otherwise
  // be URL-encoded as %20 in the WebSocket query string and break auth.
  const cleaned = raw?.trim() ?? null;
  if (raw !== null && cleaned !== null && cleaned !== raw && cleaned !== '') {
    localStorage.setItem(TOKEN_KEY, cleaned);
  }
  return cleaned && cleaned.length > 0 ? cleaned : null;
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token.trim());
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}
