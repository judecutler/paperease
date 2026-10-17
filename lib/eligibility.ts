import { isUnconfirmed } from './fields';
import { assess, needsRegistryCheck } from './registry';
import type { Db } from './types';

// "Is this caregiver allowed to work this shift?" Pure function over the store; the API routes only
// authenticate, validate and call it. It answers from what a person has approved, and it fails closed:
// anything it cannot confirm is a reason to say no.

export type ReasonCode = 'missing' | 'not-approved' | 'expired-before-shift' | 'expires-during-shift' | 'registry-not-active' | 'registry-unchecked' | 'unverified-record';
export interface Reason { requirementId: string; requirement: string; code: ReasonCode; text: string; validThrough?: string }

export interface Decision {
  decision: 'eligible' | 'ineligible' | 'unknown';
  eligible: boolean;
  caregiverId: string;
  shiftDate: string;
  /** earliest expiry among the requirements, so a scheduler can plan renewals */
  validThrough?: string;
  reasons: Reason[];
  /** 'verified-record': a person confirmed a stored record. 'status-only': approved in the system without a stored record */
  evidence: Record<string, 'verified-record' | 'status-only'>;
  checkedAt: string;
}

const dateOf = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : new Date(iso).toISOString().slice(0, 10));

export interface EligibilityInput { caregiverId: string; shiftStart: string; shiftEnd?: string }

export function checkEligibility(db: Db, input: EligibilityInput, opts: { strict?: boolean; now?: Date } = {}): Decision {
  const now = opts.now ?? new Date();
  const start = dateOf(input.shiftStart);
  const end = input.shiftEnd ? dateOf(input.shiftEnd) : start;
  if (end < start) throw new Error('shiftEnd is before shiftStart.');
  const base = { caregiverId: input.caregiverId, shiftDate: start, checkedAt: now.toISOString() };
  const cg = db.caregivers.find((c) => c.id === input.caregiverId);
  if (!cg) return { ...base, decision: 'unknown', eligible: false, reasons: [], evidence: {} };

  const reasons: Reason[] = [];
  const evidence: Decision['evidence'] = {};
  let validThrough: string | undefined;
  for (const req of db.rules.requirements) {
    const st = db.requirements.find((s) => s.caregiverId === cg.id && s.requirementId === req.id);
    const r = (code: ReasonCode, text: string, extra: Partial<Reason> = {}) => reasons.push({ requirementId: req.id, requirement: req.name, code, text, ...extra });
    if (!st) { r('missing', 'No record on file.'); continue; }
    if (st.status !== 'approved' && st.status !== 'expiring') {
      r(st.status === 'missing' ? 'missing' : 'not-approved', st.status === 'missing' ? 'No current approved record.' : 'Submitted but not approved by a person yet.');
      continue;
    }
    if (st.expiresOn) {
      if (st.expiresOn < start) { r('expired-before-shift', `Expired ${st.expiresOn}.`, { validThrough: st.expiresOn }); continue; }
      if (st.expiresOn < end) { r('expires-during-shift', `Expires ${st.expiresOn}, before the shift ends.`, { validThrough: st.expiresOn }); continue; }
      if (!validThrough || st.expiresOn < validThrough) validThrough = st.expiresOn;
    }
    const sub = st.approvedSubmissionId ? db.submissions.find((s) => s.id === st.approvedSubmissionId) : undefined;
    evidence[req.id] = sub ? 'verified-record' : 'status-only';
    if (sub) {
      const open = sub.fields.some(isUnconfirmed);
      if (open) { r('unverified-record', 'The stored record has fields no person confirmed.'); continue; }
      if (needsRegistryCheck(req.id)) {
        if (!sub.registryCheck) { r('registry-unchecked', 'No California registry lookup recorded.'); continue; }
        if (assess(sub.registryCheck).kind !== 'pass') { r('registry-not-active', 'The California registry does not show an active registration.'); continue; }
      }
    } else if (opts.strict) {
      r('unverified-record', 'Approved in the system but no stored, confirmed record backs it.');
    }
  }
  const eligible = reasons.length === 0;
  return { ...base, decision: eligible ? 'eligible' : 'ineligible', eligible, reasons, evidence, ...(eligible && validThrough ? { validThrough } : {}) };
}
