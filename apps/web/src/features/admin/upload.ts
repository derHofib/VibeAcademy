import { useCallback, useEffect, useState } from 'react';
import { ApiError, get } from '@/lib/api';

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]!) : null;
}

/**
 * Multipart-Upload mit Fortschritt (XMLHttpRequest – fetch meldet keinen Upload-Fortschritt).
 * CSRF wie im API-Client (Double-Submit-Cookie `sn_csrf`).
 */
export async function uploadWithProgress<T>(
  path: string,
  form: FormData,
  onProgress?: (ratio: number) => void,
): Promise<T> {
  let token = readCookie('sn_csrf');
  if (!token) token = (await get<{ token: string }>('/auth/csrf')).token;
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api${path}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('x-csrf-token', token!);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
      else {
        const msg = (body as { message?: unknown } | null)?.message;
        reject(
          new ApiError(
            xhr.status,
            typeof msg === 'string' ? msg : 'Upload fehlgeschlagen. Bitte erneut versuchen.',
            body,
          ),
        );
      }
    };
    xhr.onerror = () => reject(new ApiError(0, 'Keine Verbindung zum Server. Bitte erneut versuchen.', null));
    xhr.send(form);
  });
}

/** useState, das in sessionStorage gespiegelt wird (Wizard-Auswahl übersteht Neuladen). */
export function useSessionState<T>(key: string | null, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const read = useCallback((): T => {
    if (!key) return initial;
    try {
      const raw = sessionStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  }, [key]);
  const [state, setState] = useState<T>(read);
  const [loadedKey, setLoadedKey] = useState(key);
  if (loadedKey !== key) {
    setLoadedKey(key);
    setState(read());
  }
  useEffect(() => {
    if (!key) return;
    try {
      sessionStorage.setItem(key, JSON.stringify(state));
    } catch {
      // Speicher voll oder gesperrt – Auswahl gilt dann nur bis zum Neuladen
    }
  }, [key, state]);
  return [state, setState];
}
