export type DocStatus =
  | 'missing'
  | 'requested'
  | 'following-up'
  | 'pending-review'
  | 'escalated'
  | 'expiring'
  | 'approved';

export type Actor = 'agent' | 'admin' | 'caregiver' | 'system';

export interface FieldSpec {
  key: string;
  label: string;
  required: boolean;
  kind: 'text' | 'date' | 'number';
}

export interface RequirementType {
  subject?: "agency" | "worker";
  contractConfirmed?: boolean;
  expirationField?: string;
  ruleVersionId?: string;
  id: string;
  name: string;
  /** plain-language rule shown under the requirement */
  rule: string;
  /** can the agent collect it over SMS? background checks stay with the agency */
  smsCollectible: boolean;
  /** months a document stays valid; null = no expiry */
  validMonths: number | null;
  /** minimum training hours, when the requirement is a training */
  minHours?: number;
  fields: FieldSpec[];
  /** what the agent asks for in plain words */
  ask: string;
}

export interface Rules {
  /** days before expiry that a document counts as expiring */
  expiringWithinDays: number;
  /** below this confidence the agent escalates instead of preparing a record */
  minConfidence: number;
  /** follow-ups the agent sends before escalating */
  maxFollowUps: number;
  /** daily sweep: request new gaps without waiting for an admin */
  autoRequest: boolean;
  /** daily sweep: days without a reply before the agent sends a reminder */
  reminderAfterDays: number;
  /** daily sweep: reminders sent before escalating to a person */
  maxReminders: number;
  requirements: RequirementType[];
}

export interface Caregiver {
  id: string;
  name: string;
  firstName: string;
  phone: string;
  language: 'en' | 'es';
  hiredOn: string;
  smsConsent: boolean;
  optedOut?: boolean;
  /** email of the staff member responsible for this caregiver */
  assignedTo?: string;
}

/** the home care organization a staff member works for; it is who caregivers hear from */
export interface Hco {
  name: string;
  /** California HCO license number */
  license: string;
  address: string;
  phone: string;
}

/** an admin account's profile: the caregivers assigned to them and their HCO */
export interface Staff {
  email: string;
  name: string;
  hco: Hco;
}

export interface ExtractedFieldValue {
  key: string;
  label: string;
  value: string | null;
  required: boolean;
  /** ai: extracted, not checked. caregiver: given in an SMS reply, not checked. verified/edited: a person confirmed it. */
  source: 'ai' | 'caregiver' | 'verified' | 'edited';
  confidence?: number;
  sourceRef?: string;
  verifiedBy?: string;
}

export interface SubmissionFile {
  name: string;
  url: string;
  mime: string;
}

export interface Submission {
  ruleVersionId?: string;
  analysis?: PhotoCheck;
  reviewedBy?: string;
  reviewedAt?: string;
  id: string;
  caregiverId: string;
  requirementId: string;
  files: SubmissionFile[];
  fields: ExtractedFieldValue[];
  extractedBy: 'claude' | 'sample' | 'none';
  createdAt: string;
  state: 'collecting' | 'ready' | 'escalated' | 'approved' | 'rejected';
  escalation?: string;
  followUps: number;
  /** id of the record this replaced, so versions are kept */
  supersedes?: string;
  /** result of looking the aide up on the California HCA registry (hca_registration only) */
  registryCheck?: RegistryCheck;
}

/** Status values the CDSS Home Care Aide Registry shows (see the registry's Status Definitions page). */
export type RegistryStatus =
  | 'REGISTERED'
  | 'REGISTERED*'
  | 'REGISTERED-PENDING REVIEW'
  | 'PENDING'
  | 'CLOSED'
  | 'DENIED'
  | 'FORFEITED'
  | 'REVOKED';

export interface RegistryCheck {
  /** found: the registry returned a record; not-found: no match (or the number was not searchable); unavailable: no lookup was possible */
  outcome: 'found' | 'not-found' | 'unavailable';
  status?: RegistryStatus;
  /** demo: built-in sample registry; manual: a person looked it up and recorded the result */
  by: 'demo' | 'manual';
  checkedAt: string;
  /** the name the registry was searched with (the caregiver on file, not the name on the document) */
  searchedName: string;
  /** last characters only, so the full ID is not repeated in logs */
  perIdMasked: string;
  note?: string;
  /** who recorded the result, for manual checks */
  checkedBy?: string;
}

export interface RequirementState {
  subject?: "agency" | "worker";
  inactive?: boolean;
  reevaluationRequired?: boolean;
  caregiverId: string;
  requirementId: string;
  status: DocStatus;
  /** why the status is what it is (gap detection explanation) */
  explanation: string;
  expiresOn?: string;
  approvedSubmissionId?: string;
  openSubmissionId?: string;
}

export interface SmsMessage {
  id: string;
  caregiverId: string;
  from: 'agent' | 'admin' | 'caregiver';
  text?: string;
  attachment?: SubmissionFile;
  /** Saved per-attachment snapshot, distinct from final staff approval. Older messages may have no check. */
  photoCheck?: PhotoCheck;
  time: string;
}

export interface PhotoCheckItem {
  id: 'readability' | 'document-type' | 'name' | 'confidence' | 'required-fields' | 'training-hours';
  label: string;
  status: 'pass' | 'attention' | 'not-checked';
  detail: string;
}

export interface PhotoCheck {
  status: 'ready' | 'needs-info' | 'needs-review' | 'not-checked';
  source: 'claude' | 'sample' | 'none';
  requirementName?: string;
  documentType?: string;
  summary: string;
  nextStep: string;
  checkedAt: string;
  checks: PhotoCheckItem[];
}

export interface AuditEvent {
  id: string;
  caregiverId?: string;
  requirementId?: string;
  actor: Actor;
  who?: string;
  action: string;
  detail?: string;
  time: string;
}

export interface Db {
  version: number;
  agency: { name: string; admin: string };
  rules: Rules;
  staff: Staff[];
  caregivers: Caregiver[];
  requirements: RequirementState[];
  submissions: Submission[];
  messages: SmsMessage[];
  audit: AuditEvent[];
}

export interface AiStatus {
  extraction: 'claude' | 'mock';
  messaging: 'claude' | 'template';
  /** follow-up question copy; RunAnywhere when configured */
  followUps: 'claude' | 'runanywhere' | 'template';
}
