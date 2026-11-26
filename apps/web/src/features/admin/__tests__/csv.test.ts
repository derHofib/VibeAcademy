import { precheckCsv, summarizeImport } from '../csv';
import { printableHtml } from '../LinksPanel';
import { barGeometry } from '@/pages/admin/EvidenceReportPage';
import { tokenFromHash } from '@/pages/auth/SetPasswordPage';
import { validateRegister } from '@/pages/auth/RegisterPage';
import { safeNext } from '@/features/auth/session';
import { navPathFor } from '../AdminShell';

describe('CSV-Import: Ergebnis je Zeile', () => {
  it('ohne Fehler: grün', () => {
    expect(summarizeImport({ created: 3, updated: 1, errors: [] })).toEqual({
      tone: 'success',
      headline: '3 neu, 1 aktualisiert',
      lines: [],
    });
  });

  it('mit Fehlern: gelb, Zeilen sortiert', () => {
    const s = summarizeImport({
      created: 2,
      updated: 0,
      errors: [
        { zeile: 7, fehler: 'E-Mail oder Personalnummer doppelt' },
        { zeile: 3, fehler: 'Ungültige E-Mail-Adresse' },
      ],
    });
    expect(s.tone).toBe('warn');
    expect(s.headline).toBe('2 neu, 0 aktualisiert, 2 Zeilen mit Fehler');
    expect(s.lines).toEqual([
      'Zeile 3: Ungültige E-Mail-Adresse',
      'Zeile 7: E-Mail oder Personalnummer doppelt',
    ]);
  });

  it('nur Fehler: rot', () => {
    expect(summarizeImport({ created: 0, updated: 0, errors: [{ zeile: 2, fehler: 'x' }] }).tone).toBe(
      'danger',
    );
  });

  it('Vorprüfung im Browser', () => {
    expect(precheckCsv('')).toBe('Die Datei ist leer.');
    expect(precheckCsv('vorname;email\nA;b')).toMatch(/Spalte „name“/);
    expect(precheckCsv('\uFEFFname;email\n')).toBe('Unter der Kopfzeile stehen keine Personen.');
    expect(precheckCsv('"Name",email\nAnna,a@b.de')).toBeNull();
  });
});

describe('Weitere Hilfsfunktionen', () => {
  it('Druckliste der Einladungslinks maskiert HTML', () => {
    const html = printableHtml('Unterweisung <neu>', '2026-12-10T22:59:59Z', [
      { invitationId: '1', name: 'Anna & Co', orgUnit: 'Service Nord', link: 'https://x.de/s/abc' },
    ]);
    expect(html).toContain('Einladungslinks · Unterweisung &lt;neu&gt;');
    expect(html).toContain('Anna &amp; Co');
    expect(html).toContain('https://x.de/s/abc');
    expect(html).toContain('Frist 10.12.2026');
    expect(html).not.toContain('<neu>');
  });

  it('Balken Ist vs. Soll im Seitenprotokoll', () => {
    expect(barGeometry({ ist_ms: 34_000, soll_ms: 18_000 }, 100_000)).toEqual({ ist: 34, soll: 18 });
    expect(barGeometry({ ist_ms: 200_000, soll_ms: 18_000 }, 100_000).ist).toBe(100);
    expect(barGeometry({ ist_ms: 0, soll_ms: 0 }, 0)).toEqual({ ist: 0, soll: 0 });
  });

  it('Token aus dem Fragment des Einladungslinks', () => {
    expect(tokenFromHash('#token=abc123')).toBe('abc123');
    expect(tokenFromHash('#foo=1&token=x%2By')).toBe('x+y');
    expect(tokenFromHash('')).toBeNull();
  });

  it('Registrierung: Pflichtfelder vor dem Senden', () => {
    expect(validateRegister({ name: '', organisation: 'A', email: 'x', password: 'kurz' })).toEqual({
      name: 'Bitte ausfüllen',
      organisation: 'Bitte ausfüllen',
      email: 'Bitte eine gültige E-Mail-Adresse angeben',
      password: 'Das Passwort muss mindestens 10 Zeichen haben',
    });
    expect(
      validateRegister({
        name: 'Dana',
        organisation: 'Muster GmbH',
        email: 'd@m.de',
        password: 'langes-passwort',
      }),
    ).toEqual({});
  });

  it('Weiterleitung nach dem Anmelden nur intern', () => {
    expect(safeNext('/verwaltung/personen')).toBe('/verwaltung/personen');
    expect(safeNext('//boese.de')).toBe('/verwaltung');
    expect(safeNext('https://boese.de')).toBe('/verwaltung');
    expect(safeNext(null)).toBe('/verwaltung');
  });

  it('Menüpunkt für Unterseiten', () => {
    expect(navPathFor('/verwaltung/durchfuehrungen/1')).toBe('/verwaltung/schulungen');
    expect(navPathFor('/verwaltung/nachweise/1')).toBe('/verwaltung/schulungen');
    expect(navPathFor('/verwaltung/personen')).toBe('/verwaltung/personen');
  });
});
