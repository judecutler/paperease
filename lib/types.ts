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
  time: string;
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
