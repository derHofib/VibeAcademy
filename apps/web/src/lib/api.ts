/**
 * API-Client: fetch mit Cookie-Sitzung und CSRF-Header (Double-Submit, E-07).
 * Fehler kommen als ApiError mit deutscher Meldung der API.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
  }
  /** Feldfehler aus der Validierung: [{ path, message }] */
  get fields(): Array<{ path: string; message: string }> {
    const b = this.body as { fields?: Array<{ path: string; message: string }> } | null;
    return b?.fields ?? [];
  }
  get code(): string | undefined {
    return (this.body as { code?: string } | null)?.code;
  }
}

let csrf: string | null = null;

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]!) : null;
}

async function csrfToken(): Promise<string> {
  csrf = readCookie('sn_csrf') ?? csrf;
  if (csrf) return csrf;
  const r = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
  csrf = ((await r.json()) as { token: string }).token;
  return csrf;
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const method = (init.method ?? (init.json !== undefined ? 'POST' : 'GET')).toUpperCase();
  const headers = new Headers(init.headers);
  if (init.json !== undefined) headers.set('content-type', 'application/json');
  if (!['GET', 'HEAD'].includes(method)) headers.set('x-csrf-token', await csrfToken());
  const res = await fetch(`/api${path}`, {
    ...init,
    method,
    headers,
    credentials: 'same-origin',
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  const type = res.headers.get('content-type') ?? '';
  const body: unknown = type.includes('application/json') ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const msg = (body as { message?: unknown } | null)?.message;
    throw new ApiError(res.status, typeof msg === 'string' ? msg : 'Etwas ist schiefgelaufen. Bitte erneut versuchen.', body);
  }
  return body as T;
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, json: unknown = {}) => api<T>(path, { method: 'POST', json });
export const patch = <T>(path: string, json: unknown) => api<T>(path, { method: 'PATCH', json });
export const put = <T>(path: string, json: unknown) => api<T>(path, { method: 'PUT', json });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });

/** Datei-Upload (multipart). */
export async function upload<T>(path: string, form: FormData): Promise<T> {
  return api<T>(path, { method: 'POST', body: form });
}

/** SHA-256 im Browser (z. B. Bestätigungstext vor der Unterschrift). */
export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
