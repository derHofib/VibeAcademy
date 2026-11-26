/** Ab dieser Breite: Desktop-Viewer mit Kapitel-Leiste (5c) */
export const VIEWER_DESKTOP_QUERY = '(min-width: 1024px)';

import type { Chapter, InvitationStart, PageProgress } from './api';

/** Kapitelnummer (1-basiert) und Titel ohne vorangestellte Nummer („2 Elektrische …“ → „Elektrische …“). */
export function chapterLabel(c: Chapter): { no: number; title: string; short: string } {
  const title = c.title.replace(/^\s*\d+(\.\d+)*\.?\s+/, '').trim() || c.title;
  return { no: c.idx + 1, title, short: (c.short_name ?? '').trim() || title.split(/\s+/)[0]! };
}

export function chapterOf(chapters: Chapter[], pageNo: number): Chapter | undefined {
  return chapters.find((c) => pageNo >= c.from_page && pageNo <= c.to_page);
}

/** Seitentitel für Inhaltsverzeichnis und Kopf; Fallback „Seite n“. */
export function pageTitle(start: Pick<InvitationStart, 'pages'>, pageNo: number): string {
  return start.pages.find((p) => p.pageNo === pageNo)?.title?.trim() || `Seite ${pageNo}`;
}

/** Erste noch nicht erfüllte, aufrufbare Seite (Startpunkt beim Weiterlesen). */
export function resumePage(pages: PageProgress[]): number {
  const open = pages.find((p) => !p.fulfilled && p.allowed) ?? pages.find((p) => !p.fulfilled);
  return open?.pageNo ?? pages[pages.length - 1]?.pageNo ?? 1;
}

export interface Contact {
  name: string;
  initials: string;
  phone: string | null;
  email: string | null;
  raw: string;
}

/** Ansprechpartner ist Freitext (z. B. „Dennis Hofmann, Telefon 030 1234567“) → Name, Telefon, E-Mail. */
export function parseContact(raw: string | null | undefined): Contact | null {
  const text = raw?.trim();
  if (!text) return null;
  const email = /[^\s,;<>()]+@[^\s,;<>()]+\.[a-z]{2,}/i.exec(text)?.[0] ?? null;
  const phone = /(\+?\d[\d\s/()-]{5,}\d)/.exec(text.replace(email ?? '', ''))?.[1]?.trim() ?? null;
  const name = text.split(/[,;·|]/)[0]!.replace(email ?? '', '').trim() || text;
  const initials = name
    .split(/\s+/)
    .filter((w) => /^\p{L}/u.test(w))
    .map((w) => w[0]!.toUpperCase())
    .slice(0, 2)
    .join('');
  return { name, initials: initials || '?', phone, email, raw: text };
}

/** Kontakt für Fußzeilen: „Dennis Hofmann · 030 1234567“ */
export function contactLine(c: Contact | null): string | null {
  if (!c) return null;
  return [c.name, c.phone ?? c.email].filter(Boolean).join(' · ');
}

export const MOBILE_ZOOMS = [1, 1.15, 1.3] as const;
export const DESKTOP_ZOOM = { min: 0.9, max: 1.3, step: 0.1 } as const;

export const nextMobileZoom = (z: number) => MOBILE_ZOOMS.find((v) => v > z + 0.001) ?? MOBILE_ZOOMS[0];
export const clampZoom = (z: number) => Math.round(Math.min(DESKTOP_ZOOM.max, Math.max(DESKTOP_ZOOM.min, z)) * 100) / 100;

/** Seitenerfassung als Anteil 0–1 (Segment-Fortschritt, Kapitelringe). */
export const pageFraction = (p: Pick<PageProgress, 'dwellMs' | 'tMinMs' | 'fulfilled'>) =>
  p.fulfilled ? 1 : p.tMinMs > 0 ? Math.min(1, p.dwellMs / p.tMinMs) : 0;

export function firstName(fullName: string | null | undefined): string | null {
  const f = fullName?.trim().split(/\s+/)[0];
  return f || null;
}
