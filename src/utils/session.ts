export type SessionRole = 'student' | 'teacher';

const TOKEN_KEY = 'banviet_session_token';
const ROLE_KEY = 'banviet_session_role';

export function getSessionToken(): string | null {
  try {
    return window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getSessionRole(): SessionRole | null {
  try {
    const r = window.sessionStorage.getItem(ROLE_KEY);
    return r === 'teacher' || r === 'student' ? r : null;
  } catch {
    return null;
  }
}

export function saveSession(token: string, role: SessionRole): void {
  try {
    window.sessionStorage.setItem(TOKEN_KEY, token);
    window.sessionStorage.setItem(ROLE_KEY, role);
  } catch {
    // ignore
  }
}

export function clearSession(): void {
  try {
    window.sessionStorage.removeItem(TOKEN_KEY);
    window.sessionStorage.removeItem(ROLE_KEY);
  } catch {
    // ignore
  }
}

export function getAuthHeaders(): Record<string, string> {
  const token = getSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
