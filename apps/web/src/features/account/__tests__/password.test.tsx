import '@testing-library/jest-dom/vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { PasswordCard, validatePasswordChange } from '../PasswordCard';
import { LoginPage } from '@/pages/auth/LoginPage';
import { formatClock } from '@/hooks/useCountdown';
import { lockSecondsFrom } from '@/features/auth/lock';
import { ApiError } from '@/lib/api';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PasswordCard />
    </QueryClientProvider>,
  );
}

async function fill(current: string, next: string, repeat = next) {
  if (current) await userEvent.type(screen.getByLabelText(/Aktuelles Passwort/), current);
  if (next) await userEvent.type(screen.getByLabelText(/^Neues Passwort(?! wiederholen)/), next);
  if (repeat) await userEvent.type(screen.getByLabelText(/Neues Passwort wiederholen/), repeat);
  await userEvent.click(screen.getByRole('button', { name: 'Passwort ändern' }));
}

describe('Passwort ändern – Prüfung im Browser', () => {
  it('Pflichtfeld, Mindestlänge 10, Wiederholung, nicht gleich dem alten', () => {
    expect(validatePasswordChange({ currentPassword: '', newPassword: '123456789', repeat: 'x' })).toEqual({
      currentPassword: 'Bitte ausfüllen',
      newPassword: 'Das Passwort muss mindestens 10 Zeichen haben',
      repeat: 'Die Passwörter stimmen nicht überein',
    });
    expect(validatePasswordChange({ currentPassword: 'altes-passwort', newPassword: 'altes-passwort', repeat: 'altes-passwort' })).toEqual({
      newPassword: 'Das neue Passwort muss sich vom bisherigen unterscheiden',
    });
    expect(validatePasswordChange({ currentPassword: 'alt', newPassword: '1234567890', repeat: '1234567890' })).toEqual({});
  });
});

describe('PasswordCard', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('zeigt Hinweis „Mindestens 10 Zeichen“ und sendet nichts bei Fehlern', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderCard();
    expect(screen.getByRole('heading', { name: 'Passwort ändern' })).toBeInTheDocument();
    expect(screen.getByText('Mindestens 10 Zeichen.')).toBeInTheDocument();
    await fill('altes-passwort', 'kurz');
    expect(screen.getByText('Das Passwort muss mindestens 10 Zeichen haben')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Erfolg: Meldung und Felder geleert', async () => {
    document.cookie = 'sn_csrf=t';
    const fetchMock = vi.fn().mockResolvedValue(json(200, { ok: true, endedSessions: 2 }));
    vi.stubGlobal('fetch', fetchMock);
    renderCard();
    await fill('altes-passwort', 'neues-passwort-1');
    expect(await screen.findByText('Passwort geändert. Andere Geräte wurden abgemeldet.')).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/auth/password/change');
    expect(JSON.parse(init.body)).toEqual({ currentPassword: 'altes-passwort', newPassword: 'neues-passwort-1' });
    expect(screen.getByLabelText(/Aktuelles Passwort/)).toHaveValue('');
  });

  it('falsches aktuelles Passwort am Feld', async () => {
    document.cookie = 'sn_csrf=t';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json(400, { message: 'x', fields: [{ path: 'currentPassword', message: 'Das aktuelle Passwort ist falsch' }] })),
    );
    renderCard();
    await fill('falsch-falsch', 'neues-passwort-1');
    expect(await screen.findByText('Das aktuelle Passwort ist falsch')).toBeInTheDocument();
  });

  it('gesperrt: Restzeit und deaktivierter Knopf mit Countdown', async () => {
    document.cookie = 'sn_csrf=t';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json(429, { code: 'login_locked', retryAfterSeconds: 240, message: 'x' }, { 'retry-after': '240' })),
    );
    renderCard();
    await fill('falsch-falsch', 'neues-passwort-1');
    expect(await screen.findByText('Zu viele Fehlversuche. Bitte in 4 Minuten erneut versuchen.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Passwort ändern \(4:00\)/ })).toBeDisabled();
  });
});

describe('Login-Sperre in der Anmeldung', () => {
  it('Meldung mit Restzeit, Anmelden deaktiviert mit Countdown', () => {
    render(
      <MemoryRouter>
        <LoginPage lockedSeconds={125} error="E-Mail oder Passwort ist falsch" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Zu viele Fehlversuche. Bitte in 3 Minuten erneut versuchen.');
    expect(screen.getByRole('button', { name: 'Gesperrt – noch 2:05' })).toBeDisabled();
    // Passwortfehler wird während der Sperre nicht zusätzlich gezeigt
    expect(screen.queryByText('E-Mail oder Passwort ist falsch')).toBeNull();
  });

  it('ohne Sperre normal', () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Anmelden' })).toBeEnabled();
  });

  it('Countdown-Format und Restzeit aus der 429-Antwort', () => {
    expect(formatClock(59)).toBe('0:59');
    expect(formatClock(240)).toBe('4:00');
    expect(formatClock(86_400)).toBe('24:00:00');
    expect(lockSecondsFrom(new ApiError(429, 'x', { retryAfterSeconds: 60 }))).toBe(60);
    expect(lockSecondsFrom(new ApiError(429, 'x', {}))).toBeNull();
    expect(lockSecondsFrom(new ApiError(401, 'x', { retryAfterSeconds: 60 }))).toBeNull();
  });

  it('useCountdown zählt herunter', async () => {
    vi.useFakeTimers();
    const { useCountdown } = await import('@/hooks/useCountdown');
    function Probe({ until }: { until: number }) {
      return <span data-testid="s">{useCountdown(until)}</span>;
    }
    render(<Probe until={Date.now() + 3000} />);
    expect(screen.getByTestId('s')).toHaveTextContent('3');
    await act(async () => vi.advanceTimersByTime(2000));
    expect(screen.getByTestId('s')).toHaveTextContent('1');
    await act(async () => vi.advanceTimersByTime(2000));
    expect(screen.getByTestId('s')).toHaveTextContent('0');
    vi.useRealTimers();
  });
});
