import { formatDuration, MANUAL_REASON_LABEL, METHOD_LABEL, type CheckInMethod, type CheckOutMethod, type ManualCheckoutReason } from '@sn/shared';
import type pg from 'pg';
import { AUTH_LABEL, dt, type CollectedEvidence, type EvidenceHelpers } from '../evidence/evidence.service';
import { fonts } from '../evidence/evidence-template';
import type { DbService } from '../db/db.service';
import type { ObjectStorage } from '../storage/storage';
import { ddmmyyyy, hhmm, RUN_SQL, type RunRow } from './attendance.service';

export const ATTENDANCE_CONFIRM_TEXT = 'Ich bestätige, dass ich wie angegeben an der Schulung teilgenommen habe.';

/** Daten des Präsenz-/Live-Nachweises (SPEZIFIKATION 4.4: Ein-/Auscheckzeiten, Methode, Vermerk, Gegenzeichnung). */
export interface AttendanceEvidenceData {
  tenantName: string;
  nachweisNr: string;
  createdAt: string;
  verifyUrl: string;
  qrSvg: string;
  heading: string;
  training: { titel: string; provider: string | null; rechtsgrundlage: string | null; art: string; version: number | null };
  termin: { datum: string; zeit: string; ort: string | null; trainer: string | null; geplant: string; ende: string; autoEnded: boolean };
  person: { name: string; personalnr: string | null; orgUnit: string | null };
  intervals: Array<{ in: string; inMethod: string; out: string; outMethod: string; dauer: string; offline: boolean }>;
  anwesenheit: { dauer: string; geplant: string; pct: number; state: 'vollstaendig' | 'teilweise'; thresholdPct: number };
  release: { decision: string; note: string | null; at: string } | null;
  manual: { reason: string; note: string; review: string; message: string | null } | null;
  autoClosed: { review: string } | null;
  polls: Array<{ question: string; answer: string | null; correct: boolean | null; late: boolean }>;
  askedQuestion: boolean;
  confirmation: { at: string; via: string; text: string; signaturePngBase64: string | null };
  countersign: { required: boolean; name: string | null; at: string | null; method: string | null };
  seal: { label: string };
}

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

const REVIEW_LABEL: Record<string, string> = { offen: 'noch nicht geprüft', akzeptiert: 'akzeptiert', rueckfrage: 'Rückfrage gestellt' };

export async function collectAttendanceEvidence(
  c: pg.PoolClient, storage: ObjectStorage, evidenceId: string, h: EvidenceHelpers,
): Promise<{ data: AttendanceEvidenceData; austritt: string | null }> {
  const e = (
    await c.query(
      `SELECT e.id, e.verify_code, e.nachweis_nr, e.attendance_id, a.*, p.name AS person_name, p.personalnr, p.austritt_am, o.name AS org_unit,
              rv.display_name AS reviewer_name
         FROM evidence e JOIN attendance a ON a.id = e.attendance_id JOIN person p ON p.id = a.person_id
         LEFT JOIN org_unit o ON o.id = p.org_unit_id LEFT JOIN account rv ON rv.id = a.note_reviewed_by
        WHERE e.id = $1`,
      [evidenceId],
    )
  ).rows[0];
  if (!e) throw new Error('Nachweisdaten unvollständig');
  const run = (await c.query(RUN_SQL, [e.run_id])).rows[0] as RunRow;
  const ivs = (
    await c.query('SELECT in_at, out_at, in_method, out_method, in_offline, out_offline FROM attendance_interval WHERE attendance_id = $1 ORDER BY in_at', [
      e.attendance_id,
    ])
  ).rows;
  const lo = run.start_at.getTime();
  const hi = (run.ended_at ?? run.end_at).getTime();
  const polls = (
    await c.query(
      `SELECT p.question, p.options, a.option, a.correct, a.late
         FROM live_poll p LEFT JOIN live_poll_answer a ON a.poll_id = p.id AND a.person_id = $2
        WHERE p.run_id = $1 AND p.mode = 'wissenscheck' ORDER BY p.opened_at`,
      [run.id, e.person_id],
    )
  ).rows;
  const asked = (await c.query('SELECT 1 FROM live_question WHERE run_id = $1 AND person_id = $2 LIMIT 1', [run.id, e.person_id])).rowCount;
  const signature = e.kiosk_signature_key ? (await storage.get('evidence', e.kiosk_signature_key)).toString('base64') : null;
  const verifyUrl = h.verifyUrl(e.verify_code);
  const planned = run.end_at.getTime() - run.start_at.getTime();
  const data: AttendanceEvidenceData = {
    tenantName: run.tenant_name,
    nachweisNr: e.nachweis_nr,
    createdAt: dt(h.now()),
    verifyUrl,
    qrSvg: await h.qrSvg(verifyUrl),
    heading: run.typ === 'termin' ? 'Nachweis über die Teilnahme an einer Präsenzschulung' : 'Nachweis über die Teilnahme an einer externen Schulung',
    training: {
      titel: run.titel, provider: run.provider, rechtsgrundlage: run.rechtsgrundlage, version: run.version_no,
      art: run.typ === 'termin' ? 'Präsenz (intern)' : 'Extern, live erfasst (Start-/Ende-QR)',
    },
    termin: {
      datum: ddmmyyyy(run.start_at),
      zeit: `${hhmm(run.start_at)}–${hhmm(run.end_at)}`,
      ort: run.ort,
      trainer: run.trainer_name,
      geplant: formatDuration(planned),
      ende: run.ended_at ? `${hhmm(run.ended_at)}${run.auto_ended ? ' (automatisch, Zeitfenster abgelaufen)' : ' (offiziell beendet)'}` : '–',
      autoEnded: run.auto_ended,
    },
    person: { name: e.person_name, personalnr: e.personalnr, orgUnit: e.org_unit },
    intervals: ivs.map((i) => {
      const a = Math.max(new Date(i.in_at).getTime(), lo);
      const b = Math.min(new Date(i.out_at ?? i.in_at).getTime(), hi);
      return {
        in: hhmm(i.in_at), inMethod: METHOD_LABEL[i.in_method as CheckInMethod],
        out: i.out_at ? hhmm(i.out_at) : '–', outMethod: i.out_method ? METHOD_LABEL[i.out_method as CheckOutMethod] : '–',
        dauer: formatDuration(Math.max(0, b - a)), offline: i.in_offline || i.out_offline,
      };
    }),
    anwesenheit: {
      dauer: formatDuration(e.duration_seconds * 1000),
      geplant: formatDuration(planned),
      pct: Math.floor(Number(e.completeness) * 100),
      state: e.completeness_state,
      thresholdPct: run.completeness_pct,
    },
    release: e.release ? { decision: e.release === 'freigegeben' ? 'Anrechnung freigegeben' : 'Anrechnung abgelehnt', note: e.release_note, at: dt(e.released_at) } : null,
    manual: e.check_out_reason
      ? {
          reason: MANUAL_REASON_LABEL[e.check_out_reason as ManualCheckoutReason],
          note: e.check_out_note,
          review: `${REVIEW_LABEL[e.note_review] ?? e.note_review}${e.note_reviewed_at ? ` am ${dt(e.note_reviewed_at)}` : ''}${e.reviewer_name ? ` durch ${e.reviewer_name}` : ''}`,
          message: e.note_review_message,
        }
      : null,
    autoClosed: e.auto_closed && !e.check_out_reason ? { review: `${REVIEW_LABEL[e.note_review] ?? '–'}${e.note_reviewed_at ? ` am ${dt(e.note_reviewed_at)}` : ''}` } : null,
    polls: polls.map((p) => ({
      question: p.question,
      answer: p.option === null || p.option === undefined ? null : (p.options as string[])[p.option] ?? null,
      correct: p.option === null || p.option === undefined ? null : !!p.correct,
      late: !!p.late,
    })),
    askedQuestion: !!asked,
    confirmation: {
      at: new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(e.confirmed_at)),
      via: e.confirmed_via === 'kiosk' ? 'am Tablet des Organisators mit Unterschrift' : 'durch die Person selbst (persönlicher Zugang)',
      text: ATTENDANCE_CONFIRM_TEXT,
      signaturePngBase64: signature,
    },
    countersign: {
      required: run.typ === 'termin',
      name: run.countersign_name,
      at: run.countersigned_at ? dt(run.countersigned_at) : null,
      method: run.countersign_method ? (AUTH_LABEL[run.countersign_method] ?? run.countersign_method) : null,
    },
    seal: { label: h.sealLabel(run.tenant_name) },
  };
  return { data, austritt: e.austritt_am };
}

export function renderAttendanceEvidenceHtml(d: AttendanceEvidenceData, fontDir: string): string {
  const rows = d.intervals
    .map(
      (i) =>
        `<tr><td>${esc(i.in)}</td><td>${esc(i.inMethod)}</td><td>${esc(i.out)}</td><td>${esc(i.outMethod)}</td><td class="num">${esc(i.dauer)}</td><td>${i.offline ? 'offline nachsynchronisiert' : ''}</td></tr>`,
    )
    .join('');
  const polls = d.polls.length
    ? d.polls
        .map(
          (p, k) =>
            `<div class="pl"><b>Kontrollfrage ${k + 1}:</b> ${esc(p.question)}<br>${
              p.answer === null ? '<span class="m">nicht beantwortet</span>' : `Antwort: ${esc(p.answer)} – ${p.correct ? '<span class="ok">richtig</span>' : '<span class="no">falsch</span>'}${p.late ? ' <span class="m">(nach dem Ende nachgeholt)</span>' : ''}`
            }</div>`,
        )
        .join('')
    : '<span class="m">Keine Wissenscheck-Kontrollfragen gestellt</span>';
  const state = d.anwesenheit.state === 'vollstaendig' ? '<span class="chip ok">vollständig</span>' : '<span class="chip warn">teilweise</span>';
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Nachweis ${esc(d.nachweisNr)}</title>
<style>
${fonts(fontDir)}
@page{size:A4;margin:16mm 16mm 14mm}
*{box-sizing:border-box}
body{font-family:Inter,Arial,sans-serif;color:#1D2433;font-size:10pt;line-height:1.45;margin:0}
h1{font-family:'Plus Jakarta Sans',Arial,sans-serif;font-size:18pt;line-height:1.2;margin:4px 0 6px;letter-spacing:-.01em}
h2{font-size:9.5pt;letter-spacing:.06em;text-transform:uppercase;margin:16px 0 6px;font-weight:700}
.m{color:#5F6B7D}
.head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2.5px solid #1D2433;padding-bottom:12px}
.qr{width:90px;text-align:center;font-size:8pt;color:#5F6B7D}.qr svg{width:90px;height:90px;display:block}
.cols{display:flex;gap:28px}.cols>div{flex:1}
table{width:100%;border-collapse:collapse;font-size:9pt}
th{text-align:left;font-weight:600;color:#5F6B7D;border-bottom:1px solid #D5DBE6;padding:4px 6px}
td{border-bottom:1px solid #EEF1F6;padding:4px 6px;font-variant-numeric:tabular-nums}
.num{text-align:right}
.ok{color:#1E7A50}.no{color:#A1271B}
.chip{display:inline-block;border-radius:999px;padding:1px 10px;font-size:8.5pt;font-weight:600}
.chip.ok{background:#E6F4EC;color:#1E6A45}.chip.warn{background:#FFF4DF;color:#6B4500}
.note{background:#FFFAF0;border-radius:8px;padding:8px 12px;margin-top:6px;break-inside:avoid}
.pl{margin-bottom:6px;break-inside:avoid}
.box{border:1.5px solid #1D2433;border-radius:10px;padding:14px 18px;margin-top:16px;break-inside:avoid}
.sig{display:flex;gap:28px;align-items:flex-end;margin-top:10px}.sig>div{flex:1}
.sig img{height:60px;display:block}
.line{border-top:1.5px solid #1D2433;padding-top:4px;margin-top:4px}
.foot{position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid #D5DBE6;padding-top:6px;font-size:7.5pt;color:#5F6B7D}
</style></head><body>
<div class="head"><div>
<div class="m">${esc(d.tenantName)}</div>
<h1>${esc(d.heading)}</h1>
<div class="m" style="color:#3A4456">Nachweis-Nr. ${esc(d.nachweisNr)} · erstellt ${esc(d.createdAt)}</div>
</div><div class="qr">${d.qrSvg}Echtheit prüfen</div></div>

<div class="cols"><div>
<h2>Schulung</h2>
<b>${esc(d.training.titel)}</b>${d.training.version ? `, Version ${d.training.version}` : ''}<br>
${d.training.provider ? `Anbieter: ${esc(d.training.provider)}<br>` : ''}
${d.training.rechtsgrundlage ? `Rechtsgrundlage: ${esc(d.training.rechtsgrundlage)}<br>` : ''}
Art: ${esc(d.training.art)}<br>
Termin: ${esc(d.termin.datum)} · ${esc(d.termin.zeit)}${d.termin.ort ? ` · ${esc(d.termin.ort)}` : ''}<br>
${d.termin.trainer ? `Trainer: ${esc(d.termin.trainer)}<br>` : ''}
Geplante Dauer: ${esc(d.termin.geplant)} · Ende: ${esc(d.termin.ende)}
</div><div>
<h2>Teilnehmer/in</h2>
<b>${esc(d.person.name)}</b>${d.person.personalnr ? `, Pers.-Nr. ${esc(d.person.personalnr)}` : ''}<br>
${d.person.orgUnit ? `${esc(d.person.orgUnit)}<br>` : ''}
Anwesenheit: <b>${esc(d.anwesenheit.dauer)}</b> von ${esc(d.anwesenheit.geplant)} (${d.anwesenheit.pct} %) ${state}<br>
<span class="m">Vollständig ab ${d.anwesenheit.thresholdPct} % der geplanten Dauer</span>
${d.release ? `<br>${esc(d.release.decision)} am ${esc(d.release.at)}${d.release.note ? ` – „${esc(d.release.note)}“` : ''}` : ''}
${d.askedQuestion ? '<br>Rückfrage gestellt (Frage an den Trainer während der Schulung)' : ''}
</div></div>

<h2>Ein- und Auschecken</h2>
<table><thead><tr><th>Eingecheckt</th><th>Methode</th><th>Ausgecheckt</th><th>Methode</th><th class="num">Dauer</th><th></th></tr></thead><tbody>${rows}</tbody></table>
<div class="m" style="font-size:8pt;margin-top:4px">Zeitquelle: Serverzeit. Gezählt wird nur die Zeit zwischen geplantem Beginn und Ende der Schulung; mehrere Intervalle werden addiert. Keine Standortdaten.</div>
${d.manual ? `<div class="note"><b>Ohne QR-Code ausgeloggt · ${esc(d.manual.reason)}</b><br>Vermerk: „${esc(d.manual.note)}“<br>Prüfung durch den Organisator: ${esc(d.manual.review)}${d.manual.message ? `<br>Rückfrage: „${esc(d.manual.message)}“` : ''}</div>` : ''}
${d.autoClosed ? `<div class="note"><b>Auschecken fehlte</b> – beim Ablauf des Zeitfensters mit dem geplanten Ende geschlossen. Prüfung: ${esc(d.autoClosed.review)}</div>` : ''}

<h2>Wissenscheck während der Schulung</h2>
${polls}
<div class="m" style="font-size:8pt">Stimmungsbilder werden anonym erfasst und sind nicht Teil dieses Nachweises.</div>

<div class="box">
<h2 style="margin-top:0">Bestätigung</h2>
<div style="font-size:10.5pt">„${esc(d.confirmation.text)}“</div>
<div class="sig"><div>
${d.confirmation.signaturePngBase64 ? `<img src="data:image/png;base64,${d.confirmation.signaturePngBase64}" alt="Unterschrift">` : ''}
<div class="line">${esc(d.person.name)} · bestätigt ${esc(d.confirmation.at)}</div>
<div class="m">Bestätigt ${esc(d.confirmation.via)}</div>
</div><div>
${
  d.countersign.required
    ? `<div class="line">Gegenzeichnung: ${esc(d.countersign.name ?? '–')} · ${esc(d.countersign.at ?? '–')}</div><div class="m">${esc(d.countersign.method ?? '')}</div>`
    : '<div class="m">Externe Schulung – Anwesenheit per Start-/Ende-QR erfasst, Teilnahme durch die Person bestätigt.</div>'
}
</div></div></div>

<div class="foot">${esc(d.seal.label)}<br>Echtheit prüfen: QR-Code oben rechts oder ${esc(d.verifyUrl)}</div>
</body></html>`;
}

/** Collector für EvidenceService (Arten „praesenz“ und „live“). */
export function attendanceCollector(db: DbService, storage: ObjectStorage) {
  return async (evidenceId: string, tenantId: string, h: EvidenceHelpers): Promise<CollectedEvidence> => {
    const { data, austritt } = await db.txAs({ tenantId, roles: ['system'] }, (c) => collectAttendanceEvidence(c, storage, evidenceId, h));
    return { html: renderAttendanceEvidenceHtml(data, h.fontDir), nachweisNr: data.nachweisNr, tenantName: data.tenantName, austritt };
  };
}
