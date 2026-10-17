import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { approvalBlocker, assess, findPerIdInText, isPlausiblePerId, maskPerId, normalizePerId, registryEscalation, REGISTRY_REASON_PREFIX, REGISTRY_STATUSES, splitName } from '../lib/registry';
import { checkRegistry, manualRegistryCheck, registryInfo, registryProvider, setDemoRegistryStatus } from '../lib/registry-providers';
import type { RegistryCheck, RegistryStatus } from '../lib/types';

const check = (over: Partial<RegistryCheck>): RegistryCheck => ({ outcome: 'found', by: 'demo', checkedAt: new Date().toISOString(), searchedName: 'Luis Hernández', perIdMasked: '…2290', ...over });

describe('ID handling', () => {
  it('treats a label and separators as noise', () => {
    for (const raw of ['HCA 4417-2290', 'hca id: 4417 2290', 'PER ID 4417-2290', '  44172290 ', 'HCA #4417-2290']) assert.equal(normalizePerId(raw), '44172290', raw);
  });
  it('keeps letters that are part of the ID', () => {
    assert.equal(normalizePerId('HCA123456'), 'HCA123456');
    assert.equal(normalizePerId('ab-12 34'), 'AB1234');
  });
  it('accepts 5 to 20 letters and digits only', () => {
    assert.equal(isPlausiblePerId('1234'), false);
    assert.equal(isPlausiblePerId('12345'), true);
    assert.equal(isPlausiblePerId('A'.repeat(20)), true);
    assert.equal(isPlausiblePerId('A'.repeat(21)), false);
    assert.equal(isPlausiblePerId(''), false);
  });
  it('finds an ID inside a sentence', () => {
    assert.equal(findPerIdInText('my number is 4417-2290, thanks'), '4417-2290');
    assert.equal(findPerIdInText('HCA 4417 2290'), '4417 2290');
    assert.equal(findPerIdInText('44172290'), '44172290');
    assert.equal(findPerIdInText('It is DEMO1001 please check'), 'DEMO1001');
    assert.equal(findPerIdInText('I registered in 2024'), null); // too short to be an ID
    assert.equal(findPerIdInText('I do not have it with me'), null);
    assert.equal(findPerIdInText(''), null);
  });
  it('masks all but the last four characters', () => {
    assert.equal(maskPerId('44172290'), '…2290');
    assert.equal(maskPerId('12'), '…12');
  });
  it('splits a name for the registry search', () => {
    assert.deepEqual(splitName('Luis Hernández'), { firstName: 'Luis', lastName: 'Hernández' });
    assert.deepEqual(splitName('Ana María Reyes García'), { firstName: 'Ana', lastName: 'María Reyes García' });
    assert.deepEqual(splitName('Cher'), { firstName: 'Cher', lastName: '' });
  });
});

describe('what each registry status means', () => {
  const expected: Record<RegistryStatus, string> = {
    REGISTERED: 'pass',
    'REGISTERED*': 'pass',
    'REGISTERED-PENDING REVIEW': 'blocked',
    PENDING: 'blocked',
    CLOSED: 'blocked',
    DENIED: 'blocked',
    FORFEITED: 'blocked',
    REVOKED: 'blocked',
  };
  it('covers every status the registry can show', () => {
    assert.deepEqual(Object.keys(expected).sort(), [...REGISTRY_STATUSES].sort());
  });
  for (const status of REGISTRY_STATUSES) {
    it(`${status} is ${expected[status]}`, () => {
      const c = check({ status });
      assert.equal(assess(c).kind, expected[status]);
      assert.equal(approvalBlocker(c) === null, expected[status] === 'pass');
      assert.equal(registryEscalation(c) === null, expected[status] === 'pass');
    });
  }
  it('a missing match, or no lookup at all, never counts as a pass', () => {
    assert.equal(assess(check({ outcome: 'not-found' })).kind, 'not-found');
    assert.equal(assess(check({ outcome: 'unavailable', note: 'off' })).kind, 'unchecked');
    assert.match(approvalBlocker(check({ outcome: 'not-found' }))!, /No match/);
    assert.match(approvalBlocker(check({ outcome: 'unavailable' }))!, /record the result/);
    assert.match(approvalBlocker(undefined)!, /Check the aide/);
    assert.equal(registryEscalation(check({ outcome: 'unavailable' })), null);
  });
  it('a found record without a status is treated as no match, not a pass', () => {
    assert.equal(assess(check({ outcome: 'found', status: undefined })).kind, 'not-found');
  });
  it('escalation text carries the prefix the app uses to recognise it', () => {
    assert.ok(registryEscalation(check({ status: 'REVOKED' }))!.startsWith(REGISTRY_REASON_PREFIX));
  });
});

describe('demo registry', () => {
  afterEach(() => {
    delete process.env.REGISTRY_PROVIDER;
  });
  it('finds the sample card ID for the right name, ignoring accents and case', async () => {
    for (const name of ['Luis Hernández', 'luis hernandez', 'LUIS HERNÁNDEZ']) {
      const r = await checkRegistry(name, 'HCA 4417-2290');
      assert.equal(r.outcome, 'found', name);
      assert.equal(r.status, 'REGISTERED');
      assert.equal(r.by, 'demo');
      assert.equal(r.perIdMasked, '…2290');
    }
  });
  it('needs the name and the ID to agree, like the real search', async () => {
    assert.equal((await checkRegistry('Luis Smith', '4417-2290')).outcome, 'not-found');
    assert.equal((await checkRegistry('Luis Hernández', 'DEMO1001')).outcome, 'not-found'); // Maria's ID
  });
  it('returns every status through the DEMO IDs, for any name', async () => {
    const ids: Record<string, RegistryStatus> = { DEMOEXEMPT: 'REGISTERED*', DEMOREVIEW: 'REGISTERED-PENDING REVIEW', DEMOPENDING: 'PENDING', DEMOCLOSED: 'CLOSED', DEMODENIED: 'DENIED', DEMOFORFEITED: 'FORFEITED', 'DEMO-REVOKED': 'REVOKED' };
    for (const [id, status] of Object.entries(ids)) assert.equal((await checkRegistry('Pat Example', id)).status, status, id);
  });
  it('does not search a malformed number', async () => {
    const r = await checkRegistry('Luis Hernández', '12');
    assert.equal(r.outcome, 'not-found');
    assert.match(r.note!, /does not look like a registry ID/);
  });
  it('cannot search with a one-word name', async () => {
    const r = await checkRegistry('Cher', '44172290');
    assert.equal(r.outcome, 'unavailable');
    assert.match(r.note!, /first and a last name/);
  });
  it('can be told a record changed', async () => {
    setDemoRegistryStatus('DEMO1005', 'REVOKED');
    assert.equal((await checkRegistry('Grace Okafor', 'DEMO1005')).status, 'REVOKED');
    setDemoRegistryStatus('DEMO1005', 'REGISTERED');
    assert.equal((await checkRegistry('Grace Okafor', 'DEMO1005')).status, 'REGISTERED');
  });
});

describe('providers', () => {
  afterEach(() => {
    delete process.env.REGISTRY_PROVIDER;
  });
  it('defaults to demo and reads the setting each time', () => {
    assert.equal(registryProvider().id, 'demo');
    process.env.REGISTRY_PROVIDER = 'manual';
    assert.equal(registryProvider().id, 'manual');
    assert.equal(registryInfo().automatic, false);
  });
  it('manual mode never looks anything up', async () => {
    process.env.REGISTRY_PROVIDER = 'manual';
    const r = await checkRegistry('Luis Hernández', '44172290');
    assert.equal(r.outcome, 'unavailable');
    assert.equal(r.by, 'manual');
  });
  it('a misspelt provider degrades to "not checked" instead of throwing', async () => {
    process.env.REGISTRY_PROVIDER = 'cdss';
    const r = await checkRegistry('Luis Hernández', '44172290');
    assert.equal(r.outcome, 'unavailable');
    assert.match(r.note!, /Unknown REGISTRY_PROVIDER "cdss"/);
    assert.equal(registryInfo().provider, 'manual');
  });
  it('records what a person read off the registry', () => {
    const found = manualRegistryCheck('Luis Hernández', 'HCA 4417-2290', 'REVOKED', 'Dana (Admin)');
    assert.deepEqual([found.outcome, found.status, found.by, found.checkedBy, found.perIdMasked], ['found', 'REVOKED', 'manual', 'Dana (Admin)', '…2290']);
    assert.equal(manualRegistryCheck('Luis Hernández', '44172290', 'NOT_FOUND', 'Dana').outcome, 'not-found');
    assert.throws(() => manualRegistryCheck('Luis Hernández', '44172290', 'FINE' as RegistryStatus, 'Dana'), /not a registry status/);
  });
});
