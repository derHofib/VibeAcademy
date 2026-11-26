import { encodeQrPayload } from '@sn/shared';
import { checkScannedToken, manualCheckoutValid, manualNoteRemaining } from '../scanLogic';

const RUN = '0b6f4c2e-7d1a-4e0b-9a63-1f2d3c4b5a69';
const token = (kind: 'start' | 'end', runId = RUN) => `${encodeQrPayload({ runId, kind, mode: 'rotierend', slot: 59_000_000 })}.AAAAAAAAAAAAAAAAAAAAAA`;

describe('Scan-Vorprüfung', () => {
  it('nimmt URL und nacktes Token an', () => {
    const t = token('start');
    expect(checkScannedToken(t, 'start', RUN)).toEqual({ ok: true, token: t, kind: 'start', runId: RUN });
    expect(checkScannedToken(`https://schulung.example.org/q/${t}`, 'start', RUN)).toMatchObject({ ok: true, token: t });
    expect(checkScannedToken(`  ${t} `, 'start')).toMatchObject({ ok: true });
  });

  it('erkennt falsche Art, fremden Termin und Unsinn', () => {
    expect(checkScannedToken(token('end'), 'start', RUN)).toEqual({ ok: false, message: expect.stringContaining('Start-QR') });
    expect(checkScannedToken(token('start'), 'end', RUN)).toEqual({ ok: false, message: expect.stringContaining('Ende-QR') });
    expect(checkScannedToken(token('start', '1b6f4c2e-7d1a-4e0b-9a63-1f2d3c4b5a69'), 'start', RUN)).toMatchObject({ ok: false, message: expect.stringContaining('anderen Termin') });
    expect(checkScannedToken('https://example.org/hallo', 'start', RUN)).toMatchObject({ ok: false });
    expect(checkScannedToken('', 'start')).toMatchObject({ ok: false });
  });

  it('„Ohne QR ausloggen“: Grund und mindestens 10 Zeichen Vermerk', () => {
    expect(manualCheckoutValid(null, 'Notdienst-Einsatz beim Kunden')).toBe(false);
    expect(manualCheckoutValid('vorzeitig', 'zu kurz')).toBe(false);
    expect(manualCheckoutValid('vorzeitig', '   123456789   ')).toBe(false);
    expect(manualCheckoutValid('vorzeitig', '1234567890')).toBe(true);
    expect(manualNoteRemaining('Notdienst')).toBe(1);
    expect(manualNoteRemaining('Notdienst-Einsatz')).toBe(0);
  });
});
