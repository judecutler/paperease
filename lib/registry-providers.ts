// Server-side registry lookup. Choose the provider with REGISTRY_PROVIDER (default "demo"):
//   demo    a built-in sample registry, so the whole flow runs offline
//   manual  no automatic lookup; staff search the CDSS site and record the result in the app
//
// There is deliberately no provider that calls the CDSS website. Its search is a web form with no documented API, its
// Conditions of Use were not reviewed, and it could not be reached from where this was built. To add one, implement
// RegistryProvider, return it from registryProvider(), and get CDSS's OK first (HCSB@dss.ca.gov, 1-877-424-5778).
import { foldName, isPlausiblePerId, maskPerId, normalizePerId, REGISTRY_SEARCH_URL, REGISTRY_STATUSES, splitName } from './registry';
import type { RegistryCheck, RegistryStatus } from './types';

export interface RegistryQuery {
  firstName: string;
  lastName: string;
  /** normalized, see normalizePerId */
  perId: string;
}

export type RegistryLookup =
  | { outcome: 'found'; status: RegistryStatus }
  | { outcome: 'not-found' }
  | { outcome: 'unavailable'; reason: string };

export interface RegistryProvider {
  id: RegistryCheck['by'];
  label: string;
  lookup(q: RegistryQuery): Promise<RegistryLookup>;
}

/* ---------------- demo registry ---------------- */

interface DemoRecord {
  /** null: any name matches, used by the DEMO… status IDs so staff can try every outcome */
  first: string | null;
  last: string | null;
  status: RegistryStatus;
}

const rec = (first: string, last: string, status: RegistryStatus): DemoRecord => ({ first, last, status });
const any = (status: RegistryStatus): DemoRecord => ({ first: null, last: null, status });

// Fictional data. The first entry matches the sample HCA card photo ("Luis, clear photo").
// To try the other outcomes, correct the registration number on a record to one of the DEMO… IDs.
const DEMO_DIRECTORY = new Map<string, DemoRecord>([
  ['44172290', rec('Luis', 'Hernandez', 'REGISTERED')],
  ['DEMO1001', rec('Maria', 'Lopez', 'REGISTERED')],
  ['DEMO1002', rec('James', 'Chen', 'REGISTERED')],
  ['DEMO1003', rec('Ana', 'Reyes', 'REGISTERED')],
  ['DEMO1004', rec('David', 'Kim', 'REGISTERED')],
  ['DEMO1005', rec('Grace', 'Okafor', 'REGISTERED')],
  ['DEMOEXEMPT', any('REGISTERED*')],
  ['DEMOREVIEW', any('REGISTERED-PENDING REVIEW')],
  ['DEMOPENDING', any('PENDING')],
  ['DEMOCLOSED', any('CLOSED')],
  ['DEMODENIED', any('DENIED')],
  ['DEMOFORFEITED', any('FORFEITED')],
  ['DEMOREVOKED', any('REVOKED')],
]);

/** Test and demo hook: change what the demo registry says about an ID. Pass null to remove it. */
export function setDemoRegistryStatus(perId: string, status: RegistryStatus | null) {
  const key = normalizePerId(perId);
  if (status === null) DEMO_DIRECTORY.delete(key);
  else DEMO_DIRECTORY.set(key, { ...(DEMO_DIRECTORY.get(key) ?? any(status)), status });
}

const demo: RegistryProvider = {
  id: 'demo',
  label: 'Demo registry (sample data)',
  async lookup(q) {
    const r = DEMO_DIRECTORY.get(q.perId);
    // the real search needs the name and the ID to agree, so a mismatch reads as "No Match Found"
    if (!r) return { outcome: 'not-found' };
    if (r.first !== null && (foldName(r.first) !== foldName(q.firstName) || foldName(r.last ?? '') !== foldName(q.lastName))) return { outcome: 'not-found' };
    return { outcome: 'found', status: r.status };
  },
};

/* ---------------- manual lookup ---------------- */

const manual: RegistryProvider = {
  id: 'manual',
  label: 'Manual lookup on the CDSS site',
  async lookup() {
    return { outcome: 'unavailable', reason: 'Automatic lookup is off. Search the aide on the California registry and record what it shows.' };
  },
};

/* ---------------- selection and use ---------------- */

export function registryProvider(): RegistryProvider {
  const id = (process.env.REGISTRY_PROVIDER || 'demo').trim().toLowerCase();
  if (id === 'demo') return demo;
  if (id === 'manual') return manual;
  throw new Error(`Unknown REGISTRY_PROVIDER "${id}". Use "demo" or "manual".`);
}

export function registryInfo() {
  let provider: RegistryProvider | null = null;
  try {
    provider = registryProvider();
  } catch {
    // a misspelt setting should not take the whole app down; the error shows when a check runs
  }
  return {
    provider: provider?.id ?? 'manual',
    label: provider?.label ?? 'Registry provider is misconfigured',
    automatic: provider?.id === 'demo',
    searchUrl: REGISTRY_SEARCH_URL,
    statuses: REGISTRY_STATUSES,
  };
}

/** Looks one aide up. `fullName` is the caregiver on file; `rawId` is whatever the document or reply said. */
export async function checkRegistry(fullName: string, rawId: string): Promise<RegistryCheck> {
  const perId = normalizePerId(rawId);
  const checkedAt = new Date().toISOString();
  const { firstName, lastName } = splitName(fullName);
  let provider: RegistryProvider;
  try {
    provider = registryProvider();
  } catch (e) {
    // a bad setting must not break the caregiver's submission halfway; staff can still record the result by hand
    return { outcome: 'unavailable', by: 'manual', checkedAt, searchedName: fullName, perIdMasked: maskPerId(perId), note: (e as Error).message };
  }
  const base = { by: provider.id, checkedAt, searchedName: fullName, perIdMasked: maskPerId(perId) };

  if (!isPlausiblePerId(perId)) {
    return { ...base, outcome: 'not-found', note: `The registration number "${rawId.trim()}" does not look like a registry ID, so it was not searched. It may have been misread.` };
  }
  if (!firstName || !lastName) {
    return { ...base, outcome: 'unavailable', note: 'The registry needs a first and a last name, and the caregiver record has only one.' };
  }
  try {
    const r = await provider.lookup({ firstName, lastName, perId });
    if (r.outcome === 'found') return { ...base, outcome: 'found', status: r.status };
    if (r.outcome === 'not-found') return { ...base, outcome: 'not-found' };
    return { ...base, outcome: 'unavailable', note: r.reason };
  } catch (e) {
    return { ...base, outcome: 'unavailable', note: `The registry lookup failed: ${(e as Error).message}` };
  }
}

/** A result a person read off the registry and typed in. 'NOT_FOUND' is the registry's "No Match Found". */
export function manualRegistryCheck(fullName: string, rawId: string, result: RegistryStatus | 'NOT_FOUND', who: string): RegistryCheck {
  const base = { by: 'manual' as const, checkedAt: new Date().toISOString(), searchedName: fullName, perIdMasked: maskPerId(normalizePerId(rawId)), checkedBy: who };
  if (result === 'NOT_FOUND') return { ...base, outcome: 'not-found' };
  if (!REGISTRY_STATUSES.includes(result)) throw new Error(`"${result}" is not a registry status.`);
  return { ...base, outcome: 'found', status: result };
}
