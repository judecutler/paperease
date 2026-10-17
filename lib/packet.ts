import { createHash } from 'node:crypto';
import { assess, maskPerId, needsRegistryCheck, normalizePerId } from './registry';
import type { AuditEvent, Caregiver, Db, ExtractedFieldValue, RegistryCheck, RequirementType, Submission, SubmissionFile } from './types';

// Audit-ready personnel file. Everything here is derived from records the app already keeps; nothing
// is invented. buildPacket() is pure (no clock, no disk), so it is easy to test and to re-run for an auditor.

const DAY = 86_400_000;

export type ItemIssue =
  | 'not-approved'
  | 'no-record'
  | 'expired'
  | 'unverified-fields'
  | 'no-original'
  | 'registry';

export interface PacketField { key: string; label: string; value: string | null; source: ExtractedFieldValue['source']; checkedBy?: string; sourceRef?: string }
export interface PacketEvent { time: string; who: string; action: string; detail?: string }
export interface PacketFile extends SubmissionFile { }

export interface PacketItem {
  requirementId: string;
  name: string;
  rule: string;
  /** staff-collected items (background check) are never gathered by text, so the original is kept by the agency */
  collectedByStaff: boolean;
  status: string;
  expiresOn?: string;
  daysLeft?: number;
  ready: boolean;
  issues: { code: ItemIssue; text: string }[];
  fields: PacketField[];
  files: PacketFile[];
  registry?: { outcome: RegistryCheck['outcome']; status?: string; idMasked: string; checkedAt: string; checkedBy: string; searchedName: string; note?: string; verdict: string };
  /** every submission for this requirement, newest first, so superseded documents stay visible */
  versions: { id: string; createdAt: string; state: Submission['state']; current: boolean; supersedes?: string }[];
  events: PacketEvent[];
}

export interface Packet {
  caregiver: { id: string; name: string; phone: string; language: string; hiredOn: string };
  agency: string;
  asOf: string;
  readiness: { score: number; ready: number; total: number; auditReady: boolean };
  blockers: string[];
  items: PacketItem[];
  /** every caregiver-level event (outreach, replies, opt-out) in order */
  timeline: PacketEvent[];
  /** hash of the content above; changes if any record changes, so a printed copy can be matched to the system */
  fingerprint: string;
}

const isChecked = (f: ExtractedFieldValue) => f.source === 'verified' || f.source === 'edited';
const whoOf = (e: AuditEvent) => e.who || ({ agent: 'PaperEase agent', admin: 'Admin', caregiver: 'Caregiver', system: 'System' } as const)[e.actor];
const toEvent = (e: AuditEvent): PacketEvent => ({ time: e.time, who: whoOf(e), action: e.action, ...(e.detail ? { detail: e.detail } : {}) });

function buildItem(db: Db, cg: Caregiver, req: RequirementType, asOf: Date): PacketItem {
  const state = db.requirements.find((s) => s.caregiverId === cg.id && s.requirementId === req.id);
  const subs = db.submissions.filter((s) => s.caregiverId === cg.id && s.requirementId === req.id);
  const approvedSub = state?.approvedSubmissionId ? subs.find((s) => s.id === state.approvedSubmissionId) : undefined;
  const issues: PacketItem['issues'] = [];
  const status = state?.status ?? 'missing';
  const daysLeft = state?.expiresOn ? Math.ceil((Date.parse(state.expiresOn + 'T23:59:59Z') - asOf.getTime()) / DAY) : undefined;
  const collectedByStaff = !req.smsCollectible;

  if (!state || (status !== 'approved' && status !== 'expiring')) {
    issues.push({ code: 'not-approved', text: `Not approved yet (${status.replace('-', ' ')}).` });
  } else if (!approvedSub) {
    issues.push({ code: 'no-record', text: 'Marked approved, but no scanned record is attached to it.' });
  }
  if (daysLeft !== undefined && daysLeft < 0) issues.push({ code: 'expired', text: `Expired ${-daysLeft} day${daysLeft === -1 ? '' : 's'} ago.` });

  const fields: PacketField[] = (approvedSub?.fields ?? []).map((f) => ({
    key: f.key, label: f.label, value: f.value, source: f.source, ...(f.verifiedBy ? { checkedBy: f.verifiedBy } : {}), ...(f.sourceRef ? { sourceRef: f.sourceRef } : {}),
  }));
  if (approvedSub) {
    const open = approvedSub.fields.filter((f) => (f.value !== null && !isChecked(f)) || (f.required && f.value === null));
    if (open.length) issues.push({ code: 'unverified-fields', text: `${open.length} field${open.length === 1 ? ' was' : 's were'} never confirmed by a person: ${open.map((f) => f.label.toLowerCase()).join(', ')}.` });
    if (!approvedSub.files.length && !collectedByStaff) issues.push({ code: 'no-original', text: 'No original document image is attached.' });
  }

  let registry: PacketItem['registry'];
  if (needsRegistryCheck(req.id) && approvedSub) {
    const rc = approvedSub.registryCheck;
    if (rc) {
      const v = assess(rc);
      registry = { outcome: rc.outcome, status: rc.status, idMasked: rc.perIdMasked, checkedAt: rc.checkedAt, checkedBy: rc.by === 'manual' ? (rc.checkedBy ?? 'Staff') : 'Automatic lookup', searchedName: rc.searchedName, ...(rc.note ? { note: rc.note } : {}), verdict: v.kind };
      if (v.kind !== 'pass') issues.push({ code: 'registry', text: 'The California registry check does not show an active registration.' });
    } else {
      const num = approvedSub.fields.find((f) => f.key === 'registration_number')?.value;
      issues.push({ code: 'registry', text: 'No California registry lookup is recorded for this registration.' });
      if (num) registry = { outcome: 'unavailable', idMasked: maskPerId(normalizePerId(num)), checkedAt: '', checkedBy: '—', searchedName: cg.name, verdict: 'none' };
    }
  }

  const sorted = [...subs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const events = db.audit.filter((e) => e.caregiverId === cg.id && e.requirementId === req.id).map(toEvent);

  return {
    requirementId: req.id, name: req.name, rule: req.rule, collectedByStaff, status,
    ...(state?.expiresOn ? { expiresOn: state.expiresOn } : {}), ...(daysLeft !== undefined ? { daysLeft } : {}),
    ready: issues.length === 0, issues, fields, files: approvedSub ? approvedSub.files : [], ...(registry ? { registry } : {}),
    versions: sorted.map((s) => ({ id: s.id, createdAt: s.createdAt, state: s.state, current: s.id === approvedSub?.id, ...(s.supersedes ? { supersedes: s.supersedes } : {}) })),
    events,
  };
}

export function buildPacket(db: Db, caregiverId: string, asOf: Date = new Date()): Packet {
  const cg = db.caregivers.find((c) => c.id === caregiverId);
  if (!cg) throw new Error('No caregiver with this id.');
  const items = db.rules.requirements.map((r) => buildItem(db, cg, r, asOf));
  const ready = items.filter((i) => i.ready).length;
  const blockers = items.flatMap((i) => i.issues.map((x) => `${i.name}: ${x.text}`));
  const body = {
    caregiver: { id: cg.id, name: cg.name, phone: cg.phone, language: cg.language, hiredOn: cg.hiredOn },
    agency: db.agency.name,
    readiness: { score: items.length ? Math.round((ready / items.length) * 100) : 0, ready, total: items.length, auditReady: items.length > 0 && ready === items.length },
    blockers,
    items,
    timeline: db.audit.filter((e) => e.caregiverId === cg.id && !e.requirementId).map(toEvent),
  };
  const fingerprint = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  return { ...body, asOf: asOf.toISOString(), fingerprint };
}

/** One row per caregiver for the agency-level "are we ready for an unannounced visit?" view. */
export function agencyReadiness(db: Db, asOf: Date = new Date()) {
  const rows = db.caregivers.map((c) => {
    const p = buildPacket(db, c.id, asOf);
    return { caregiverId: c.id, name: c.name, score: p.readiness.score, ready: p.readiness.ready, total: p.readiness.total, auditReady: p.readiness.auditReady, blockers: p.blockers };
  });
  const average = rows.length ? Math.round(rows.reduce((n, r) => n + r.score, 0) / rows.length) : 0;
  return { asOf: asOf.toISOString(), average, auditReady: rows.filter((r) => r.auditReady).length, total: rows.length, rows };
}

/* ---------------- rendering ---------------- */

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const day = (s?: string) => (s ? new Date(s.length === 10 ? s + 'T12:00:00Z' : s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—');
const stamp = (s: string) => new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' });

const SOURCE_TEXT: Record<ExtractedFieldValue['source'], string> = { verified: 'Confirmed by', edited: 'Corrected by', ai: 'Read by AI, not confirmed', caregiver: 'Reported by caregiver, not confirmed', imported: 'Imported from the caregiver\u2019s wallet, not confirmed' };

export interface Original { sha256: string; bytes: number; dataUri?: string; missing?: boolean }

/** Self-contained printable page. Originals are embedded so the file still works offline in front of an auditor. */
export function renderPacketHtml(p: Packet, originals: Record<string, Original> = {}): string {
  const item = (i: PacketItem) => {
    const badge = i.ready ? '<span class="ok">Audit ready</span>' : '<span class="bad">Needs attention</span>';
    const fields = i.fields.length
      ? `<table><thead><tr><th>Field</th><th>Value</th><th>Who confirmed it</th></tr></thead><tbody>${i.fields.map((f) => `<tr><td>${esc(f.label)}</td><td>${f.value === null ? '<em>Not provided</em>' : esc(f.value)}</td><td>${f.source === 'verified' || f.source === 'edited' ? `${SOURCE_TEXT[f.source]} ${esc(f.checkedBy || 'staff')}` : `<span class="bad">${SOURCE_TEXT[f.source]}</span>`}${f.sourceRef ? `<div class="mut">${esc(f.sourceRef)}</div>` : ''}</td></tr>`).join('')}</tbody></table>`
      : '<p class="mut">No record fields on file.</p>';
    const files = i.files.length
      ? i.files.map((f) => {
          const o = originals[f.url];
          const meta = o ? (o.missing ? '<div class="bad">File could not be read from storage.</div>' : `<div class="mut mono">SHA-256 ${esc(o.sha256)} · ${o.bytes.toLocaleString('en-US')} bytes</div>`) : '';
          const view = o?.dataUri ? (f.mime.startsWith('image/') ? `<img src="${esc(o.dataUri)}" alt="${esc(f.name)}">` : `<a href="${esc(o.dataUri)}" download="${esc(f.name)}">Download ${esc(f.name)}</a>`) : '';
          return `<figure><figcaption>${esc(f.name)}</figcaption>${view}${meta}</figure>`;
        }).join('')
      : i.collectedByStaff ? '<p class="mut">Kept by the agency outside PaperEase (not collected by text).</p>' : '<p class="bad">No original on file.</p>';
    const reg = i.registry
      ? `<div class="box"><strong>California registry lookup</strong> ${i.registry.verdict === 'pass' ? '<span class="ok">Active</span>' : '<span class="bad">Not confirmed</span>'}<br>ID ${esc(i.registry.idMasked)} · name searched “${esc(i.registry.searchedName)}” · status ${esc(i.registry.status ?? i.registry.outcome)}${i.registry.checkedAt ? ` · ${esc(stamp(i.registry.checkedAt))} · ${esc(i.registry.checkedBy)}` : ''}${i.registry.note ? `<div class="mut">${esc(i.registry.note)}</div>` : ''}</div>`
      : '';
    const versions = i.versions.length > 1 ? `<h4>Version history</h4><ul>${i.versions.map((v) => `<li>${esc(stamp(v.createdAt))} · ${esc(v.state)}${v.current ? ' · <strong>current record</strong>' : ''}${v.supersedes ? ' · replaced an earlier submission' : ''}</li>`).join('')}</ul>` : '';
    const events = i.events.length ? `<h4>Who did what</h4><ol class="log">${i.events.map((e) => `<li><time>${esc(stamp(e.time))}</time> <strong>${esc(e.who)}</strong> ${esc(e.action)}${e.detail ? ` <span class="mut">${esc(e.detail)}</span>` : ''}</li>`).join('')}</ol>` : '';
    return `<section class="item"><h3>${esc(i.name)} ${badge}</h3><p class="mut">${esc(i.rule)}</p><p><strong>Status:</strong> ${esc(i.status)}${i.expiresOn ? ` · valid until ${esc(day(i.expiresOn))}${i.daysLeft !== undefined ? ` (${i.daysLeft < 0 ? 'expired' : `${i.daysLeft} days left`})` : ''}` : ''}</p>${i.issues.length ? `<ul class="issues">${i.issues.map((x) => `<li>${esc(x.text)}</li>`).join('')}</ul>` : ''}${fields}${reg}<h4>Original documents</h4>${files}${versions}${events}</section>`;
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Personnel file: ${esc(p.caregiver.name)}</title><style>
body{font:14px/1.5 system-ui,sans-serif;color:#1d1d1b;max-width:860px;margin:24px auto;padding:0 16px}h1{margin:0}h3{margin:0 0 4px;display:flex;gap:10px;align-items:center}h4{margin:14px 0 4px}
.item{border:1px solid #d8d6cf;border-radius:8px;padding:14px 16px;margin:14px 0;break-inside:avoid}.mut{color:#6b6a63;font-size:12px}.mono{font-family:ui-monospace,monospace;word-break:break-all}
.ok{background:#e3f1e6;color:#1f5d2c;padding:1px 8px;border-radius:99px;font-size:12px}.bad{color:#a02c1b}span.bad{background:#fbe9e5;padding:1px 8px;border-radius:99px;font-size:12px}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #e7e5de;text-align:left;padding:5px 6px;vertical-align:top}.box{background:#f5f4ef;border-radius:6px;padding:8px 10px;margin:8px 0}
img{max-width:100%;max-height:420px;border:1px solid #d8d6cf;border-radius:4px}figure{margin:8px 0}.log{padding-left:18px;font-size:12px}.score{font-size:40px;font-weight:700;margin:0}.issues{color:#a02c1b}
header{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;border-bottom:2px solid #1d1d1b;padding-bottom:12px}@media print{body{margin:0}.item{border-color:#999}}</style></head><body>
<header><div><h1>${esc(p.caregiver.name)}</h1><div class="mut">${esc(p.agency)} · hired ${esc(day(p.caregiver.hiredOn))} · ${esc(p.caregiver.phone)}</div><div class="mut">Prepared ${esc(stamp(p.asOf))}</div></div>
<div><p class="score">${p.readiness.score}%</p><div class="mut">${p.readiness.ready} of ${p.readiness.total} requirements audit ready</div><div>${p.readiness.auditReady ? '<span class="ok">Audit ready</span>' : '<span class="bad">Not audit ready</span>'}</div></div></header>
${p.blockers.length ? `<section class="item"><h3>What would stop this file passing</h3><ul class="issues">${p.blockers.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></section>` : ''}
<p class="mut">“Audit ready” means: a person approved the record, every field was confirmed by a person, the original is attached, nothing has expired${p.items.some((i) => i.registry) ? ', and the California registry lookup shows an active registration' : ''}. It is a documentation check, not a legal opinion; rules are set in Rules.</p>
${p.items.map(item).join('')}
${p.timeline.length ? `<section class="item"><h3>Outreach and contact history</h3><ol class="log">${p.timeline.map((e) => `<li><time>${esc(stamp(e.time))}</time> <strong>${esc(e.who)}</strong> ${esc(e.action)}${e.detail ? ` <span class="mut">${esc(e.detail)}</span>` : ''}</li>`).join('')}</ol></section>` : ''}
<p class="mut mono">Record fingerprint ${esc(p.fingerprint)}</p></body></html>`;
}
