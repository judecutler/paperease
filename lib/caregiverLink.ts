import { aiStatus, askFor, fieldName } from './llm';
import { sampleDocs } from './samples';
import type { Db, FieldSpec } from './types';

// What a caregiver sees on their upload link. Only their first name, the agency and the document
// requested; no other personnel record details (PRD: wrong recipients must not learn anything).

export type LinkState =
  | 'open' // waiting for the document
  | 'question' // the agent needs one missing value
  | 'received' // ready for the office to review
  | 'office' // a person at the agency will follow up
  | 'approved'
  | 'closed'; // replaced by a newer request, rejected or opted out

export interface LinkView {
  state: LinkState;
  agency: string;
  firstName: string;
  language: 'en' | 'es';
  /** e.g. "a photo of your Home Care Aide registration" */
  ask: string;
  question?: { name: string; kind: FieldSpec['kind'] };
  /** demo mode only (no AI key): sample documents to send, since uploads cannot be read */
  samples?: { id: string; label: string }[];
}

export function linkView(db: Db, submissionId: string): (LinkView & { caregiverId: string; requirementId: string }) | null {
  const sub = db.submissions.find((s) => s.id === submissionId);
  if (!sub) return null;
  const cg = db.caregivers.find((c) => c.id === sub.caregiverId);
  const req = db.rules.requirements.find((r) => r.id === sub.requirementId);
  const st = db.requirements.find((s) => s.caregiverId === sub.caregiverId && s.requirementId === sub.requirementId);
  if (!cg || !req || !st) return null;

  const current = st.openSubmissionId === sub.id;
  let state: LinkState = 'closed';
  let question: LinkView['question'];
  if (cg.optedOut) state = 'closed';
  else if (current && (st.status === 'requested' || st.status === 'following-up')) {
    const missing = st.status === 'following-up' ? sub.fields.find((f) => f.required && f.value === null) : undefined;
    const spec = missing && req.fields.find((f) => f.key === missing.key);
    if (missing && spec) question = { name: fieldName(missing, cg.language), kind: spec.kind };
    state = question ? 'question' : 'open';
  } else if (sub.state === 'approved' || st.approvedSubmissionId === sub.id) state = 'approved';
  else if (current && st.status === 'pending-review') state = 'received';
  else if (current && st.status === 'escalated') state = 'office';

  const samples = aiStatus().extraction === 'mock' && (state === 'open' || state === 'question') ? sampleDocs().map(({ id, label }) => ({ id, label })) : undefined;
  return { state, agency: db.agency.name, firstName: cg.firstName, language: cg.language, ask: askFor(req, cg.language), question, samples, caregiverId: cg.id, requirementId: req.id };
}
