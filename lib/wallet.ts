import { createHmac, randomUUID } from 'node:crypto';
import { isUnconfirmed } from './fields';
import { splitName, foldName } from './registry';
import type { AuditEvent, Caregiver, Db, RequirementState, Submission } from './types';

// Portable credential wallet. A caregiver who works for several agencies lets one agency's confirmed records
// pre-fill the next agency's file.
//
// What it is: a shared holder-keyed store of *confirmed field values and expiry dates*, published only after the
// caregiver agrees by text, and offered to another agency only after the caregiver agrees again.
// What it is not: a way to skip review. Imported values arrive as source "imported", count as unconfirmed, and a
// person at the receiving agency still confirms each one; the registry is looked up again; originals (photos) never
// leave the agency that holds them; background checks are agency-specific and never travel.

export const WALLET_KEY = 'wallet';
const PENDING_DAYS = 7;
const DAY = 86_400_000;

export interface WalletCredential {
  agencyId: string;
  agencyName: string;
  requirementId: string;
  name: string;
  fields: { key: string; label: string; value: string | null }[];
  expiresOn?: string;
  confirmedBy: string;
  confirmedAt: string;
  registry?: { status?: string; checkedAt: string; by: string };
  publishedAt: string;
}
export interface WalletAccess { time: string; agencyId: string; agencyName: string; action: 'published' | 'withdrawn' | 'offered' | 'imported' | 'declined'; requirementIds?: string[] }
export interface WalletHolder { credentials: WalletCredential[]; access: WalletAccess[] }
export interface WalletPending { id: string; kind: 'share' | 'import'; agencyId: string; agencyName: string; caregiverId: string; createdAt: string }
export interface WalletDoc { version: 1; holders: Record<string, WalletHolder>; pending: WalletPending[] }

export const emptyWallet = (): WalletDoc => ({ version: 1, holders: {}, pending: [] });

/* ---------- identity ---------- */

export function walletEnabled() {
  return process.env.NODE_ENV !== 'production' || !!process.env.WALLET_PEPPER;
}
const pepper = () => {
  const p = process.env.WALLET_PEPPER;
  if (p) return p;
  if (process.env.NODE_ENV === 'production') throw new Error('Set WALLET_PEPPER to use the credential wallet.');
  return 'dev-only-pepper';
};

export function normalizePhone(raw: string): string {
  const d = raw.replace(/\D/g, '');
  const n = d.length === 10 ? `1${d}` : d;
  if (n.length < 10 || n.length > 15) throw new Error('That phone number cannot be used to find a wallet.');
  return `+${n}`;
}

/** The wallet is keyed by a keyed hash of the caregiver's phone number, so the store never holds the number itself. */
export const holderKey = (phone: string) => createHmac('sha256', pepper()).update(normalizePhone(phone)).digest('hex');

export const agencyIdOf = (db: Db) => db.agency.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agency';

/* ---------- publish ---------- */

const approveTime = (db: Db, cgId: string, reqId: string) =>
  [...db.audit].reverse().find((e: AuditEvent) => e.caregiverId === cgId && e.requirementId === reqId && e.action === 'approved the record')?.time;

/** Records this agency has approved, fully confirmed by a person, and that have not expired. */
export function snapshotCredentials(db: Db, caregiverId: string, now = new Date()): WalletCredential[] {
  const out: WalletCredential[] = [];
  for (const req of db.rules.requirements) {
    if (!req.smsCollectible) continue; // background checks stay with the agency that ran them
    const st = db.requirements.find((s) => s.caregiverId === caregiverId && s.requirementId === req.id);
    const sub = st?.approvedSubmissionId ? db.submissions.find((s) => s.id === st.approvedSubmissionId) : undefined;
    if (!st || !sub || (st.status !== 'approved' && st.status !== 'expiring')) continue;
    if (sub.fields.some(isUnconfirmed)) continue;
    if (st.expiresOn && Date.parse(st.expiresOn + 'T23:59:59Z') < now.getTime()) continue;
    const by = [...new Set(sub.fields.map((f) => f.verifiedBy).filter(Boolean))].join(', ') || db.agency.admin;
    const rc = sub.registryCheck;
    out.push({
      agencyId: agencyIdOf(db), agencyName: db.agency.name, requirementId: req.id, name: req.name,
      fields: sub.fields.map((f) => ({ key: f.key, label: f.label, value: f.value })),
      ...(st.expiresOn ? { expiresOn: st.expiresOn } : {}),
      confirmedBy: by, confirmedAt: approveTime(db, caregiverId, req.id) ?? sub.createdAt,
      ...(rc ? { registry: { status: rc.status, checkedAt: rc.checkedAt, by: rc.by } } : {}),
      publishedAt: now.toISOString(),
    });
  }
  return out;
}

const holder = (doc: WalletDoc, key: string) => (doc.holders[key] ??= { credentials: [], access: [] });

export function publish(doc: WalletDoc, key: string, creds: WalletCredential[], agency: { id: string; name: string }, now = new Date()) {
  const h = holder(doc, key);
  h.credentials = [...h.credentials.filter((c) => c.agencyId !== agency.id), ...creds];
  h.access.push({ time: now.toISOString(), agencyId: agency.id, agencyName: agency.name, action: 'published', requirementIds: creds.map((c) => c.requirementId) });
}

/** Removes everything this agency published for the holder (or everything, if agencyId is omitted). */
export function withdraw(doc: WalletDoc, key: string, agency: { id: string; name: string }, everything = false, now = new Date()) {
  const h = doc.holders[key];
  if (!h) return 0;
  const before = h.credentials.length;
  h.credentials = h.credentials.filter((c) => (everything ? false : c.agencyId !== agency.id));
  const removed = before - h.credentials.length;
  if (removed) h.access.push({ time: now.toISOString(), agencyId: agency.id, agencyName: agency.name, action: 'withdrawn' });
  return removed;
}

/* ---------- consent requests ---------- */

export function addPending(doc: WalletDoc, p: Omit<WalletPending, 'id' | 'createdAt'>, now = new Date()): WalletPending {
  doc.pending = doc.pending.filter((x) => !(x.kind === p.kind && x.agencyId === p.agencyId && x.caregiverId === p.caregiverId));
  const entry = { ...p, id: randomUUID(), createdAt: now.toISOString() };
  doc.pending.push(entry);
  return entry;
}

/** Takes (and removes) the unexpired consent request waiting on this caregiver at this agency, if any. */
export function takePending(doc: WalletDoc, agencyId: string, caregiverId: string, now = new Date()): WalletPending | undefined {
  doc.pending = doc.pending.filter((p) => now.getTime() - Date.parse(p.createdAt) <= PENDING_DAYS * DAY);
  const hit = [...doc.pending].reverse().find((p) => p.agencyId === agencyId && p.caregiverId === caregiverId);
  if (hit) doc.pending = doc.pending.filter((p) => p.id !== hit.id);
  return hit;
}
export const hasPending = (doc: WalletDoc, agencyId: string, caregiverId: string, now = new Date()) =>
  doc.pending.some((p) => p.agencyId === agencyId && p.caregiverId === caregiverId && now.getTime() - Date.parse(p.createdAt) <= PENDING_DAYS * DAY);

/* ---------- read & import ---------- */

/** What other agencies published for this holder, newest confirmation per requirement, unexpired. */
export function availableFor(doc: WalletDoc, key: string, agencyId: string, now = new Date()): WalletCredential[] {
  const best = new Map<string, WalletCredential>();
  for (const c of doc.holders[key]?.credentials ?? []) {
    if (c.agencyId === agencyId) continue;
    if (c.expiresOn && Date.parse(c.expiresOn + 'T23:59:59Z') < now.getTime()) continue;
    const cur = best.get(c.requirementId);
    if (!cur || c.confirmedAt > cur.confirmedAt) best.set(c.requirementId, c);
  }
  return [...best.values()];
}

const sameNameLoose = (a: string, b: string) => {
  const x = splitName(a), y = splitName(b);
  return foldName(x.firstName) === foldName(y.firstName) && foldName(x.lastName) === foldName(y.lastName);
};

export interface ImportResult { imported: { requirementId: string; submissionId: string }[]; skipped: { requirementId: string; why: string }[] }

/** Creates a "ready for review" record per usable credential. Never approves anything. */
export function importCredentials(db: Db, cg: Caregiver, creds: WalletCredential[], newId: (p: string) => string, now = new Date()): ImportResult {
  const res: ImportResult = { imported: [], skipped: [] };
  for (const c of creds) {
    const skip = (why: string) => res.skipped.push({ requirementId: c.requirementId, why });
    const req = db.rules.requirements.find((r) => r.id === c.requirementId);
    if (!req || !req.smsCollectible) { skip('This agency does not use that requirement.'); continue; }
    const st = db.requirements.find((s) => s.caregiverId === cg.id && s.requirementId === req.id) as RequirementState | undefined;
    if (!st || (st.status !== 'missing' && st.status !== 'expiring')) { skip('Already approved or in progress here.'); continue; }
    const docName = c.fields.find((f) => f.key === 'name')?.value;
    if (docName && !sameNameLoose(docName, cg.name)) { skip('The name on the wallet record differs from this caregiver.'); continue; }
    const ref = `Wallet · confirmed by ${c.confirmedBy} at ${c.agencyName} on ${c.confirmedAt.slice(0, 10)}`;
    const sub: Submission = {
      id: newId('sub'), caregiverId: cg.id, requirementId: req.id, files: [], extractedBy: 'none', createdAt: now.toISOString(), state: 'ready', followUps: 0,
      fields: req.fields.map((spec) => {
        const v = c.fields.find((f) => f.key === spec.key)?.value ?? null;
        return { key: spec.key, label: spec.label, required: spec.required, value: v, source: 'imported' as const, ...(v !== null ? { sourceRef: ref } : {}) };
      }),
    };
    db.submissions.push(sub);
    st.status = 'pending-review';
    st.openSubmissionId = sub.id;
    st.explanation = `Pre-filled from ${cg.firstName}'s credential wallet (confirmed at ${c.agencyName}). A person here still has to confirm each field.`;
    res.imported.push({ requirementId: req.id, submissionId: sub.id });
  }
  return res;
}

/* ---------- caregiver-facing copy ---------- */

export type WalletSms = 'share-ask' | 'import-ask' | 'share-ok' | 'import-ok' | 'declined';
export function walletSms(kind: WalletSms, cg: Pick<Caregiver, 'firstName' | 'language'>, agency: string): string {
  const f = cg.firstName;
  if (cg.language === 'es') {
    switch (kind) {
      case 'share-ask': return `¡Hola ${f}! ${agency} puede guardar tus registros verificados en tu cartera CareLoop para que otras agencias donde trabajes no te los pidan otra vez. Tú decides. Responde SI para permitirlo, o ignora este mensaje.`;
      case 'import-ask': return `¡Hola ${f}! ${agency} encontró registros verificados en tu cartera CareLoop de otra agencia. Responde SI para que ${agency} los use (no tendrás que enviar fotos otra vez), o NO.`;
      case 'share-ok': return `¡Listo, ${f}! Guardamos tus registros verificados. Puedes pedirle a ${agency} que los quite cuando quieras.`;
      case 'import-ok': return `¡Gracias, ${f}! ${agency} usará esos registros y la oficina los confirmará.`;
      case 'declined': return `De acuerdo, ${f}. No se compartirá nada.`;
    }
  }
  switch (kind) {
    case 'share-ask': return `Hi ${f}! ${agency} can save your verified records to your CareLoop wallet so other agencies you work for don't ask for them again. It's your call. Reply YES to allow, or ignore this.`;
    case 'import-ask': return `Hi ${f}! ${agency} found verified records in your CareLoop wallet from another agency. Reply YES to let ${agency} use them (no need to resend photos), or NO.`;
    case 'share-ok': return `Done, ${f}! Your verified records are saved. Ask ${agency} any time to remove them.`;
    case 'import-ok': return `Thanks, ${f}! ${agency} will use those records and the office will confirm them.`;
    case 'declined': return `No problem, ${f}. Nothing will be shared.`;
  }
}

const YES = /^\s*(yes|y|yep|ok|okay|si|sí|sure|allow|compartir|share)\s*[.!]*\s*$/i;
const NO = /^\s*(no|n|nope|deny)\s*[.!]*\s*$/i;
export const isYes = (t: string) => YES.test(t);
export const isNo = (t: string) => NO.test(t);

/* ---------- demo data ---------- */

/** A sample "other agency" so the second-agency path can be shown without a second deployment. */
export function demoWallet(now = new Date()): WalletDoc {
  const doc = emptyWallet();
  const d = (n: number) => new Date(now.getTime() + n * DAY).toISOString();
  publish(doc, holderKey('(909) 555-0131'), [{
    agencyId: 'harbor-home-health', agencyName: 'Harbor Home Health (sample)', requirementId: 'initial_training', name: 'Entry-level training',
    fields: [
      { key: 'name', label: 'Caregiver name', value: 'Luis Hernández' }, { key: 'course', label: 'Training course', value: 'Entry-level caregiver training' },
      { key: 'completion_date', label: 'Completion date', value: d(-200).slice(0, 10) }, { key: 'hours', label: 'Training hours', value: '6' }, { key: 'issuer', label: 'Issuing organization', value: 'Harbor Training Institute' },
    ],
    confirmedBy: 'Priya (Admin)', confirmedAt: d(-190), publishedAt: d(-190),
  }], { id: 'harbor-home-health', name: 'Harbor Home Health (sample)' }, new Date(d(-190)));
  return doc;
}
