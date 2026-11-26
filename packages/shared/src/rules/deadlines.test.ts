import { describe, expect, it } from 'vitest';
import {
  addDays, addMonths, berlinDate, complianceState, daysBetween, dueReminderStage, escalationDue, noticeKey, proposeValidUntil, reinviteDue, reinviteOn,
} from './deadlines';

const due = new Date('2026-12-15T22:59:59Z'); // 15.12.2026 23:59:59 Berlin
const at = (iso: string) => new Date(iso);

describe('Erinnerungsstufen T−7, T−2, T+1', () => {
  it('vor T−7 nichts', () => {
    expect(dueReminderStage(due, at('2026-12-08T22:00:00Z'))).toBeNull();
  });
  it('ab T−7 die Stufe T−7, ab T−2 die Stufe T−2, ab T+1 die Stufe T+1', () => {
    expect(dueReminderStage(due, at('2026-12-09T01:00:00Z'))?.stage).toBe('T-7');
    expect(dueReminderStage(due, at('2026-12-12T23:00:00Z'))?.stage).toBe('T-7');
    expect(dueReminderStage(due, at('2026-12-13T23:00:00Z'))?.stage).toBe('T-2');
    expect(dueReminderStage(due, at('2026-12-16T01:00:00Z'))?.stage).toBe('T-2'); // überfällig, aber T+1 noch nicht erreicht
    expect(dueReminderStage(due, at('2026-12-17T01:00:00Z'))?.stage).toBe('T+1');
    expect(dueReminderStage(due, at('2027-03-01T01:00:00Z'))?.stage).toBe('T+1');
  });
  it('nur die jüngste Stufe; Stufen vor der Einladung entfallen', () => {
    const invited = at('2026-12-12T08:00:00Z'); // 3 Tage vor der Frist eingeladen
    expect(dueReminderStage(due, at('2026-12-12T09:00:00Z'), invited)).toBeNull();
    expect(dueReminderStage(due, at('2026-12-14T01:00:00Z'), invited)?.stage).toBe('T-2');
  });
  it('Eskalation ab T+1', () => {
    expect(escalationDue(due, at('2026-12-16T12:00:00Z'))).toBe(false);
    expect(escalationDue(due, at('2026-12-16T23:00:00Z'))).toBe(true);
  });
  it('Policy ist überschreibbar', () => {
    const p = { reminderOffsetsDays: [-3], escalationOffsetDays: 5, soonDays: 10, reinviteLeadDays: 10 };
    expect(dueReminderStage(due, at('2026-12-13T00:00:00Z'), null, p)?.stage).toBe('T-3');
    expect(escalationDue(due, at('2026-12-17T00:00:00Z'), p)).toBe(false);
  });
});

describe('Kalendertage', () => {
  it('Monatsende wird gekappt wie in PostgreSQL', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-12-04', 24)).toBe('2028-12-04');
    expect(addMonths('2026-03-15', -3)).toBe('2025-12-15');
  });
  it('Tage', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-12-01', '2027-01-01')).toBe(31);
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2); // Zeitumstellung egal
  });
  it('Berliner Kalendertag', () => {
    expect(berlinDate(at('2026-12-15T23:30:00Z'))).toBe('2026-12-16');
    expect(berlinDate(at('2026-07-15T21:59:00Z'))).toBe('2026-07-15');
  });
  it('Gültigkeitsvorschlag aus dem Intervall (Ersthelfer 2 Jahre)', () => {
    expect(proposeValidUntil('2026-12-04', 24)).toBe('2028-12-04');
  });
});

describe('Pflichtmatrix-Zustand', () => {
  it('fehlt, gültig, läuft ab, abgelaufen, befreit', () => {
    expect(complianceState({ validUntil: null, today: '2026-12-01' })).toBe('fehlt');
    expect(complianceState({ validUntil: '2027-06-01', today: '2026-12-01' })).toBe('gueltig');
    expect(complianceState({ validUntil: '2026-12-31', today: '2026-12-01' })).toBe('laeuft_ab');
    expect(complianceState({ validUntil: '2026-12-01', today: '2026-12-01' })).toBe('laeuft_ab'); // letzter gültiger Tag
    expect(complianceState({ validUntil: '2026-11-30', today: '2026-12-01' })).toBe('abgelaufen');
    expect(complianceState({ validUntil: '2026-11-30', today: '2026-12-01', graceDays: 14 })).toBe('laeuft_ab');
    expect(complianceState({ validUntil: '2020-01-01', today: '2026-12-01', exempt: true })).toBe('befreit');
  });
  it('Wiedereinladung 30 Tage vor Ablauf bzw. sofort, wenn nie erfüllt', () => {
    expect(reinviteDue(null, '2026-12-01')).toBe(true);
    expect(reinviteDue('2027-01-01', '2026-12-01')).toBe(false);
    expect(reinviteDue('2026-12-31', '2026-12-01')).toBe(true);
    expect(reinviteOn('2026-12-31')).toBe('2026-12-01');
  });
});

describe('Idempotenz-Schlüssel', () => {
  it('je Stufe und Zyklus eindeutig', () => {
    expect(noticeKey.reminder('i1', 'T-7')).toBe('inv:i1:T-7');
    expect(noticeKey.reinvite('p', 'r', '2027-01-01')).not.toBe(noticeKey.reinvite('p', 'r', '2028-01-01'));
    expect(noticeKey.reinvite('p', 'r', null)).toBe('req:p:r:fehlt:einladung');
  });
});
