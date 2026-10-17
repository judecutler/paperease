import { load, newId, save, reset } from './db';
import { draftSms, extractDocument, interpretReply, isOptOut, type SmsKind } from './llm';
import { linkUrl } from './links';
import { findSample } from './samples';
import { inspectPhoto, sameCaregiverName, uncheckedPhoto } from './photo-check';
import { approvalBlocker, findPerIdInText, needsRegistryCheck, REGISTRY_REASON_PREFIX, registryEscalation } from './registry';
import { checkRegistry, manualRegistryCheck } from './registry-providers';
import type { Actor, Caregiver, Db, ExtractedFieldValue, RegistryStatus, RequirementState, RequirementType, SmsMessage, Submission, SubmissionFile } from './types';

export type Action =
  | { type: 'run-gap-check' }
  | { type: 'run-sweep'; trigger?: 'schedule' | 'admin' }
  | { type: 'authorize-outreach'; caregiverId: string; requirementId: string }
  | { type: 'authorize-all' }
  | { type: 'send-reminder'; caregiverId: string; requirementId: string }
  | { type: 'caregiver-reply'; caregiverId: string; text?: string; sampleId?: string; upload?: SubmissionFile; requirementId?: string; via?: 'link' }
  | { type: 'verify-field'; submissionId: string; key: string }
  | { type: 'edit-field'; submissionId: string; key: string; value: string }
  | { type: 'approve'; submissionId: string }
  | { type: 'reject'; submissionId: string; reason?: string }
  | { type: 'request-another'; submissionId: string }
  | { type: 'staff-record'; caregiverId: string; requirementId: string; upload?: SubmissionFile }
  | { type: 'attach-file'; submissionId: string; upload: SubmissionFile }
  | { type: 'check-registry'; submissionId: string }
  | { type: 'record-registry-check'; submissionId: string; result: RegistryStatus | 'NOT_FOUND' }
  | { type: 'add-caregiver'; name: string; phone: string; language: 'en' | 'es' }
  | { type: 'update-rules'; expiringWithinDays: number; minConfidence: number; maxFollowUps: number; autoRequest: boolean; reminderAfterDays: number; maxReminders: number }
  | { type: 'reset' };

const OPEN: RequirementState['status'][] = ['requested', 'following-up'];
const now = () => new Date().toISOString();

// texts that ask the caregiver for something carry the secure upload link for that request
const LINK_KINDS: SmsKind[] = ['request', 'reminder', 'follow-up', 'wrong-doc', 'request-another'];

class Ctx {
  /** origin is the app's public URL, used to build upload links; without it texts go out with no link.
   *  admin is the signed-in person acting, recorded on decisions; demo mode without login uses the agency's admin. */
  admin: string;
  constructor(public db: Db, public origin?: string, admin?: string) {
    this.admin = admin || db.agency.admin;
  }
  caregiver(id: string) {
    const c = this.db.caregivers.find((x) => x.id === id);
    if (!c) throw new Error(`Unknown caregiver ${id}`);
    return c;
  }
  req(id: string) {
    const r = this.db.rules.requirements.find((x) => x.id === id);
    if (!r) throw new Error(`Unknown requirement ${id}`);
    return r;
  }
  state(caregiverId: string, requirementId: string) {
    const s = this.db.requirements.find((x) => x.caregiverId === caregiverId && x.requirementId === requirementId);
    if (!s) throw new Error('Unknown requirement state');
    return s;
  }
  sub(id: string) {
    const s = this.db.submissions.find((x) => x.id === id);
    if (!s) throw new Error(`Unknown submission ${id}`);
    return s;
  }
  log(e: { caregiverId?: string; requirementId?: string; actor: Actor; who?: string; action: string; detail?: string }) {
    this.db.audit.push({ id: newId('ev'), time: now(), ...e });
  }
  async sms(kind: SmsKind, cg: Caregiver, req: RequirementType, extra: { missingField?: { key: string; label: string }; documentType?: string } = {}) {
    if (cg.optedOut && kind !== 'opted-out') return;
    let text = await draftSms(kind, { caregiver: cg, requirement: req, ...extra });
    // appended after drafting so the model never writes or sees the URL
    const subId = this.db.requirements.find((s) => s.caregiverId === cg.id && s.requirementId === req.id)?.openSubmissionId;
    const link = this.origin && subId && LINK_KINDS.includes(kind) ? linkUrl(this.origin, subId) : null;
    if (link) text += `\n${cg.language === 'es' ? 'O súbelo aquí' : 'Or upload it here'}: ${link}`;
    this.db.messages.push({ id: newId('msg'), caregiverId: cg.id, from: 'agent', text, time: now() });
    return text;
  }
}

/* ---------------- gap detection ---------------- */

function addMonths(dateStr: string, months: number) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}
const daysUntil = (dateStr: string) => Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
const fmt = (dateStr: string) => new Date(dateStr + (dateStr.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function detectGaps(db: Db) {
  const changes: string[] = [];
  for (const s of db.requirements) {
    const req = db.rules.requirements.find((r) => r.id === s.requirementId)!;
    const cg = db.caregivers.find((c) => c.id === s.caregiverId)!;
    if ((s.status === 'approved' || s.status === 'expiring') && s.expiresOn) {
      const left = daysUntil(s.expiresOn);
      if (left < 0) {
        s.status = 'missing';
        s.explanation = `Expired on ${fmt(s.expiresOn)}. ${req.rule}`;
        changes.push(`${cg.name}: ${req.name} expired`);
      } else if (left <= db.rules.expiringWithinDays) {
        if (s.status !== 'expiring') changes.push(`${cg.name}: ${req.name} expires in ${left} days`);
        s.status = 'expiring';
        s.explanation = `Expires ${fmt(s.expiresOn)} (in ${left} days). Renew before it lapses.`;
      } else if (s.status === 'expiring') {
        s.status = 'approved';
        s.explanation = 'Approved record on file.';
      }
    }
    if (s.status === 'missing' && !req.smsCollectible && !s.explanation.includes('staff')) {
      s.explanation += ' Collected by agency staff, not over SMS.';
    }
  }
  return changes;
}

/* ---------------- record evaluation ---------------- */

export function unverifiedCount(sub: Submission) {
  return sub.fields.filter((f) => (f.value !== null && (f.source === 'ai' || f.source === 'caregiver')) || (f.required && f.value === null)).length;
}

type Verdict = { kind: 'ready' } | { kind: 'follow-up'; field: ExtractedFieldValue } | { kind: 'escalate'; reason: string };

function evaluate(c: Ctx, sub: Submission, cg: Caregiver, req: RequirementType): Verdict {
  const minConf = c.db.rules.minConfidence;
  const name = sub.fields.find((f) => f.key === 'name');
  if (name?.value && (name.confidence ?? 1) >= minConf && !sameCaregiverName(name.value, cg.name)) {
    return { kind: 'escalate', reason: `The document is in the name "${name.value}", which does not match ${cg.name}.` };
  }
  const low = sub.fields.find((f) => f.required && f.value !== null && f.source === 'ai' && (f.confidence ?? 1) < minConf);
  if (low) return { kind: 'escalate', reason: `${low.label} was read at only ${Math.round((low.confidence ?? 0) * 100)}% confidence. The agent did not guess.` };
  const hours = sub.fields.find((f) => f.key === 'hours');
  if (req.minHours && hours?.value && Number(hours.value) < req.minHours) {
    return { kind: 'escalate', reason: `${hours.source === 'caregiver' ? `${cg.firstName} reported` : 'The document shows'} ${hours.value} training hours; this requirement needs at least ${req.minHours}.` };
  }
  const missing = sub.fields.find((f) => f.required && !f.value?.trim());
  if (missing) {
    if (sub.followUps >= c.db.rules.maxFollowUps) {
      return { kind: 'escalate', reason: `${missing.label} is still missing after ${sub.followUps} follow-ups.` };
    }
    return { kind: 'follow-up', field: missing };
  }
  const registryReason = sub.registryCheck && registryEscalation(sub.registryCheck);
  if (registryReason) return { kind: 'escalate', reason: registryReason };
  return { kind: 'ready' };
}

/* ---------------- California HCA registry ---------------- */

const registryNumber = (sub: Submission) => sub.fields.find((f) => f.key === 'registration_number');

/**
 * Looks the aide up on the registry with the caregiver's name on file and the number from the document.
 * Skips when there is no number yet, or when the number was read at a confidence the agent would not trust anyway.
 */
async function lookUpRegistry(c: Ctx, sub: Submission, cg: Caregiver, req: RequirementType) {
  const num = registryNumber(sub);
  if (!needsRegistryCheck(req.id) || !num?.value) return;
  if (num.source === 'ai' && (num.confidence ?? 1) < c.db.rules.minConfidence) return;
  sub.registryCheck = await checkRegistry(cg.name, num.value);
  const r = sub.registryCheck;
  const result = r.outcome === 'found' ? r.status : r.outcome === 'not-found' ? 'no match' : 'could not check';
  c.log({
    caregiverId: cg.id,
    requirementId: req.id,
    actor: 'agent',
    action: 'checked the California HCA registry',
    detail: `${cg.name}, ID ${r.perIdMasked}: ${result}${r.note && r.outcome !== 'not-found' ? `. ${r.note}` : ''} (${r.by === 'demo' ? 'demo registry' : 'manual'})`,
  });
}

const evaluateFresh = async (c: Ctx, sub: Submission, cg: Caregiver, req: RequirementType) => {
  await lookUpRegistry(c, sub, cg, req);
  return evaluate(c, sub, cg, req);
};

/**
 * After a person (not the agent) changes or records a registry result: stop the record if the registry says no,
 * and release it again if a registry escalation no longer applies. Never touches other kinds of escalation.
 */
function settleRegistry(sub: Submission, state: RequirementState) {
  if (!sub.registryCheck || (sub.state !== 'ready' && sub.state !== 'escalated')) return;
  const reason = registryEscalation(sub.registryCheck);
  const otherEscalation = sub.state === 'escalated' && !sub.escalation?.startsWith(REGISTRY_REASON_PREFIX);
  if (reason && !otherEscalation) {
    sub.state = 'escalated';
    sub.escalation = reason;
    state.status = 'escalated';
    state.explanation = reason;
  } else if (sub.state === 'escalated' && sub.escalation?.startsWith(REGISTRY_REASON_PREFIX)) {
    sub.state = 'ready';
    sub.escalation = undefined;
    state.status = 'pending-review';
    state.explanation = 'Record prepared from the caregiver’s submission. Waiting for a person to verify.';
  }
}

async function applyVerdict(c: Ctx, v: Verdict, sub: Submission, state: RequirementState, cg: Caregiver, req: RequirementType, docType?: string) {
  if (v.kind === 'ready') {
    sub.state = 'ready';
    state.status = 'pending-review';
    state.explanation = 'Record prepared from the caregiver’s submission. Waiting for a person to verify.';
    await c.sms('thanks', cg, req);
    c.log({ caregiverId: cg.id, requirementId: req.id, actor: 'agent', action: 'prepared a record for review', detail: `${sub.fields.filter((f) => f.value).length} fields filled, original attached.` });
  } else if (v.kind === 'follow-up') {
    sub.state = 'collecting';
    sub.followUps += 1;
    state.status = 'following-up';
    state.explanation = `${v.field.label} not found on what ${cg.firstName} sent. Agent asked a follow-up question.`;
    await c.sms('follow-up', cg, req, { missingField: { key: v.field.key, label: v.field.label }, documentType: docType });
    c.log({ caregiverId: cg.id, requirementId: req.id, actor: 'agent', action: 'asked a follow-up question', detail: `${v.field.label} missing (follow-up ${sub.followUps} of ${c.db.rules.maxFollowUps}).` });
  } else {
    sub.state = 'escalated';
    sub.escalation = v.reason;
    state.status = 'escalated';
    state.explanation = v.reason;
    await c.sms('escalated', cg, req);
    c.log({ caregiverId: cg.id, requirementId: req.id, actor: 'agent', action: 'escalated to an admin', detail: v.reason });
  }
}

/* ---------------- caregiver replies ---------------- */

function openStateFor(c: Ctx, cgId: string, requirementId?: string) {
  const open = c.db.requirements.filter((s) => s.caregiverId === cgId && OPEN.includes(s.status) && s.openSubmissionId);
  if (requirementId) return open.find((s) => s.requirementId === requirementId);
  // Never silently attach a reply to the wrong request when several are open.
  return open.length === 1 ? open[0] : undefined;
}

async function caregiverReply(c: Ctx, a: Extract<Action, { type: 'caregiver-reply' }>) {
  const cg = c.caregiver(a.caregiverId);
  const sample = a.sampleId ? findSample(a.sampleId) : undefined;
  const file: SubmissionFile | undefined = a.upload ?? (sample ? { name: sample.file.split('/').pop()!, url: sample.file, mime: 'image/png' } : undefined);
  const text = a.text?.trim();
  const message: SmsMessage = { id: newId('msg'), caregiverId: cg.id, from: 'caregiver', text: text || undefined, attachment: file, time: now() };
  c.db.messages.push(message);

  if (text && isOptOut(text)) {
    if (file) message.photoCheck = uncheckedPhoto('This attachment was not analyzed because the message opted out of SMS. Contact agency staff.');
    cg.optedOut = true;
    c.log({ caregiverId: cg.id, actor: 'caregiver', who: cg.name, action: 'opted out of SMS', detail: `Replied "${text}".` });
    for (const s of c.db.requirements.filter((x) => x.caregiverId === cg.id && OPEN.includes(x.status))) {
      s.status = 'escalated';
      s.explanation = `${cg.firstName} opted out of texts. Staff need to collect this directly.`;
      if (s.openSubmissionId) Object.assign(c.sub(s.openSubmissionId), { state: 'escalated', escalation: s.explanation });
    }
    c.db.messages.push({ id: newId('msg'), caregiverId: cg.id, from: 'agent', text: (await draftSms('opted-out', { caregiver: cg, requirement: c.req('tb_test') })), time: now() });
    return;
  }

  if (file && (!cg.smsConsent || cg.optedOut)) {
    message.photoCheck = uncheckedPhoto('SMS document collection is not enabled for this caregiver. Contact agency staff.');
    c.log({ caregiverId: cg.id, actor: 'agent', action: 'left an attachment for staff', detail: message.photoCheck.summary });
    return;
  }

  // a reply through an upload link names its request; an SMS only matches when exactly one request is open
  const state = openStateFor(c, cg.id, a.requirementId);
  const action = a.via === 'link' ? (file ? 'uploaded a document through the secure link' : 'answered through the secure link') : file ? 'replied with a photo' : 'replied by text';
  c.log({ caregiverId: cg.id, requirementId: state?.requirementId, actor: 'caregiver', who: cg.name, action, detail: file ? file.name : `"${text}"` });
  if (!state) {
    const reason = a.requirementId
      ? 'The selected document request is no longer open. Ask staff to open a request before sending another photo.'
      : 'Choose one open document request before sending a photo. This attachment was left for staff and was not analyzed.';
    if (file) message.photoCheck = uncheckedPhoto(reason);
    c.log({ caregiverId: cg.id, actor: 'agent', action: 'left an unmatched message for staff', detail: reason });
    c.db.messages.push({ id: newId('msg'), caregiverId: cg.id, from: 'agent', text: cg.language === 'es' ? 'Selecciona una solicitud de documento abierta o contacta a la oficina.' : 'Please select an open document request or contact the office.', time: now() });
    return;
  }
  const req = c.req(state.requirementId);
  const sub = c.sub(state.openSubmissionId!);

  if (file) {
    if (!req.smsCollectible) {
      message.photoCheck = uncheckedPhoto('This document must be collected directly by agency staff.', req.name);
      return;
    }
    sub.files.push(file);
    const ex = await extractDocument(req, file.url, a.sampleId);
    message.photoCheck = inspectPhoto({ caregiver: cg, requirement: req, extraction: ex, minConfidence: c.db.rules.minConfidence, existingFields: sub.fields });
    c.log({ caregiverId: cg.id, requirementId: req.id, actor: 'agent', action: 'checked an uploaded photo', detail: `${message.photoCheck.status} (${message.photoCheck.source}): ${message.photoCheck.summary}` });
    // Even a rejected/unreadable first photo leaves required blanks for staff
    // to fill; an empty field array must never make approval look available.
    if (!sub.fields.length) sub.fields = req.fields.map((f) => ({ key: f.key, label: f.label, required: f.required, value: null, source: 'ai' }));
    sub.extractedBy = ex.by === 'none' ? sub.extractedBy : ex.by;
    if (!ex.readable) {
      // keep whatever fields we have so the admin can fill them in by hand
      c.log({ caregiverId: cg.id, requirementId: req.id, actor: 'agent', action: 'could not read the document', detail: ex.note });
      return applyVerdict(c, { kind: 'escalate', reason: ex.note || 'The document could not be read.' }, sub, state, cg, req);
    }
    if (!ex.matchesRequirement) {
      c.log({ caregiverId: cg.id, requirementId: req.id, actor: 'agent', action: 'identified the wrong document', detail: `Looks like a ${ex.documentType}, not ${req.name}.` });
      sub.followUps += 1;
      if (sub.followUps > c.db.rules.maxFollowUps) {
        return applyVerdict(c, { kind: 'escalate', reason: `${cg.firstName} sent the wrong document ${sub.followUps} times.` }, sub, state, cg, req);
      }
      state.status = 'following-up';
      state.explanation = `${cg.firstName} sent a ${ex.documentType}. Agent asked for the right document.`;
      await c.sms('wrong-doc', cg, req, { documentType: ex.documentType });
      return;
    }
    // Check this attachment before merging, so an earlier value cannot hide a
    // conflicting name, low-confidence reading, or invalid training hours.
    if (message.photoCheck.status === 'needs-review') {
      const reason = message.photoCheck.checks.filter((item) => item.status === 'attention').map((item) => item.detail).join(' ');
      return applyVerdict(c, { kind: 'escalate', reason: reason || message.photoCheck.summary }, sub, state, cg, req);
    }
    // merge: new values fill fields that are still empty, so a second document can complete the first
    const prev = new Map(sub.fields.map((f) => [f.key, f]));
    sub.fields = req.fields.map((spec) => {
      const old = prev.get(spec.key);
      const got = ex.fields[spec.key];
      if (old?.value?.trim()) return old;
      const value = got?.value?.trim() || null;
      return { key: spec.key, label: spec.label, required: spec.required, value, source: 'ai', confidence: value ? got.confidence : undefined, sourceRef: value ? `${file.name} · ${got.sourceRef ?? 'p.1'}` : undefined };
    });
    const filled = sub.fields.filter((f) => f.value).length;
    c.log({ caregiverId: cg.id, requirementId: req.id, actor: 'agent', action: `extracted ${filled} of ${sub.fields.length} fields`, detail: [ex.by === 'claude' ? 'Read by Claude.' : 'Demo extraction.', ex.note].filter(Boolean).join(' ') });
    return applyVerdict(c, await evaluateFresh(c, sub, cg, req), sub, state, cg, req, ex.documentType);
  }

  if (text) {
    const missing = sub.fields.find((f) => f.required && f.value === null);
    if (state.status === 'following-up' && missing) {
      const spec = req.fields.find((f) => f.key === missing.key)!;
      // an ID inside a sentence ("my number is 4417-2290") is read by rule; anything else goes to the usual interpreter
      const idInText = missing.key === 'registration_number' ? findPerIdInText(text) : null;
      const got = idInText ? { value: idInText, confidence: 0.85 } : await interpretReply(text, spec);
      if (got.value) {
        Object.assign(missing, { value: got.value, source: 'caregiver', confidence: got.confidence, sourceRef: `${a.via === 'link' ? 'Link answer' : 'SMS reply'}: "${text.slice(0, 60)}"` });
        c.log({ caregiverId: cg.id, requirementId: req.id, actor: 'agent', action: `read ${missing.label.toLowerCase()} from the reply`, detail: `${got.value}. Marked as caregiver-reported until verified.` });
        return applyVerdict(c, await evaluateFresh(c, sub, cg, req), sub, state, cg, req);
      }
      return applyVerdict(c, await evaluateFresh(c, sub, cg, req), sub, state, cg, req);
    }
    await c.sms('reminder', cg, req);
    c.log({ caregiverId: cg.id, requirementId: req.id, actor: 'agent', action: 'asked again for a photo', detail: 'The reply had no document attached.' });
  }
}

/* ---------------- admin actions ---------------- */

async function authorize(c: Ctx, caregiverId: string, requirementId: string, by: 'admin' | 'rule' = 'admin') {
  const cg = c.caregiver(caregiverId);
  const req = c.req(requirementId);
  const state = c.state(caregiverId, requirementId);
  if (!req.smsCollectible) throw new Error(`${req.name} is collected by staff, not over SMS.`);
  if (!cg.smsConsent || cg.optedOut) throw new Error(`${cg.name} has not agreed to receive texts.`);
  if (OPEN.includes(state.status)) return false;
  const sub: Submission = { id: newId('sub'), caregiverId, requirementId, files: [], fields: [], extractedBy: 'none', createdAt: now(), state: 'collecting', followUps: 0, supersedes: state.openSubmissionId };
  if (state.openSubmissionId) {
    const old = c.sub(state.openSubmissionId);
    if (old.state !== 'approved') old.state = 'rejected';
  }
  c.db.submissions.push(sub);
  state.openSubmissionId = sub.id;
  state.status = 'requested';
  state.explanation = `Agent asked ${cg.firstName} by SMS. Waiting for a reply.`;
  if (by === 'admin') c.log({ caregiverId, requirementId, actor: 'admin', who: c.admin, action: 'authorized outreach' });
  else c.log({ caregiverId, requirementId, actor: 'system', action: 'authorized outreach by rule', detail: 'Automatic requests are on in Rules.' });
  await c.sms('request', cg, req);
  c.log({ caregiverId, requirementId, actor: 'agent', action: cg.language === 'es' ? 'sent an SMS request in Spanish' : 'sent an SMS request', detail: cg.phone });
  return true;
}

/* ---------------- daily sweep ---------------- */

const REMINDER_ACTIONS = ['sent a reminder', 'sent an automatic reminder'];
const calendarDaysSince = (time: string) => Math.round((Date.parse(now().slice(0, 10)) - Date.parse(time.slice(0, 10))) / 86_400_000);

// What a scheduler does once a day: re-check gaps, request new ones when the rules allow it,
// remind caregivers who have not replied, and hand requests that stay silent to a person.
async function sweep(c: Ctx, trigger: 'schedule' | 'admin') {
  const { rules } = c.db;
  const changes = detectGaps(c.db);
  let requested = 0;
  let reminded = 0;
  let escalated = 0;

  if (rules.autoRequest) {
    for (const s of c.db.requirements.filter((x) => x.status === 'missing' || x.status === 'expiring')) {
      const cg = c.caregiver(s.caregiverId);
      if (!c.req(s.requirementId).smsCollectible || !cg.smsConsent || cg.optedOut) continue;
      if (await authorize(c, s.caregiverId, s.requirementId, 'rule')) requested++;
    }
  }

  for (const s of c.db.requirements.filter((x) => OPEN.includes(x.status) && x.openSubmissionId)) {
    const cg = c.caregiver(s.caregiverId);
    const req = c.req(s.requirementId);
    const sub = c.sub(s.openSubmissionId!);
    if (cg.optedOut) continue;
    // activity on this request since it was opened; a caregiver reply restarts the reminder count
    const events = c.db.audit.filter((e) => e.caregiverId === cg.id && e.requirementId === req.id && e.time >= sub.createdAt);
    if (!events.length || calendarDaysSince(events[events.length - 1].time) < rules.reminderAfterDays) continue;
    const lastReply = events.findLastIndex((e) => e.actor === 'caregiver');
    const sent = events.slice(lastReply + 1).filter((e) => REMINDER_ACTIONS.includes(e.action)).length;
    if (sent >= rules.maxReminders) {
      const reason = `No reply from ${cg.firstName} after ${sent} reminder${sent === 1 ? '' : 's'}. A person should reach out directly.`;
      sub.state = 'escalated';
      sub.escalation = reason;
      s.status = 'escalated';
      s.explanation = reason;
      c.log({ caregiverId: cg.id, requirementId: req.id, actor: 'agent', action: 'escalated to an admin', detail: reason });
      escalated++;
    } else {
      await c.sms('reminder', cg, req);
      c.log({ caregiverId: cg.id, requirementId: req.id, actor: 'agent', action: 'sent an automatic reminder', detail: `Reminder ${sent + 1} of ${rules.maxReminders}, after ${calendarDaysSince(events[events.length - 1].time)} days without a reply.` });
      reminded++;
    }
  }

  const did = [
    requested && `${requested} new request${requested === 1 ? '' : 's'}`,
    reminded && `${reminded} reminder${reminded === 1 ? '' : 's'}`,
    escalated && `${escalated} escalated`,
  ].filter(Boolean);
  c.log({
    actor: trigger === 'admin' ? 'admin' : 'system',
    who: trigger === 'admin' ? c.admin : undefined,
    action: trigger === 'admin' ? 'ran the daily sweep' : 'ran the scheduled daily sweep',
    detail: [did.length ? did.join(', ') + '.' : 'Nothing to send.', ...changes].join(' '),
  });
}

/** adds a staff-supplied document; with AI reading on, it fills fields that are still empty */
async function attachToRecord(c: Ctx, sub: Submission, req: RequirementType, file: SubmissionFile) {
  sub.files.push(file);
  c.log({ caregiverId: sub.caregiverId, requirementId: req.id, actor: 'admin', who: c.admin, action: 'attached a document', detail: file.name });
  if (!file.mime.startsWith('image/')) return;
  const ex = await extractDocument(req, file.url);
  if (ex.by !== 'claude' || !ex.readable || !ex.matchesRequirement) return;
  let filled = 0;
  for (const f of sub.fields) {
    const got = ex.fields[f.key];
    if (f.value !== null || !got?.value) continue;
    Object.assign(f, { value: got.value, source: 'ai', confidence: got.confidence, sourceRef: `${file.name} · ${got.sourceRef ?? 'p.1'}` });
    filled++;
  }
  sub.extractedBy = 'claude';
  c.log({ caregiverId: sub.caregiverId, requirementId: req.id, actor: 'agent', action: `read ${filled} field${filled === 1 ? '' : 's'} from the attached document`, detail: 'Each value still needs a person to verify it.' });
}

export async function run(action: Action, opts: { origin?: string; admin?: string; db?: Db } = {}): Promise<Db> {
  // opts.db: a regulatory workspace's store, which cannot be reset or grow caregivers from here
  if (opts.db && ['reset', 'add-caregiver'].includes(action.type)) throw new Error('Use regulatory onboarding to manage this workspace.');
  if (action.type === 'reset') return await reset();
  const db = opts.db || await load();
  const c = new Ctx(db, opts.origin, opts.admin);
  switch (action.type) {
    case 'run-gap-check': {
      const changes = detectGaps(db);
      const open = db.requirements.filter((s) => s.status !== 'approved').length;
      c.log({ actor: 'system', action: `ran gap detection: ${open} item${open === 1 ? '' : 's'} need attention`, detail: changes.length ? changes.join('; ') : 'No new changes since the last check.' });
      break;
    }
    case 'run-sweep':
      await sweep(c, action.trigger ?? 'admin');
      break;
    case 'authorize-outreach':
      await authorize(c, action.caregiverId, action.requirementId);
      break;
    case 'authorize-all': {
      let sent = 0;
      for (const s of db.requirements.filter((x) => x.status === 'missing' || x.status === 'expiring')) {
        const cg = c.caregiver(s.caregiverId);
        if (!c.req(s.requirementId).smsCollectible || !cg.smsConsent || cg.optedOut) continue;
        if (await authorize(c, s.caregiverId, s.requirementId)) sent++;
      }
      c.log({ actor: 'admin', who: c.admin, action: `delegated ${sent} gap${sent === 1 ? '' : 's'} to the agent` });
      break;
    }
    case 'send-reminder': {
      const cg = c.caregiver(action.caregiverId);
      const req = c.req(action.requirementId);
      await c.sms('reminder', cg, req);
      c.log({ caregiverId: cg.id, requirementId: req.id, actor: 'agent', action: 'sent a reminder', detail: `Requested by ${c.admin}.` });
      break;
    }
    case 'caregiver-reply':
      await caregiverReply(c, action);
      break;
    case 'verify-field':
    case 'edit-field': {
      const sub = c.sub(action.submissionId);
      const f = sub.fields.find((x) => x.key === action.key);
      if (!f) throw new Error('Unknown field');
      if (action.type === 'edit-field') {
        const before = f.value;
        f.value = action.value.trim() || null;
        f.source = 'edited';
        c.log({ caregiverId: sub.caregiverId, requirementId: sub.requirementId, actor: 'admin', who: c.admin, action: `${before === null ? 'entered' : 'corrected'} ${f.label.toLowerCase()}`, detail: before === null ? f.value ?? 'empty' : `${before} → ${f.value ?? 'empty'}` });
      } else {
        if (f.value === null) throw new Error('Nothing to verify: enter a value first.');
        f.source = 'verified';
        c.log({ caregiverId: sub.caregiverId, requirementId: sub.requirementId, actor: 'admin', who: c.admin, action: `verified ${f.label.toLowerCase()}`, detail: f.value });
      }
      f.verifiedBy = c.admin.split(' ')[0];
      // a corrected registration number is a new question for the registry
      if (action.type === 'edit-field' && f.key === 'registration_number' && needsRegistryCheck(sub.requirementId) && sub.state !== 'approved' && sub.state !== 'rejected') {
        sub.registryCheck = undefined;
        await lookUpRegistry(c, sub, c.caregiver(sub.caregiverId), c.req(sub.requirementId));
        settleRegistry(sub, c.state(sub.caregiverId, sub.requirementId));
      }
      break;
    }
    case 'check-registry': {
      const sub = c.sub(action.submissionId);
      const req = c.req(sub.requirementId);
      if (!needsRegistryCheck(req.id)) throw new Error('Only the Home Care Aide registration is checked against the registry.');
      if (sub.state === 'approved' || sub.state === 'rejected') throw new Error('This record is closed. Request a new document to check again.');
      if (!registryNumber(sub)?.value) throw new Error('There is no registration number to look up yet. Enter it first.');
      sub.registryCheck = undefined;
      await lookUpRegistry(c, sub, c.caregiver(sub.caregiverId), req);
      settleRegistry(sub, c.state(sub.caregiverId, sub.requirementId));
      break;
    }
    case 'record-registry-check': {
      const sub = c.sub(action.submissionId);
      const cg = c.caregiver(sub.caregiverId);
      const req = c.req(sub.requirementId);
      if (!needsRegistryCheck(req.id)) throw new Error('Only the Home Care Aide registration is checked against the registry.');
      if (sub.state === 'approved' || sub.state === 'rejected') throw new Error('This record is closed. Request a new document to check again.');
      const num = registryNumber(sub)?.value;
      if (!num) throw new Error('There is no registration number to record a result for yet. Enter it first.');
      sub.registryCheck = manualRegistryCheck(cg.name, num, action.result, c.admin);
      c.log({
        caregiverId: cg.id,
        requirementId: req.id,
        actor: 'admin',
        who: c.admin,
        action: 'recorded a California HCA registry lookup',
        detail: `${cg.name}, ID ${sub.registryCheck.perIdMasked}: ${action.result === 'NOT_FOUND' ? 'no match' : action.result}`,
      });
      settleRegistry(sub, c.state(sub.caregiverId, sub.requirementId));
      break;
    }
    case 'approve': {
      const sub = c.sub(action.submissionId);
      const req = c.req(sub.requirementId);
      const requiredMissing = req.fields.some((spec) => spec.required && !sub.fields.find((field) => field.key === spec.key)?.value?.trim());
      if (requiredMissing || unverifiedCount(sub) > 0) throw new Error('Every field must be verified by a person before approval.');
      if (needsRegistryCheck(req.id)) {
        const blocker = approvalBlocker(sub.registryCheck);
        if (blocker) throw new Error(blocker);
      }
      const cg = c.caregiver(sub.caregiverId);
      const state = c.state(sub.caregiverId, sub.requirementId);
      const val = (k: string) => sub.fields.find((f) => f.key === k)?.value || undefined;
      const base = val('completion_date') || val('test_date') || val('clearance_date');
      sub.state = 'approved';
      state.status = 'approved';
      state.approvedSubmissionId = sub.id;
      state.openSubmissionId = undefined;
      state.expiresOn = val('expiration_date') || (base && req.validMonths ? addMonths(base, req.validMonths) : undefined);
      state.explanation = `Approved by ${c.admin}.`;
      c.log({ caregiverId: cg.id, requirementId: req.id, actor: 'admin', who: c.admin, action: 'approved the record', detail: state.expiresOn ? `Valid until ${fmt(state.expiresOn)}.` : 'No expiry.' });
      detectGaps(db);
      await c.sms('approved', cg, req);
      break;
    }
    case 'reject': {
      const sub = c.sub(action.submissionId);
      const state = c.state(sub.caregiverId, sub.requirementId);
      sub.state = 'rejected';
      state.status = 'missing';
      state.openSubmissionId = undefined;
      state.explanation = `Submission rejected by ${c.admin}${action.reason ? `: ${action.reason}` : '.'}`;
      c.log({ caregiverId: sub.caregiverId, requirementId: sub.requirementId, actor: 'admin', who: c.admin, action: 'rejected the submission', detail: action.reason });
      break;
    }
    case 'request-another': {
      const sub = c.sub(action.submissionId);
      const cg = c.caregiver(sub.caregiverId);
      const req = c.req(sub.requirementId);
      const state = c.state(sub.caregiverId, sub.requirementId);
      // a staff-only document (background check) or a caregiver who cannot be texted is never asked over SMS
      if (!req.smsCollectible) throw new Error(`${req.name} is collected by staff, not over SMS. Use Add record instead.`);
      if (!cg.smsConsent || cg.optedOut) throw new Error(`${cg.name} cannot be texted. Enter the document yourself instead.`);
      sub.state = 'rejected';
      const next: Submission = { id: newId('sub'), caregiverId: cg.id, requirementId: req.id, files: [], fields: [], extractedBy: 'none', createdAt: now(), state: 'collecting', followUps: 0, supersedes: sub.id };
      db.submissions.push(next);
      state.openSubmissionId = next.id;
      state.status = 'requested';
      state.explanation = `${c.admin} asked for another document. Agent is waiting for ${cg.firstName}.`;
      c.log({ caregiverId: cg.id, requirementId: req.id, actor: 'admin', who: c.admin, action: 'requested another document' });
      await c.sms('request-another', cg, req);
      c.log({ caregiverId: cg.id, requirementId: req.id, actor: 'agent', action: 'sent an SMS request' });
      break;
    }
    case 'staff-record': {
      // staff enter a document themselves: a background check, a paper copy handed in, or after an opt-out (PRD: missing -> processing)
      const cg = c.caregiver(action.caregiverId);
      const req = c.req(action.requirementId);
      const state = c.state(cg.id, req.id);
      if (state.status === 'pending-review') throw new Error('There is already a record waiting for review. Review or reject it first.');
      if (state.status === 'approved') throw new Error(`${req.name} is already approved.`);
      if (state.openSubmissionId) {
        const old = c.sub(state.openSubmissionId);
        if (old.state !== 'approved') old.state = 'rejected';
      }
      const sub: Submission = {
        id: newId('sub'), caregiverId: cg.id, requirementId: req.id, files: [], extractedBy: 'none', createdAt: now(), state: 'ready', followUps: 0, supersedes: state.openSubmissionId,
        fields: req.fields.map((f) => ({ key: f.key, label: f.label, required: f.required, value: null, source: 'edited' })),
      };
      db.submissions.push(sub);
      state.openSubmissionId = sub.id;
      state.status = 'pending-review';
      state.explanation = `${c.admin} is entering this record. Fill in and verify each field, then approve.`;
      c.log({ caregiverId: cg.id, requirementId: req.id, actor: 'admin', who: c.admin, action: 'started a record by hand', detail: action.upload ? action.upload.name : 'No document attached yet.' });
      if (action.upload) await attachToRecord(c, sub, req, action.upload);
      break;
    }
    case 'attach-file': {
      const sub = c.sub(action.submissionId);
      if (sub.state === 'approved' || sub.state === 'rejected') throw new Error('This record is closed. Start a new one to add a document.');
      await attachToRecord(c, sub, c.req(sub.requirementId), action.upload);
      break;
    }
    case 'add-caregiver': {
      const name = action.name.trim();
      if (!name) throw new Error('Name is required.');
      const id = newId('cg');
      db.caregivers.push({ id, name, firstName: name.split(/\s+/)[0], phone: action.phone.trim(), language: action.language, hiredOn: now().slice(0, 10), smsConsent: true });
      for (const r of db.rules.requirements) {
        db.requirements.push({ caregiverId: id, requirementId: r.id, status: 'missing', explanation: `No ${r.name.toLowerCase()} on file. ${r.rule}` });
      }
      detectGaps(db);
      c.log({ caregiverId: id, actor: 'admin', who: c.admin, action: 'added a caregiver', detail: `${name}, ${db.rules.requirements.length} requirements flagged as missing.` });
      break;
    }
    case 'update-rules': {
      db.rules.expiringWithinDays = Math.max(1, Math.round(action.expiringWithinDays));
      db.rules.minConfidence = Math.min(0.99, Math.max(0.1, action.minConfidence));
      db.rules.maxFollowUps = Math.max(0, Math.round(action.maxFollowUps));
      db.rules.autoRequest = !!action.autoRequest;
      db.rules.reminderAfterDays = Math.max(1, Math.round(action.reminderAfterDays));
      db.rules.maxReminders = Math.max(0, Math.round(action.maxReminders));
      const changes = detectGaps(db);
      const r = db.rules;
      c.log({ actor: 'admin', who: c.admin, action: 'updated compliance rules', detail: `Expiring window ${r.expiringWithinDays} days, confidence floor ${Math.round(r.minConfidence * 100)}%, ${r.maxFollowUps} follow-ups. Daily sweep: ${r.autoRequest ? 'requests new gaps' : 'waits for an admin to request'}, reminds after ${r.reminderAfterDays} day${r.reminderAfterDays === 1 ? '' : 's'}, escalates after ${r.maxReminders} reminder${r.maxReminders === 1 ? '' : 's'}.${changes.length ? ' ' + changes.join('; ') : ''}` });
      break;
    }
  }
  if (!opts.db) await save(db);
  return db;
}
