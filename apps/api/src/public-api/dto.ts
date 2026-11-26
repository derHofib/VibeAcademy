/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Stabile Antwortformen der öffentlichen API v1 (E-37): Feldnamen englisch in camelCase, Zeitpunkte ISO 8601 (UTC),
 * Kalendertage als JJJJ-MM-TT. Fachliche Statuswerte bleiben die deutschen Schlüssel der Anwendung (z. B. „bestaetigt“).
 */
type Row = Record<string, any>;

const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const day = (v: unknown): string | null => (v == null ? null : String(v).slice(0, 10));

export const PERSON_SELECT = `p.id, p.external_id, p.name, p.personalnr, p.email, p.mobil, p.org_unit_id, p.extern, p.sprache,
  p.austritt_am::text AS austritt_am, p.account_id IS NOT NULL AS has_account, p.created_at, p.updated_at`;
export const personDto = (r: Row) => ({
  id: r.id as string,
  externalId: r.external_id ?? null,
  name: r.name,
  personalnr: r.personalnr ?? null,
  email: r.email ?? null,
  mobile: r.mobil ?? null,
  orgUnitId: r.org_unit_id ?? null,
  external: r.extern,
  language: r.sprache,
  exitDate: day(r.austritt_am),
  hasAccount: r.has_account,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

export const ORG_UNIT_SELECT = 'o.id, o.name, o.parent_id, o.leiter_person_id, o.created_at';
export const orgUnitDto = (r: Row) => ({
  id: r.id as string, name: r.name, parentId: r.parent_id ?? null, managerPersonId: r.leiter_person_id ?? null, createdAt: iso(r.created_at),
});

export const TRAINING_SELECT = `t.id, t.titel, t.kategorie, t.rechtsgrundlage, t.format, t.quiz_required, t.archived_at, t.created_at, t.updated_at,
  cv.id AS cv_id, cv.version_no AS cv_no, cv.published_at AS cv_published_at`;
export const TRAINING_FROM = `training t LEFT JOIN LATERAL (
  SELECT v.id, v.version_no, v.published_at FROM training_version v WHERE v.training_id = t.id AND v.published_at IS NOT NULL
   ORDER BY v.version_no DESC, coalesce(to_jsonb(v)->>'sprache', 'de') = 'de' DESC LIMIT 1) cv ON true`;
export const trainingDto = (r: Row) => ({
  id: r.id as string,
  title: r.titel,
  category: r.kategorie ?? null,
  legalBasis: r.rechtsgrundlage ?? null,
  format: r.format,
  quizRequired: r.quiz_required,
  archived: !!r.archived_at,
  archivedAt: iso(r.archived_at),
  currentVersion: r.cv_id ? { id: r.cv_id as string, versionNo: r.cv_no as number, publishedAt: iso(r.cv_published_at) } : null,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

export const VERSION_SELECT = `v.id, v.training_id, v.version_no, v.status, v.file_name, v.file_size, v.sha256, v.page_count, v.word_count,
  v.change_kind, v.change_note, v.changed_pages, v.published_at, v.created_at`;
export const versionDto = (r: Row) => ({
  id: r.id as string,
  trainingId: r.training_id,
  versionNo: r.version_no,
  status: r.status,
  fileName: r.file_name,
  fileSize: Number(r.file_size),
  sha256: r.sha256,
  pageCount: r.page_count ?? null,
  wordCount: r.word_count ?? null,
  changeKind: r.change_kind ?? null,
  changeNote: r.change_note ?? null,
  changedPages: r.changed_pages ?? null,
  publishedAt: iso(r.published_at),
  createdAt: iso(r.created_at),
});

export const RUN_SELECT = `r.id, r.typ, r.training_id, r.training_version_id, r.titel, r.status, r.deadline, r.start_at, r.end_at, r.ort,
  r.ended_at, r.created_at,
  (SELECT count(*) FROM invitation i WHERE i.run_id = r.id)::int AS invited,
  (SELECT count(*) FROM invitation i WHERE i.run_id = r.id AND i.status = 'bestaetigt')::int AS completed`;
export const runDto = (r: Row) => ({
  id: r.id as string,
  type: r.typ,
  trainingId: r.training_id ?? null,
  trainingVersionId: r.training_version_id ?? null,
  title: r.titel ?? null,
  status: r.status,
  deadline: iso(r.deadline),
  startAt: iso(r.start_at),
  endAt: iso(r.end_at),
  location: r.ort ?? null,
  endedAt: iso(r.ended_at),
  invitationCount: r.invited,
  completedCount: r.completed,
  createdAt: iso(r.created_at),
});

export const INVITATION_SELECT = `i.id, i.run_id, i.person_id, i.status, i.due_at, i.sent_at, i.opened_at, i.read_completed_at, i.completed_at,
  i.auto_reason, i.created_at, i.updated_at,
  (i.status NOT IN ('bestaetigt','befreit') AND i.due_at IS NOT NULL AND i.due_at < now()) AS overdue`;
export const invitationDto = (r: Row) => ({
  id: r.id as string,
  runId: r.run_id,
  personId: r.person_id,
  status: r.status,
  overdue: r.overdue,
  autoReason: r.auto_reason ?? null,
  dueAt: iso(r.due_at),
  sentAt: iso(r.sent_at),
  openedAt: iso(r.opened_at),
  readCompletedAt: iso(r.read_completed_at),
  completedAt: iso(r.completed_at),
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

export const EVIDENCE_SELECT = `e.id, e.kind, e.status, e.revoked_at, e.revoked_reason, e.nachweis_nr, e.verify_code, e.pdf_sha256, e.seal_ts,
  e.invitation_id, e.attendance_id, e.external_record_id, app.evidence_person_id(e.id) AS person_id, e.retain_until::text AS retain_until, e.created_at`;
export const evidenceDto = (r: Row) => ({
  id: r.id as string,
  kind: r.kind,
  status: r.revoked_at ? 'widerrufen' : r.status,
  revokedAt: iso(r.revoked_at),
  revokedReason: r.revoked_reason ?? null,
  nachweisNr: r.nachweis_nr,
  verifyCode: r.verify_code,
  sha256: r.pdf_sha256 ?? null,
  sealedAt: iso(r.seal_ts),
  personId: r.person_id ?? null,
  invitationId: r.invitation_id ?? null,
  attendanceId: r.attendance_id ?? null,
  externalRecordId: r.external_record_id ?? null,
  retainUntil: day(r.retain_until),
  pdfUrl: r.status === 'erzeugt' ? `/api/v1/evidence/${r.id}/pdf` : null,
  createdAt: iso(r.created_at),
});

export const EXTERNAL_SELECT = `x.id, x.person_id, x.group_id, x.requirement_id, x.qualification_id, x.training_id, x.free_title, x.provider,
  x.held_on::text AS held_on, x.duration_hours::float8 AS duration_hours, x.duration_label, x.location, x.valid_until::text AS valid_until,
  x.is_medical, x.evidence_sha256, x.evidence_files, x.source, x.status, x.submitted_at, x.reviewed_at, x.review_note, x.supersedes,
  x.created_at, x.updated_at`;
export const externalDto = (r: Row) => ({
  id: r.id as string,
  personId: r.person_id,
  groupId: r.group_id ?? null,
  requirementId: r.requirement_id ?? null,
  qualificationId: r.qualification_id ?? null,
  trainingId: r.training_id ?? null,
  title: r.free_title ?? null,
  provider: r.provider ?? null,
  heldOn: day(r.held_on),
  durationHours: r.duration_hours ?? null,
  durationLabel: r.duration_label ?? null,
  location: r.location ?? null,
  validUntil: day(r.valid_until),
  isMedical: r.is_medical,
  source: r.source,
  status: r.status,
  receipts: ((r.evidence_files ?? []) as Array<{ name: string; mime: string; size: number; pages: number }>).map((f, i) => ({
    name: f.name, mime: f.mime, size: f.size, pages: f.pages, sha256: (r.evidence_sha256 ?? [])[i] ?? null,
  })),
  submittedAt: iso(r.submitted_at),
  reviewedAt: iso(r.reviewed_at),
  reviewNote: r.review_note ?? null,
  supersedes: r.supersedes ?? null,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

export const complianceDto = (r: Row) => ({
  personId: r.person_id as string,
  requirementId: r.requirement_id as string,
  qualificationId: r.qualification_id,
  trainingId: r.training_id,
  state: r.state,
  exempt: r.exempt,
  lastCompletedOn: day(r.last_completed_on),
  validUntil: day(r.valid_until),
  expiresOn: day(r.expires_on),
  intervalMonths: r.interval_months,
  graceDays: r.grace_days,
  source: r.source ?? null,
  sourceId: r.source_id ?? null,
});

export const qualificationDto = (r: Row) => ({ id: r.id as string, name: r.name, description: r.description ?? null, createdAt: iso(r.created_at) });
export const requirementDto = (r: Row) => ({
  id: r.id as string, qualificationId: r.qualification_id, trainingId: r.training_id, intervalMonths: r.interval_months, graceDays: r.grace_days,
  reinviteDays: r.reinvite_days, autoInvite: r.auto_invite, active: r.active, createdAt: iso(r.created_at),
});
