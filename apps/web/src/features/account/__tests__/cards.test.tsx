import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { RegisterPage, validateRegister } from '@/pages/auth/RegisterPage';
import { DoneEvidenceCard, OpenEvidenceCard } from '../EvidenceCards';
import type { MyEvidence } from '../model';

const base: MyEvidence = {
  invitation_id: '11111111-1111-4111-8111-111111111111',
  tenant_name: 'Muster Elektrotechnik GmbH',
  training_titel: 'Sicherheitsunterweisung 2026',
  version_no: 2,
  completed_at: '2026-01-10T09:00:00Z',
  valid_until: '2027-01-10T09:00:00Z',
  status: 'bestaetigt',
  nachweis_nr: 'N-2026-000042',
  verify_code: 'ABCD-EFGH',
  evidence_status: 'erzeugt',
};

describe('Teilnehmer-Registrierung', () => {
  it('zeigt Hinweis, keine Organisation und die vorbelegte E-Mail', async () => {
    const onSubmit = vi.fn();
    render(
      <MemoryRouter>
        <RegisterPage mode="teilnehmer" defaultEmail="lea@example.org" onSubmit={onSubmit} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Konto für deine Nachweise');
    expect(screen.getByText('Nachweise sammeln – kein Arbeitgeberzugang')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Organisation/)).toBeNull();
    expect(screen.getByLabelText(/E-Mail/)).toHaveValue('lea@example.org');
    await userEvent.type(screen.getByLabelText(/^Name/), 'Lea Wagner');
    await userEvent.type(screen.getByLabelText(/Passwort/), 'langes-passwort-1');
    await userEvent.click(screen.getByRole('button', { name: 'Konto erstellen' }));
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Lea Wagner', organisation: '', email: 'lea@example.org', password: 'langes-passwort-1' });
  });

  it('prüft ohne Organisation', () => {
    expect(validateRegister({ name: 'Lea', organisation: '', email: 'l@e.de', password: 'langes-passwort' }, 'teilnehmer')).toEqual({});
    expect(validateRegister({ name: 'Lea', organisation: '', email: 'l@e.de', password: 'langes-passwort' })).toHaveProperty('organisation');
  });
});

describe('Nachweis-Karten', () => {
  it('offen: Status und „Weiter“ in die Teilnahme', () => {
    render(
      <MemoryRouter>
        <OpenEvidenceCard e={{ ...base, status: 'geoeffnet', completed_at: null, valid_until: null, nachweis_nr: null, verify_code: null, evidence_status: null }} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Begonnen')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Weiter: Sicherheitsunterweisung 2026' })).toHaveAttribute(
      'href',
      `/teilnahme/${base.invitation_id}`,
    );
  });

  it('erledigt: Nachweis-Nr., Gültig bis, gelber Chip, Download und Prüflink', () => {
    render(
      <MemoryRouter>
        <DoneEvidenceCard e={{ ...base, validity: { kind: 'laeuftAb', daysLeft: 12 } }} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Läuft bald ab')).toBeInTheDocument();
    expect(screen.getByText('N-2026-000042')).toBeInTheDocument();
    expect(screen.getByText('10.01.2027')).toBeInTheDocument();
    expect(screen.getByText('noch 12 Tage')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Nachweis herunterladen/ })).toHaveAttribute(
      'href',
      `/api/me/invitations/${base.invitation_id}/evidence/pdf`,
    );
    expect(screen.getByRole('link', { name: /^Echtheit prüfen/ })).toHaveAttribute('href', '/verify/ABCD-EFGH');
  });

  it('erledigt, PDF noch in Arbeit: kein Download', () => {
    render(
      <MemoryRouter>
        <DoneEvidenceCard e={{ ...base, evidence_status: 'ausstehend', validity: { kind: 'gueltig', daysLeft: 300 } }} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Gültig')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /herunterladen/ })).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Nachweis wird erstellt');
  });
});
