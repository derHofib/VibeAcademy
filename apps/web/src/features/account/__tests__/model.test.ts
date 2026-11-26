import { describe, expect, it } from 'vitest';
import {
  EXPIRY_WARN_DAYS,
  canDownload,
  evidenceKey,
  firstNameOf,
  groupEvidence,
  homePathFor,
  isDone,
  participantRegisterPath,
  validity,
  type MyEvidence,
} from '../model';

const NOW = new Date('2026-11-26T10:00:00Z');
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();

function row(p: Partial<MyEvidence> & Pick<MyEvidence, 'invitation_id' | 'status'>): MyEvidence {
  return {
    tenant_name: 'Muster GmbH',
    training_titel: 'Sicherheitsunterweisung 2026',
    version_no: 1,
    completed_at: null,
    valid_until: null,
    nachweis_nr: null,
    verify_code: null,
    evidence_status: null,
    ...p,
  };
}

describe('validity', () => {
  it('ohne Datum: keine Gültigkeit', () => {
    expect(validity(null, NOW)).toEqual({ kind: 'keine', daysLeft: null });
    expect(validity('kein-datum', NOW)).toEqual({ kind: 'keine', daysLeft: null });
  });

  it('mehr als 30 Tage: gültig (grün)', () => {
    expect(validity(inDays(31), NOW)).toEqual({ kind: 'gueltig', daysLeft: 31 });
    expect(validity(inDays(365), NOW).kind).toBe('gueltig');
  });

  it('innerhalb von 30 Tagen: läuft bald ab (gelb), Tage aufgerundet', () => {
    expect(validity(inDays(EXPIRY_WARN_DAYS), NOW)).toEqual({ kind: 'laeuftAb', daysLeft: 30 });
    expect(validity(inDays(0.25), NOW)).toEqual({ kind: 'laeuftAb', daysLeft: 1 });
    expect(validity(inDays(29.5), NOW)).toEqual({ kind: 'laeuftAb', daysLeft: 30 });
  });

  it('Stichtag erreicht oder vorbei: abgelaufen (rot)', () => {
    expect(validity(NOW.toISOString(), NOW).kind).toBe('abgelaufen');
    expect(validity(inDays(-3), NOW)).toEqual({ kind: 'abgelaufen', daysLeft: -3 });
  });
});

describe('groupEvidence', () => {
  const rows: MyEvidence[] = [
    row({ invitation_id: 'neu', status: 'offen' }),
    row({ invitation_id: 'begonnen', status: 'geoeffnet' }),
    row({ invitation_id: 'ueberfaellig', status: 'ueberfaellig' }),
    row({ invitation_id: 'fast', status: 'bestanden' }),
    row({
      invitation_id: 'gueltig-alt',
      status: 'bestaetigt',
      completed_at: inDays(-100),
      valid_until: inDays(265),
      evidence_status: 'erzeugt',
    }),
    row({
      invitation_id: 'gueltig-neu',
      status: 'bestaetigt',
      completed_at: inDays(-1),
      valid_until: inDays(364),
      evidence_status: 'erzeugt',
    }),
    row({ invitation_id: 'bald', status: 'bestaetigt', completed_at: inDays(-350), valid_until: inDays(15), evidence_status: 'erzeugt' }),
    row({ invitation_id: 'abgelaufen', status: 'bestaetigt', completed_at: inDays(-400), valid_until: inDays(-35), evidence_status: 'erzeugt' }),
    row({ invitation_id: 'befreit', status: 'befreit', completed_at: inDays(-5), valid_until: inDays(360) }),
  ];

  it('offen = alles außer bestätigt/befreit; überfällig zuerst, dann fast fertig', () => {
    const g = groupEvidence(rows, NOW);
    expect(g.open.map((r) => r.invitation_id)).toEqual(['ueberfaellig', 'fast', 'begonnen', 'neu']);
  });

  it('erledigt: abgelaufen und bald ablaufend zuerst, sonst neueste zuerst; befreit ohne Gültigkeit', () => {
    const g = groupEvidence(rows, NOW);
    expect(g.done.map((r) => r.invitation_id)).toEqual(['abgelaufen', 'bald', 'gueltig-neu', 'gueltig-alt', 'befreit']);
    expect(g.done.map((r) => r.validity.kind)).toEqual(['abgelaufen', 'laeuftAb', 'gueltig', 'gueltig', 'keine']);
    expect(g.done.find((r) => r.invitation_id === 'bald')?.validity.daysLeft).toBe(15);
  });

  it('zählt nur „läuft bald ab“, nicht schon abgelaufene', () => {
    expect(groupEvidence(rows, NOW).expiringCount).toBe(1);
  });

  it('leere Liste', () => {
    expect(groupEvidence([], NOW)).toEqual({ open: [], done: [], expiringCount: 0 });
  });

  it('isDone / canDownload', () => {
    expect(isDone({ status: 'bestaetigt' })).toBe(true);
    expect(isDone({ status: 'befreit' })).toBe(true);
    expect(isDone({ status: 'bestanden' })).toBe(false);
    expect(canDownload({ status: 'bestaetigt', evidence_status: 'erzeugt' })).toBe(true);
    expect(canDownload({ status: 'bestaetigt', evidence_status: 'ausstehend' })).toBe(false);
    expect(canDownload({ status: 'befreit', evidence_status: null })).toBe(false);
  });
});

describe('Kontoziele', () => {
  it('reine Teilnehmer landen in „Meine Nachweise“, Mitglieder in der Verwaltung', () => {
    expect(homePathFor({ memberships: [] })).toBe('/konto');
    expect(homePathFor({ memberships: [{ tenantId: 't' }] })).toBe('/verwaltung');
    expect(homePathFor(null)).toBe('/verwaltung');
  });

  it('Registrierungslink mit vorbelegter E-Mail', () => {
    expect(participantRegisterPath()).toBe('/registrieren?teilnehmer=1');
    expect(participantRegisterPath('  ')).toBe('/registrieren?teilnehmer=1');
    expect(participantRegisterPath('lea+test@example.org')).toBe('/registrieren?teilnehmer=1&email=lea%2Btest%40example.org');
  });

  it('Vorname für die Begrüßung', () => {
    expect(firstNameOf('Lea Wagner')).toBe('Lea');
    expect(firstNameOf('  ')).toBeNull();
    expect(firstNameOf(undefined)).toBeNull();
  });
});

describe('Phase 2: externe Nachweise in „Meine Nachweise“', () => {
  const ext = {
    invitation_id: null as unknown as string,
    tenant_name: 'Muster Elektrotechnik GmbH',
    training_titel: 'Erste-Hilfe-Fortbildung',
    version_no: null as unknown as number,
    completed_at: '2026-11-26T10:00:00Z',
    valid_until: '2028-11-20T00:00:00Z',
    status: 'abgelaufen' as MyEvidence['status'],
    nachweis_nr: 'N-2026-00013',
    verify_code: 'ABCD-EFGH',
    evidence_status: 'erzeugt' as const,
    kind: 'extern' as const,
    record_id: '22222222-2222-4222-8222-222222222222',
    download_url: '/api/me/external-records/22222222-2222-4222-8222-222222222222/evidence/pdf',
  };

  it('externe Nachweise gelten immer als erledigt und sind herunterladbar', () => {
    expect(isDone(ext)).toBe(true);
    expect(canDownload(ext)).toBe(true);
    const g = groupEvidence([ext], new Date('2026-11-26T12:00:00Z'));
    expect(g.open).toHaveLength(0);
    expect(g.done[0]!.validity.kind).toBe('gueltig');
  });

  it('Schlüssel je Art (externe ohne Einladung)', () => {
    expect(evidenceKey(ext)).toBe('extern-22222222-2222-4222-8222-222222222222');
    expect(evidenceKey({ invitation_id: 'i1', record_id: null, kind: undefined })).toBe('online-i1');
  });
});
