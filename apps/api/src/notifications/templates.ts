/**
 * Nachrichtenvorlagen (E-12). Alle Texte auf Deutsch. Geheimnisse (Codes, Token-Links) kommen getrennt
 * von den protokollierten Daten herein und werden nie in der Outbox gespeichert.
 */
export interface Rendered {
  subject: string;
  text: string;
  html: string;
}

type Data = Record<string, unknown>;
type Secret = Record<string, string> | null;

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** Gemeinsamer Rahmen im weichen Stil (Design-Tokens, Inline-CSS für Mail-Clients). */
function frame(title: string, body: string, footer = 'Diese Nachricht wurde automatisch versendet.', lang = 'de'): string {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${esc(title)}</title></head>
<body style="margin:0;background:#F4F6FB;font-family:Inter,Arial,sans-serif;color:#1D2433">
<div style="max-width:560px;margin:0 auto;padding:32px 16px">
<div style="background:#FFFFFF;border-radius:24px;padding:32px;box-shadow:0 1px 2px rgba(29,36,51,.04),0 10px 30px rgba(29,36,51,.06)">
<h1 style="font-family:'Plus Jakarta Sans',Arial,sans-serif;font-size:22px;line-height:1.3;margin:0 0 16px;letter-spacing:-0.01em">${esc(title)}</h1>
${body}
</div>
<p style="color:#5F6B7D;font-size:12px;line-height:1.5;margin:16px 8px 0">${esc(footer)}</p>
</div></body></html>`;
}

const p = (s: string) => `<p style="font-size:15px;line-height:1.6;color:#3A4456;margin:0 0 16px">${s}</p>`;
const button = (href: string, label: string) =>
  `<p style="margin:24px 0"><a href="${esc(href)}" style="display:inline-block;background:#3D63DD;color:#FFFFFF;text-decoration:none;font-weight:600;padding:14px 28px;border-radius:999px">${esc(label)}</a></p>`;

export const TEMPLATES = {
  otp: (d: Data, s: Secret): Rendered => {
    const code = s?.code ?? '••••••';
    return {
      subject: `Ihr Bestätigungscode: ${code}`,
      text: `Ihr Bestätigungscode lautet ${code}.\nEr ist 10 Minuten gültig. Zweck: ${d.purposeLabel ?? 'Bestätigung'}.\nWenn Sie das nicht angefordert haben, ignorieren Sie diese Nachricht.`,
      html: frame(
        'Ihr Bestätigungscode',
        p(`Zweck: ${esc(d.purposeLabel ?? 'Bestätigung')}`) +
          `<p style="font-size:32px;font-weight:700;letter-spacing:.2em;font-variant-numeric:tabular-nums;margin:8px 0 16px">${esc(code)}</p>` +
          p('Der Code ist 10 Minuten gültig. Wenn Sie das nicht angefordert haben, ignorieren Sie diese Nachricht.'),
      ),
    };
  },
  'member-invite': (d: Data, s: Secret): Rendered => {
    const link = s?.link ?? '#';
    return {
      subject: `Einladung zu ${d.tenantName} – Schulungsnachweis`,
      text: `${d.inviterName} hat Sie zu „${d.tenantName}“ eingeladen.\nPasswort festlegen und loslegen: ${link}\nDer Link ist 7 Tage gültig.`,
      html: frame(
        `Einladung zu ${d.tenantName}`,
        p(`${esc(d.inviterName)} hat Sie als ${esc(d.rolesLabel)} zu „${esc(d.tenantName)}“ eingeladen.`) +
          button(link, 'Passwort festlegen') +
          p('Der Link ist 7 Tage gültig.'),
      ),
    };
  },
  'member-added': (d: Data): Rendered => ({
    subject: `Sie wurden zu ${d.tenantName} hinzugefügt`,
    text: `${d.inviterName} hat Sie zu „${d.tenantName}“ hinzugefügt. Melden Sie sich wie gewohnt an: ${d.loginUrl}`,
    html: frame(
      `Neu in ${d.tenantName}`,
      p(`${esc(d.inviterName)} hat Sie als ${esc(d.rolesLabel)} zu „${esc(d.tenantName)}“ hinzugefügt.`) +
        button(String(d.loginUrl), 'Anmelden'),
    ),
  }),
  'quiz-failed': (d: Data): Rendered => ({
    subject: `Wissenscheck nicht bestanden: ${d.personName} – ${d.trainingTitle}`,
    text: `${d.personName} hat den Wissenscheck zu „${d.trainingTitle}“ in ${d.attempts} Versuchen nicht bestanden. Bitte klären Sie das weitere Vorgehen (z. B. persönliches Gespräch, Versuche zurücksetzen).`,
    html: frame(
      'Wissenscheck nicht bestanden',
      p(`${esc(d.personName)} hat den Wissenscheck zu „${esc(d.trainingTitle)}“ in ${esc(d.attempts)} Versuchen nicht bestanden.`) +
        p('Bitte klären Sie das weitere Vorgehen, z. B. ein persönliches Gespräch oder das Zurücksetzen der Versuche.'),
    ),
  }),
  /** Einladung zur Online-Unterweisung (Screen 4) */
  invitation: (d: Data, s: Secret): Rendered => {
    const link = s?.link ?? '#';
    const facts = `${d.pages} Seiten · ca. ${d.minutes} Minuten${d.questions ? ` · ${d.questions} Fragen` : ''}${d.onlyPages ? ` · nur geänderte Seiten: ${d.onlyPages}` : ''}`;
    return {
      subject: `${d.reminder ? 'Erinnerung: ' : ''}${d.trainingTitle} – bitte bis ${d.dueDate} bearbeiten`,
      text:
        `Hallo ${d.personName},\n\n${d.reminder ? 'zur Erinnerung: ' : ''}bitte bearbeiten Sie die Unterweisung „${d.trainingTitle}“ bis ${d.dueDate}.\n` +
        `Umfang: ${facts}.\n\nZur Unterweisung: ${link}\n\n` +
        `Erfasst wird nur, welche Seiten Sie wie lange geöffnet hatten, Ihre Antworten im Wissenscheck und Ihre Bestätigung. ` +
        `Keine Kamera, kein Standort.\n${d.contact ? `Fragen? ${d.contact}\n` : ''}`,
      html: frame(
        String(d.trainingTitle),
        p(`Hallo ${esc(d.personName)},`) +
          p(`${d.reminder ? 'zur Erinnerung: ' : ''}bitte bearbeiten Sie diese Unterweisung bis <strong>${esc(d.dueDate)}</strong>.`) +
          `<p style="background:#EAF0FE;color:#223C8F;border-radius:16px;padding:12px 16px;font-size:14px;margin:0 0 8px">${esc(facts)}</p>` +
          button(link, 'Unterweisung starten') +
          p('Erfasst wird nur, welche Seiten Sie wie lange geöffnet hatten, Ihre Antworten im Wissenscheck und Ihre Bestätigung. Keine Kamera, kein Standort.') +
          (d.contact ? p(`Fragen? ${esc(d.contact)}`) : ''),
        `${d.tenantName} · Dieser Link ist persönlich – bitte nicht weitergeben.`,
      ),
    };
  },
  /** Einladung zu einem Präsenz-/Live-Termin (Schritte 2.3–2.5) */
  'termin-invitation': (d: Data, s: Secret): Rendered => {
    const link = s?.link ?? '#';
    const when = `${d.date} · ${d.time}${d.place ? ` · ${d.place}` : ''}`;
    return {
      subject: `${d.reminder ? 'Erinnerung: ' : ''}${d.trainingTitle} am ${d.date}`,
      text:
        `Hallo ${d.personName},\n\nSie sind zu „${d.trainingTitle}“${d.provider ? ` (${d.provider})` : ''} eingeladen.\n${when}\n\n` +
        `Ihr persönlicher Zugang (vor Ort zum Ein- und Auschecken per QR-Code): ${link}\n\n` +
        `Erfasst werden nur Ein- und Auscheckzeiten, Ihre Antworten auf Kontrollfragen und Ihre Bestätigung. Kein Standort.\n`,
      html: frame(
        String(d.trainingTitle),
        p(`Hallo ${esc(d.personName)},`) +
          p(`Sie sind zu dieser Schulung eingeladen${d.provider ? ` (${esc(d.provider)})` : ''}.`) +
          `<p style="background:#EAF0FE;color:#223C8F;border-radius:16px;padding:12px 16px;font-size:14px;margin:0 0 8px">${esc(when)}</p>` +
          button(link, 'Zugang öffnen') +
          p('Vor Ort scannen Sie den Start-QR-Code zum Einchecken und am Ende den Ende-QR-Code. Erfasst werden nur Ein- und Auscheckzeiten, Ihre Antworten auf Kontrollfragen und Ihre Bestätigung. Kein Standort.'),
        `${d.tenantName} · Dieser Link ist persönlich – bitte nicht weitergeben.`,
      ),
    };
  },
  /** Nach „offiziell beenden“ (Push): Teilnahme bestätigen */
  'attendance-confirm': (d: Data): Rendered => ({
    subject: 'Bitte Teilnahme bestätigen',
    text: `„${d.trainingTitle}“ ist beendet. Bitte prüfen und bestätigen Sie Ihre Teilnahme (${d.duration}).`,
    html: frame('Bitte Teilnahme bestätigen', p(`„${esc(d.trainingTitle)}“ ist beendet. Bitte prüfen und bestätigen Sie Ihre Teilnahme (${esc(d.duration)}).`) + button(String(d.url ?? '#'), 'Jetzt bestätigen')),
  }),
  /** 48 h ohne Bestätigung (E-24) */
  'attendance-confirm-reminder': (d: Data): Rendered => ({
    subject: `Erinnerung: Teilnahme an „${d.trainingTitle}“ bestätigen`,
    text: `Hallo ${d.personName},\n\nbitte bestätigen Sie noch Ihre Teilnahme an „${d.trainingTitle}“ vom ${d.date}. Erst danach wird Ihr Nachweis erstellt.\n${d.url}\n`,
    html: frame(
      'Teilnahme bestätigen',
      p(`Hallo ${esc(d.personName)},`) +
        p(`bitte bestätigen Sie noch Ihre Teilnahme an „${esc(d.trainingTitle)}“ vom ${esc(d.date)}. Erst danach wird Ihr Nachweis erstellt.`) +
        button(String(d.url ?? '#'), 'Teilnahme bestätigen'),
    ),
  }),
  /** Organisator fragt zum Vermerk beim manuellen Ausloggen nach */
  'attendance-note-question': (d: Data): Rendered => ({
    subject: `Rückfrage zu Ihrem Vermerk – ${d.trainingTitle}`,
    text: `Hallo ${d.personName},\n\nzu Ihrem Vermerk („${d.note}“) gibt es eine Rückfrage${d.message ? `:\n${d.message}` : '.'}\nBitte melden Sie sich bei ${d.organizer ?? 'der verantwortlichen Person'}.\n`,
    html: frame(
      'Rückfrage zu Ihrem Vermerk',
      p(`Hallo ${esc(d.personName)},`) +
        p(`zu Ihrem Vermerk beim Ausloggen aus „${esc(d.trainingTitle)}“ („${esc(d.note)}“) gibt es eine Rückfrage.`) +
        (d.message ? `<p style="background:#FFF4DF;color:#5A3A00;border-radius:16px;padding:12px 16px;font-size:14px;margin:0 0 16px">${esc(d.message)}</p>` : '') +
        p(`Bitte melden Sie sich bei ${esc(d.organizer ?? 'der verantwortlichen Person')}.`),
    ),
  }),
  // ── Fristen-Engine und externe Nachweise (Paket FG, Schritte 2.2/2.6) ──
  /** Eskalation an den Vorgesetzten (T+1, E-24) – nur Status, keine Lesedetails */
  'deadline-escalation': (d: Data): Rendered => ({
    subject: `Überfällig: ${d.personName} – ${d.trainingTitle}`,
    text:
      `Hallo ${d.supervisorName},\n\n${d.personName} hat die Pflichtschulung „${d.trainingTitle}“ nicht bis ${d.dueDate} abgeschlossen ` +
      `(${d.daysOverdue} ${Number(d.daysOverdue) === 1 ? 'Tag' : 'Tage'} überfällig). Erinnerungen wurden bereits versendet.\n` +
      `Bitte sprechen Sie Ihre Mitarbeiterin bzw. Ihren Mitarbeiter an.\n\nÜbersicht: ${d.url}`,
    html: frame(
      'Pflichtschulung überfällig',
      p(`Hallo ${esc(d.supervisorName)},`) +
        p(`<strong>${esc(d.personName)}</strong> hat die Pflichtschulung „${esc(d.trainingTitle)}“ nicht bis <strong>${esc(d.dueDate)}</strong> abgeschlossen (${esc(d.daysOverdue)} ${Number(d.daysOverdue) === 1 ? 'Tag' : 'Tage'} überfällig).`) +
        p('Erinnerungen wurden bereits versendet. Bitte sprechen Sie Ihre Mitarbeiterin bzw. Ihren Mitarbeiter an.') +
        button(String(d.url), 'Status ansehen'),
      `${d.tenantName} · Sie erhalten diese Nachricht als Vorgesetzte(r).`,
    ),
  }),
  /** Externer Kurs läuft ab: „neuen Termin buchen“ (SPEZIFIKATION 4.5) */
  'book-course': (d: Data): Rendered => ({
    subject: d.expired ? `Abgelaufen: ${d.trainingTitle} – bitte neuen Termin buchen` : `${d.trainingTitle} läuft am ${d.validUntil} ab – bitte neuen Termin buchen`,
    text:
      `Hallo ${d.personName},\n\n${d.expired ? `Ihr Nachweis „${d.trainingTitle}“ ist abgelaufen` : `Ihr Nachweis „${d.trainingTitle}“ ist noch bis ${d.validUntil} gültig`}` +
      `${d.qualification ? ` (Qualifikation ${d.qualification})` : ''}.\nBitte buchen Sie rechtzeitig einen neuen Termin und reichen Sie die Bescheinigung danach ein.\n` +
      `${d.contact ? `Ansprechperson: ${d.contact}\n` : ''}`,
    html: frame(
      'Neuen Termin buchen',
      p(`Hallo ${esc(d.personName)},`) +
        p(d.expired
          ? `Ihr Nachweis „${esc(d.trainingTitle)}“ ist <strong>abgelaufen</strong>${d.qualification ? ` (Qualifikation ${esc(d.qualification)})` : ''}.`
          : `Ihr Nachweis „${esc(d.trainingTitle)}“ ist noch bis <strong>${esc(d.validUntil)}</strong> gültig${d.qualification ? ` (Qualifikation ${esc(d.qualification)})` : ''}.`) +
        p('Bitte buchen Sie rechtzeitig einen neuen Termin und reichen Sie die Bescheinigung danach ein – mobil per Foto unter „Meine Nachweise“.') +
        (d.contact ? p(`Ansprechperson: ${esc(d.contact)}`) : ''),
      String(d.tenantName ?? ''),
    ),
  }),
  'external-approved': (d: Data): Rendered => ({
    subject: `Freigegeben: ${d.title}`,
    text: `Hallo ${d.personName},\n\nIhr Nachweis „${d.title}“ wurde freigegeben${d.validUntil ? ` und ist gültig bis ${d.validUntil}` : ''}.\n`,
    html: frame('Nachweis freigegeben', p(`Hallo ${esc(d.personName)},`) +
      p(`Ihr Nachweis „${esc(d.title)}“ wurde freigegeben${d.validUntil ? ` und ist gültig bis <strong>${esc(d.validUntil)}</strong>` : ''}.`), String(d.tenantName ?? '')),
  }),
  'external-returned': (d: Data): Rendered => ({
    subject: `Bitte prüfen: ${d.title} wurde zurückgegeben`,
    text: `Hallo ${d.personName},\n\nIhr Nachweis „${d.title}“ wurde zurückgegeben.\nBegründung: ${d.reason}\n\nBitte korrigieren und erneut einreichen.`,
    html: frame('Nachweis zurückgegeben', p(`Hallo ${esc(d.personName)},`) + p(`Ihr Nachweis „${esc(d.title)}“ wurde zurückgegeben.`) +
      `<p style="background:#FFF4DF;color:#5A3A00;border-radius:16px;padding:12px 16px;font-size:14px;margin:0 0 16px">${esc(d.reason)}</p>` +
      p('Bitte korrigieren Sie die Angaben und reichen Sie den Nachweis erneut ein.'), String(d.tenantName ?? '')),
  }),
  /** Web-Push: Titel und Text kommen fertig herein (Kurzform) */
  'push-message': (d: Data): Rendered => ({ subject: String(d.title ?? ''), text: String(d.body ?? ''), html: '' }),
} satisfies Record<string, (d: Data, s: Secret) => Rendered>;

export type TemplateName = keyof typeof TEMPLATES;

// ── Englische Fassungen der Teilnehmer-Nachrichten (E-39) ─────────────────────────
// Gewählt über `data.lang = 'en'` (setzt NotificationService.enqueue aus person.sprache). Verwaltungs-Nachrichten bleiben Deutsch.
const AUTO_EN = 'This message was sent automatically.';
const personal = (tenant: unknown) => `${tenant} · This link is personal – please do not forward it.`;

export const TEMPLATES_EN: Partial<Record<TemplateName, (d: Data, s: Secret) => Rendered>> = {
  otp: (d, s) => {
    const code = s?.code ?? '••••••';
    return {
      subject: `Your confirmation code: ${code}`,
      text: `Your confirmation code is ${code}.\nIt is valid for 10 minutes. Purpose: ${d.purposeLabel ?? 'confirmation'}.\nIf you did not request it, please ignore this message.`,
      html: frame(
        'Your confirmation code',
        p(`Purpose: ${esc(d.purposeLabel ?? 'confirmation')}`) +
          `<p style="font-size:32px;font-weight:700;letter-spacing:.2em;font-variant-numeric:tabular-nums;margin:8px 0 16px">${esc(code)}</p>` +
          p('The code is valid for 10 minutes. If you did not request it, please ignore this message.'),
        AUTO_EN, 'en',
      ),
    };
  },
  invitation: (d, s) => {
    const link = s?.link ?? '#';
    const facts = `${d.pages} pages · approx. ${d.minutes} minutes${d.questions ? ` · ${d.questions} questions` : ''}${d.onlyPages ? ` · changed pages only: ${d.onlyPages}` : ''}`;
    return {
      subject: `${d.reminder ? 'Reminder: ' : ''}${d.trainingTitle} – please complete by ${d.dueDate}`,
      text:
        `Hello ${d.personName},\n\n${d.reminder ? 'this is a reminder: ' : ''}please complete the training “${d.trainingTitle}” by ${d.dueDate}.\n` +
        `Scope: ${facts}.\n\nStart the training: ${link}\n\n` +
        `We only record which pages you had open and for how long, your answers in the knowledge check and your confirmation. ` +
        `No camera, no location.\n${d.contact ? `Questions? ${d.contact}\n` : ''}`,
      html: frame(
        String(d.trainingTitle),
        p(`Hello ${esc(d.personName)},`) +
          p(`${d.reminder ? 'this is a reminder: ' : ''}please complete this training by <strong>${esc(d.dueDate)}</strong>.`) +
          `<p style="background:#EAF0FE;color:#223C8F;border-radius:16px;padding:12px 16px;font-size:14px;margin:0 0 8px">${esc(facts)}</p>` +
          button(link, 'Start training') +
          p('We only record which pages you had open and for how long, your answers in the knowledge check and your confirmation. No camera, no location.') +
          (d.contact ? p(`Questions? ${esc(d.contact)}`) : ''),
        personal(d.tenantName), 'en',
      ),
    };
  },
  'termin-invitation': (d, s) => {
    const link = s?.link ?? '#';
    const when = `${d.date} · ${d.time}${d.place ? ` · ${d.place}` : ''}`;
    return {
      subject: `${d.reminder ? 'Reminder: ' : ''}${d.trainingTitle} on ${d.date}`,
      text:
        `Hello ${d.personName},\n\nyou are invited to “${d.trainingTitle}”${d.provider ? ` (${d.provider})` : ''}.\n${when}\n\n` +
        `Your personal access (to check in and out on site via QR code): ${link}\n\n` +
        `We only record check-in and check-out times, your answers to control questions and your confirmation. No location.\n`,
      html: frame(
        String(d.trainingTitle),
        p(`Hello ${esc(d.personName)},`) +
          p(`you are invited to this training${d.provider ? ` (${esc(d.provider)})` : ''}.`) +
          `<p style="background:#EAF0FE;color:#223C8F;border-radius:16px;padding:12px 16px;font-size:14px;margin:0 0 8px">${esc(when)}</p>` +
          button(link, 'Open access') +
          p('On site, scan the start QR code to check in and the end QR code at the end. We only record check-in and check-out times, your answers to control questions and your confirmation. No location.'),
        personal(d.tenantName), 'en',
      ),
    };
  },
  'attendance-confirm': (d) => ({
    subject: 'Please confirm your attendance',
    text: `“${d.trainingTitle}” has ended. Please check and confirm your attendance (${d.duration}).`,
    html: frame('Please confirm your attendance', p(`“${esc(d.trainingTitle)}” has ended. Please check and confirm your attendance (${esc(d.duration)}).`) + button(String(d.url ?? '#'), 'Confirm now'), AUTO_EN, 'en'),
  }),
  'attendance-confirm-reminder': (d) => ({
    subject: `Reminder: confirm your attendance at “${d.trainingTitle}”`,
    text: `Hello ${d.personName},\n\nplease confirm your attendance at “${d.trainingTitle}” on ${d.date}. Your record will only be created afterwards.\n${d.url}\n`,
    html: frame(
      'Confirm attendance',
      p(`Hello ${esc(d.personName)},`) +
        p(`please confirm your attendance at “${esc(d.trainingTitle)}” on ${esc(d.date)}. Your record will only be created afterwards.`) +
        button(String(d.url ?? '#'), 'Confirm attendance'),
      AUTO_EN, 'en',
    ),
  }),
  'attendance-note-question': (d) => ({
    subject: `Question about your note – ${d.trainingTitle}`,
    text: `Hello ${d.personName},\n\nthere is a question about your note (“${d.note}”)${d.message ? `:\n${d.message}` : '.'}\nPlease contact ${d.organizer ?? 'the person in charge'}.\n`,
    html: frame(
      'Question about your note',
      p(`Hello ${esc(d.personName)},`) +
        p(`there is a question about the note you left when checking out of “${esc(d.trainingTitle)}” (“${esc(d.note)}”).`) +
        (d.message ? `<p style="background:#FFF4DF;color:#5A3A00;border-radius:16px;padding:12px 16px;font-size:14px;margin:0 0 16px">${esc(d.message)}</p>` : '') +
        p(`Please contact ${esc(d.organizer ?? 'the person in charge')}.`),
      AUTO_EN, 'en',
    ),
  }),
  'book-course': (d) => ({
    subject: d.expired ? `Expired: ${d.trainingTitle} – please book a new date` : `${d.trainingTitle} expires on ${d.validUntil} – please book a new date`,
    text:
      `Hello ${d.personName},\n\n${d.expired ? `your record “${d.trainingTitle}” has expired` : `your record “${d.trainingTitle}” is valid until ${d.validUntil}`}` +
      `${d.qualification ? ` (qualification ${d.qualification})` : ''}.\nPlease book a new date in good time and submit the certificate afterwards.\n` +
      `${d.contact ? `Contact: ${d.contact}\n` : ''}`,
    html: frame(
      'Book a new date',
      p(`Hello ${esc(d.personName)},`) +
        p(d.expired
          ? `your record “${esc(d.trainingTitle)}” has <strong>expired</strong>${d.qualification ? ` (qualification ${esc(d.qualification)})` : ''}.`
          : `your record “${esc(d.trainingTitle)}” is valid until <strong>${esc(d.validUntil)}</strong>${d.qualification ? ` (qualification ${esc(d.qualification)})` : ''}.`) +
        p('Please book a new date in good time and submit the certificate afterwards – on your phone as a photo under “My records”.') +
        (d.contact ? p(`Contact: ${esc(d.contact)}`) : ''),
      String(d.tenantName ?? ''), 'en',
    ),
  }),
  'external-approved': (d) => ({
    subject: `Approved: ${d.title}`,
    text: `Hello ${d.personName},\n\nyour record “${d.title}” has been approved${d.validUntil ? ` and is valid until ${d.validUntil}` : ''}.\n`,
    html: frame('Record approved', p(`Hello ${esc(d.personName)},`) +
      p(`your record “${esc(d.title)}” has been approved${d.validUntil ? ` and is valid until <strong>${esc(d.validUntil)}</strong>` : ''}.`), String(d.tenantName ?? ''), 'en'),
  }),
  'external-returned': (d) => ({
    subject: `Please check: ${d.title} was returned`,
    text: `Hello ${d.personName},\n\nyour record “${d.title}” was returned.\nReason: ${d.reason}\n\nPlease correct it and submit it again.`,
    html: frame('Record returned', p(`Hello ${esc(d.personName)},`) + p(`your record “${esc(d.title)}” was returned.`) +
      `<p style="background:#FFF4DF;color:#5A3A00;border-radius:16px;padding:12px 16px;font-size:14px;margin:0 0 16px">${esc(d.reason)}</p>` +
      p('Please correct the details and submit the record again.'), String(d.tenantName ?? ''), 'en'),
  }),
};

/** Vorlagen, die eine englische Fassung haben (für die automatische Sprachwahl beim Einreihen). */
export const TRANSLATED_TEMPLATES = new Set<string>(Object.keys(TEMPLATES_EN));

export function render(template: string, data: Data, secret: Secret): Rendered {
  const en = data?.lang === 'en' ? (TEMPLATES_EN as Record<string, (d: Data, s: Secret) => Rendered>)[template] : undefined;
  if (en) return en(data, secret);
  const fn = (TEMPLATES as Record<string, (d: Data, s: Secret) => Rendered>)[template];
  if (!fn) throw new Error(`Unbekannte Vorlage: ${template}`);
  return fn(data, secret);
}

/** Beispieldaten für die Vorschau-Route (nur Entwicklung). */
export const SAMPLE_DATA: Record<TemplateName, { data: Data; secret: Secret }> = {
  'deadline-escalation': {
    data: { supervisorName: 'Kai Neumann', personName: 'Jonas Krüger', trainingTitle: 'EFK-Unterweisung', dueDate: '11.12.2026', daysOverdue: 1, url: 'http://localhost:5173/verwaltung', tenantName: 'Muster Elektro GmbH' },
    secret: null,
  },
  'book-course': {
    data: { personName: 'Anna Schulz', trainingTitle: 'Erste-Hilfe-Fortbildung', validUntil: '04.12.2026', qualification: 'Ersthelfer', expired: false, contact: 'Dennis Hofmann', tenantName: 'Muster Elektro GmbH' },
    secret: null,
  },
  'external-approved': { data: { personName: 'Lea Wagner', title: 'Erste-Hilfe-Fortbildung', validUntil: '04.12.2028', tenantName: 'Muster Elektro GmbH' }, secret: null },
  'external-returned': { data: { personName: 'Mehmet Aydın', title: 'Unterweisung Flurförderzeuge', reason: 'Auf dem Beleg fehlt das Datum.', tenantName: 'Muster Elektro GmbH' }, secret: null },
  'push-message': { data: { title: 'Erinnerung: EFK-Unterweisung', body: 'Bitte bis 11.12.2026 abschließen.' }, secret: null },
  'quiz-failed': { data: { personName: 'Jonas Krüger', trainingTitle: 'EFK-Unterweisung', attempts: 3 }, secret: null },
  invitation: {
    data: {
      personName: 'Anna Schulz', trainingTitle: 'Sicherheitsunterweisung 2026', dueDate: '15.12.2026', pages: 14, minutes: 7,
      questions: 10, contact: 'Dennis Hofmann, Telefon 0761 123456', tenantName: 'Muster Elektro GmbH', reminder: false,
    },
    secret: { link: 'http://localhost:5173/s/beispiel-token' },
  },
  otp: { data: { purposeLabel: 'Unterschrift „Sicherheitsunterweisung 2026“' }, secret: { code: '482913' } },
  'member-invite': {
    data: { tenantName: 'Muster Elektro GmbH', inviterName: 'Dennis Hofmann', rolesLabel: 'Trainer / Dozent' },
    secret: { link: 'http://localhost:5173/passwort-festlegen#token=beispiel' },
  },
  'member-added': {
    data: { tenantName: 'Muster Elektro GmbH', inviterName: 'Dennis Hofmann', rolesLabel: 'Vorgesetzter', loginUrl: 'http://localhost:5173/anmelden' },
    secret: null,
  },
  'termin-invitation': {
    data: {
      personName: 'Anna Schulz', trainingTitle: 'Erste-Hilfe-Fortbildung', provider: 'Erste-Hilfe-Ausbildung Muster e. V.', date: '04.12.2026',
      time: '08:00–15:30', place: 'Schulungsraum Lager', tenantName: 'Muster Elektro GmbH', reminder: false,
    },
    secret: { link: 'http://localhost:5173/s/beispiel-token' },
  },
  'attendance-confirm': { data: { trainingTitle: 'Erste-Hilfe-Fortbildung', duration: '7 h 28 min', url: 'http://localhost:5173/teilnahme/beispiel/live' }, secret: null },
  'attendance-confirm-reminder': {
    data: { personName: 'Anna Schulz', trainingTitle: 'Erste-Hilfe-Fortbildung', date: '04.12.2026', url: 'http://localhost:5173/teilnahme/beispiel/live' },
    secret: null,
  },
  'attendance-note-question': {
    data: { personName: 'Sven Albrecht', trainingTitle: 'Erste-Hilfe-Fortbildung', note: 'Notdienst-Einsatz beim Kunden ab 13 Uhr', message: 'Bitte Einsatzauftrag nachreichen.', organizer: 'Dennis Hofmann' },
    secret: null,
  },
};
