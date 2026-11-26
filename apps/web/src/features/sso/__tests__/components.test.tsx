import '@testing-library/jest-dom/vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { SsoLoginButton } from '../SsoLoginButton';
import { SsoStepUpBlock, type SsoStepUpState } from '../SsoStepUp';

const state = (over: Partial<SsoStepUpState> = {}): SsoStepUpState => ({
  available: true,
  required: false,
  startUrl: '/api/auth/sso/step-up/start?purpose=signature%3Ax',
  ticket: null,
  error: null,
  clearTicket: () => undefined,
  ...over,
});

describe('SsoLoginButton', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('ohne E-Mail: Hinweis statt Weiterleitung', async () => {
    render(
      <MemoryRouter>
        <SsoLoginButton email="" />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Mit Firmenkonto anmelden' });
    await userEvent.click(link);
    expect(screen.getByRole('alert')).toHaveTextContent('geschäftliche E-Mail-Adresse');
  });

  it('erkennt die Domain und zeigt die Organisation; Link startet mit E-Mail und Ziel', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sso: true, tenantName: 'Muster GmbH', ssoOnly: true }) });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter initialEntries={['/anmelden?weiter=/verwaltung/personen']}>
        <SsoLoginButton email="max@firma.de" />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Muster GmbH nutzt die Anmeldung mit dem Firmenkonto.'));
    expect(screen.getByRole('status')).toHaveTextContent('Passwort ist für deine Organisation abgeschaltet');
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/sso/discover?email=max%40firma.de', expect.anything());
    expect(screen.getByRole('link', { name: 'Mit Firmenkonto anmelden' })).toHaveAttribute(
      'href',
      '/api/auth/sso/start?email=max%40firma.de&weiter=%2Fverwaltung%2Fpersonen',
    );
  });

  it('Domain ohne SSO: Hinweis beim Klick', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sso: false }) }));
    render(
      <MemoryRouter>
        <SsoLoginButton email="max@privat.de" />
      </MemoryRouter>,
    );
    await act(() => new Promise((r) => setTimeout(r, 450)));
    await userEvent.click(screen.getByRole('link', { name: 'Mit Firmenkonto anmelden' }));
    expect(screen.getByRole('alert')).toHaveTextContent('keine Anmeldung mit Firmenkonto');
  });
});

describe('SsoStepUpBlock', () => {
  it('nicht verfügbar → nichts', () => {
    const { container } = render(<SsoStepUpBlock sso={state({ available: false })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('Button zum IdP, Fehler der Rückleitung, Passwort-Alternative', () => {
    render(<SsoStepUpBlock sso={state({ error: 'Die erneute Anmeldung wurde nicht bestätigt.' })} passwordAlternative />);
    expect(screen.getByRole('link', { name: 'Mit Firmenkonto bestätigen' })).toHaveAttribute('href', '/api/auth/sso/step-up/start?purpose=signature%3Ax');
    expect(screen.getByRole('alert')).toHaveTextContent('nicht bestätigt');
    expect(screen.getByText('oder mit Passwort bestätigen')).toBeInTheDocument();
  });

  it('„nur SSO“ ohne Passwort-Hinweis; bestätigt mit Ticket', () => {
    const { rerender } = render(<SsoStepUpBlock sso={state({ required: true })} passwordAlternative />);
    expect(screen.queryByText('oder mit Passwort bestätigen')).not.toBeInTheDocument();
    rerender(<SsoStepUpBlock sso={state({ ticket: 'abcdefghijklmnopqrstuvwxyz' })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Mit Firmenkonto bestätigt');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
