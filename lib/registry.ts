// California Home Care Aide (HCA) registry check: pure rules, safe to import from the browser.
// Providers (demo registry, manual lookup) live in registry-providers.ts and run on the server only.
//
// What the registry offers (CDSS Home Care Services Bureau, ccld.dss.ca.gov/hcsregistry): a public search that
// needs the aide's first name, last name and Personnel ID ("PER ID / HCA ID"), and shows one of eight statuses.
// The format of the ID is not published anywhere we could read, so validation here is deliberately loose.
import type { RegistryCheck, RegistryStatus } from './types';

export const REGISTRY_SEARCH_URL = 'https://www.ccld.dss.ca.gov/hcsregistry/registrysearch.aspx';
export const REGISTRY_STATUS_DEFINITIONS_URL = 'https://www.ccld.dss.ca.gov/hcsregistry/PDFs/StatusDefinition.pdf';

export const REGISTRY_STATUSES: readonly RegistryStatus[] = [
  'REGISTERED',
  'REGISTERED*',
  'REGISTERED-PENDING REVIEW',
  'PENDING',
  'CLOSED',
  'DENIED',
  'FORFEITED',
  'REVOKED',
];

/** Prefix on every escalation reason that comes from the registry, so the app can tell them apart. */
export const REGISTRY_REASON_PREFIX = 'California HCA registry: ';

/** Only the HCA registration is checked against the registry. */
export const needsRegistryCheck = (requirementId: string) => requirementId === 'hca_registration';

/* ---------------- input handling ---------------- */

/**
 * Reduces what is printed on a card or typed in a text to a searchable ID: upper case, a leading label such as
 * "HCA" or "PER ID" removed, and every separator dropped. "HCA 4417-2290" and "44172290" are the same ID.
 */
export function normalizePerId(raw: string): string {
  return raw
    .normalize('NFKC')
    .toUpperCase()
    .replace(/^\s*(HCA\s*ID|PER\s*ID|HCA|PER)\b[\s:#.\-]*/, '')
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Pulls an ID out of a text reply like "my number is 4417-2290, thanks". Looks for the longest run of letters and
 * digits that contains a digit (separators allowed inside it), so label words such as "HCA" are left out.
 * Returns null when the reply has nothing that could be an ID.
 */
export function findPerIdInText(text: string): string | null {
  const runs = text.match(/[A-Za-z0-9]*\d[A-Za-z0-9]*(?:[\s-]+[A-Za-z0-9]*\d[A-Za-z0-9]*)*/g) ?? [];
  const best = runs.map((r) => r.trim()).filter((r) => isPlausiblePerId(normalizePerId(r))).sort((x, y) => normalizePerId(y).length - normalizePerId(x).length)[0];
  return best ?? null;
}

/** Loose on purpose: the real ID format is not documented where we could read it. Tighten once it is known. */
export function isPlausiblePerId(normalized: string): boolean {
  return /^[A-Z0-9]{5,20}$/.test(normalized);
}

/** "…2290": enough for a person to recognise, not enough to repeat the ID in logs. */
export function maskPerId(normalized: string): string {
  return normalized.length <= 4 ? '…' + normalized : '…' + normalized.slice(-4);
}

/** The registry search wants a first and a last name. Everything after the first word counts as the last name. */
export function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') };
}

/** Accent- and case-insensitive name comparison, the way a person reads two spellings of one name. */
export function foldName(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
}

/* ---------------- what a result means ---------------- */

export type RegistryVerdict =
  | { kind: 'pass'; label: string; note?: string }
  | { kind: 'blocked'; label: string; reason: string }
  | { kind: 'not-found'; label: string; reason: string }
  | { kind: 'unchecked'; label: string; reason: string };

const BLOCKED: Record<Exclude<RegistryStatus, 'REGISTERED' | 'REGISTERED*'>, string> = {
  'REGISTERED-PENDING REVIEW': 'The registry lists this aide as registered but under review. They cannot provide home care for any organization until CDSS makes a final decision.',
  PENDING: 'The registry shows this aide as Pending: registration is not complete yet (application, fingerprints or a background review is still open).',
  CLOSED: 'The registry shows this registration as Closed. CDSS stopped processing the application.',
  DENIED: 'The registry shows this registration as Denied.',
  FORFEITED: 'The registry shows this registration as Forfeited (for example it was not renewed). The aide is no longer registered.',
  REVOKED: 'The registry shows this registration as Revoked by CDSS.',
};

export function assess(check: RegistryCheck): RegistryVerdict {
  const id = check.perIdMasked;
  if (check.outcome === 'unavailable') {
    return { kind: 'unchecked', label: 'Not checked yet', reason: check.note || 'The registry has not been checked for this record yet.' };
  }
  if (check.outcome === 'not-found' || !check.status) {
    return {
      kind: 'not-found',
      label: 'No match',
      reason: check.note || `No match on the registry for ${check.searchedName} with ID ${id}. The number may have been misread, or the name on file may differ from the registry.`,
    };
  }
  if (check.status === 'REGISTERED') return { kind: 'pass', label: 'Registered' };
  if (check.status === 'REGISTERED*') return { kind: 'pass', label: 'Registered*', note: 'Registered with a criminal record exemption on file with CDSS.' };
  return { kind: 'blocked', label: check.status[0] + check.status.slice(1).toLowerCase(), reason: BLOCKED[check.status] };
}

export const passes = (check?: RegistryCheck) => !!check && assess(check).kind === 'pass';

/** The escalation text shown to staff, or null when the check does not stop the record. */
export function registryEscalation(check: RegistryCheck): string | null {
  const v = assess(check);
  return v.kind === 'blocked' || v.kind === 'not-found' ? REGISTRY_REASON_PREFIX + v.reason : null;
}

/** Why Approve must stay disabled for an HCA record, or null when the registry check clears it. */
export function approvalBlocker(check?: RegistryCheck): string | null {
  if (!check) return 'Check the aide on the California registry before approving.';
  const v = assess(check);
  if (v.kind === 'pass') return null;
  if (v.kind === 'unchecked') return 'Look the aide up on the California registry and record the result before approving.';
  return v.reason;
}
