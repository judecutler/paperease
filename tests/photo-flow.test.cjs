const { test, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

// These integration tests exercise the actual persisted agent workflow without AI
// credentials, a web server, or any possibility of contacting a live AI service.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'careloop-photo-flow-'));
process.env.CARELOOP_DATA_DIR = dataDir;
process.env.ANTHROPIC_API_KEY = '';
process.env.RUNANYWHERE_BASE_URL = '';
process.env.RUNANYWHERE_API_KEY = '';
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SECRET_KEY = '';
let networkCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  networkCalls += 1;
  throw new Error('Live network requests are disabled in photo-flow tests.');
};

const originalTsLoader = require.extensions['.ts'];
require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  });
  module._compile(outputText, filename);
};
const { run, unverifiedCount } = require('../lib/agent.ts');
const store = require('../lib/db.ts');

beforeEach(async () => {
  networkCalls = 0;
  // seedDb uses shared caregiver fixtures; never mutate their original objects.
  await store.save(structuredClone(await store.reset()));
});
afterEach(() => assert.equal(networkCalls, 0, 'The offline workflow must not call an AI service.'));
after(() => {
  globalThis.fetch = originalFetch;
  if (originalTsLoader) require.extensions['.ts'] = originalTsLoader;
  else delete require.extensions['.ts'];
  const absolute = path.resolve(dataDir);
  const temporaryRoot = path.resolve(os.tmpdir());
  assert.equal(path.dirname(absolute), temporaryRoot);
  assert.ok(path.basename(absolute).startsWith('careloop-photo-flow-'));
  fs.rmSync(absolute, { recursive: true, force: true });
});

const state = (db, requirementId = 'initial_training', caregiverId = 'maria') =>
  db.requirements.find((item) => item.caregiverId === caregiverId && item.requirementId === requirementId);
const submission = (db, requirementId = 'initial_training', caregiverId = 'maria') =>
  db.submissions.find((item) => item.id === state(db, requirementId, caregiverId).openSubmissionId);
const lastPhoto = (db, caregiverId = 'maria') =>
  db.messages.filter((item) => item.caregiverId === caregiverId && item.from === 'caregiver' && item.attachment).at(-1);
const recordSnapshot = (db) => structuredClone({ requirements: db.requirements, submissions: db.submissions });
const open = (requirementId = 'initial_training', caregiverId = 'maria') =>
  run({ type: 'authorize-outreach', caregiverId, requirementId });
const photo = (sampleId, requirementId = 'initial_training', caregiverId = 'maria') =>
  run({ type: 'caregiver-reply', caregiverId, requirementId, sampleId });

test('an empty submission cannot be approved immediately after requesting a document', async () => {
  const db = await open();
  const original = recordSnapshot(db);
  assert.deepEqual(submission(db).fields, []);
  await assert.rejects(run({ type: 'approve', submissionId: submission(db).id }), /verified by a person/i);
  assert.deepEqual(recordSnapshot(await store.load()), original);
  assert.equal(state(await store.load()).status, 'requested');
});

test('complete sample prepares a record, shows demo checks, and cannot approve automatically', async () => {
  await open();
  const db = await photo('training-hours-letter');
  assert.equal(state(db).status, 'pending-review');
  assert.equal(submission(db).state, 'ready');
  assert.equal(lastPhoto(db).photoCheck.status, 'ready');
  assert.equal(lastPhoto(db).photoCheck.source, 'sample');
  assert.match(lastPhoto(db).photoCheck.summary, /demo/i);
  assert.ok(unverifiedCount(submission(db)) > 0);
  await assert.rejects(run({ type: 'approve', submissionId: submission(db).id }), /verified by a person/i);
  assert.equal(state(await store.load()).status, 'pending-review');
});

test('missing-hours photo keeps its original result after a text reply completes the record', async () => {
  await open();
  let db = await photo('training-no-hours');
  assert.equal(state(db).status, 'following-up');
  assert.equal(submission(db).fields.find((field) => field.key === 'hours').value, null);
  const messageId = lastPhoto(db).id;
  const checkSnapshot = structuredClone(lastPhoto(db).photoCheck);
  assert.equal(checkSnapshot.status, 'needs-info');
  db = await run({ type: 'caregiver-reply', caregiverId: 'maria', requirementId: 'initial_training', text: 'It was 5 hours' });
  assert.equal(state(db).status, 'pending-review');
  const hours = submission(db).fields.find((field) => field.key === 'hours');
  assert.equal(hours.value, '5');
  assert.equal(hours.source, 'caregiver');
  assert.deepEqual(db.messages.find((message) => message.id === messageId).photoCheck, checkSnapshot);
  assert.ok(unverifiedCount(submission(db)) > 0);
});

test('whitespace-only extracted hours remain missing in both the photo result and stored record', async () => {
  await open();
  const llm = require('../lib/llm.ts');
  const originalExtraction = llm.extractDocument;
  llm.extractDocument = async () => ({
    by: 'claude', readable: true, matchesRequirement: true, documentType: 'Training certificate',
    fields: {
      name: { value: 'Maria Lopez', confidence: 0.95 },
      course: { value: 'Care basics', confidence: 0.95 },
      completion_date: { value: '2026-10-01', confidence: 0.95 },
      hours: { value: '  \t  ', confidence: 0.95 },
      issuer: { value: 'Fictional training academy', confidence: 0.95 },
    },
  });
  try {
    const db = await photo('training-hours-letter');
    assert.equal(lastPhoto(db).photoCheck.status, 'needs-info');
    assert.equal(lastPhoto(db).photoCheck.checks.find((item) => item.id === 'required-fields').status, 'attention');
    assert.equal(state(db).status, 'following-up');
    assert.equal(submission(db).fields.find((field) => field.key === 'hours').value, null);
    assert.ok(unverifiedCount(submission(db)) > 0);
    await assert.rejects(run({ type: 'approve', submissionId: submission(db).id }), /verified by a person/i);
    assert.equal(state(await store.load()).status, 'following-up');
  } finally {
    llm.extractDocument = originalExtraction;
  }
});

test('wrong document asks for another document without merging any of its fields', async () => {
  await open();
  const db = await photo('tb-james');
  assert.equal(state(db).status, 'following-up');
  assert.equal(lastPhoto(db).photoCheck.status, 'needs-info');
  assert.equal(lastPhoto(db).photoCheck.checks.find((item) => item.id === 'document-type').status, 'attention');
  assert.ok(submission(db).fields.length > 0);
  assert.ok(submission(db).fields.every((field) => field.value === null));
  assert.equal(submission(db).followUps, 1);
  assert.ok(unverifiedCount(submission(db)) > 0);
  await assert.rejects(run({ type: 'approve', submissionId: submission(db).id }), /verified by a person/i);
  assert.equal(state(await store.load()).status, 'following-up');
});

test('wrong name on the first photo leaves required blanks and cannot be approved', async () => {
  await open();
  const db = await photo('annual-training-ana');
  assert.equal(state(db).status, 'escalated');
  assert.equal(lastPhoto(db).photoCheck.status, 'needs-review');
  assert.equal(lastPhoto(db).photoCheck.checks.find((item) => item.id === 'name').status, 'attention');
  assert.ok(submission(db).fields.length > 0);
  assert.ok(submission(db).fields.every((field) => field.value === null));
  assert.ok(unverifiedCount(submission(db)) > 0);
  await assert.rejects(run({ type: 'approve', submissionId: submission(db).id }), /verified by a person/i);
  assert.equal(state(await store.load()).status, 'escalated');
});

test('a conflicting name in a second photo escalates before its fields can fill the first document', async () => {
  await open();
  let db = await photo('training-no-hours');
  const originalFields = structuredClone(submission(db).fields);
  db = await photo('annual-training-ana');
  assert.equal(state(db).status, 'escalated');
  assert.equal(lastPhoto(db).photoCheck.status, 'needs-review');
  assert.equal(lastPhoto(db).photoCheck.checks.find((item) => item.id === 'name').status, 'attention');
  assert.deepEqual(submission(db).fields, originalFields);
  assert.equal(submission(db).fields.find((field) => field.key === 'hours').value, null);
});

test('blurry photo is sent to staff with an explicit readability issue', async () => {
  await open();
  const db = await photo('blurry');
  assert.equal(state(db).status, 'escalated');
  assert.equal(lastPhoto(db).photoCheck.status, 'needs-review');
  assert.equal(lastPhoto(db).photoCheck.source, 'sample');
  assert.equal(lastPhoto(db).photoCheck.checks.find((item) => item.id === 'readability').status, 'attention');
  assert.ok(submission(db).fields.length > 0);
  assert.ok(submission(db).fields.every((field) => field.value === null));
  assert.ok(unverifiedCount(submission(db)) > 0);
  await assert.rejects(run({ type: 'approve', submissionId: submission(db).id }), /verified by a person/i);
  assert.equal(state(await store.load()).status, 'escalated');
});

test('custom upload without an AI connection stays not checked, not falsely blurry or valid', async () => {
  await open();
  const db = await run({
    type: 'caregiver-reply', caregiverId: 'maria', requirementId: 'initial_training',
    upload: { name: 'my-certificate.png', url: '/api/files/nonexistent-offline-test.png', mime: 'image/png' },
  });
  const result = lastPhoto(db).photoCheck;
  assert.equal(result.status, 'not-checked');
  assert.equal(result.source, 'none');
  assert.ok(result.checks.every((item) => item.status === 'not-checked'));
  assert.doesNotMatch(result.summary + result.nextStep, /blurry/i);
  assert.notEqual(state(db).status, 'approved');
  assert.ok(submission(db).fields.every((field) => field.value === null));
  await assert.rejects(run({ type: 'approve', submissionId: submission(db).id }), /verified by a person/i);
});

test('multiple open requests require selection and explicit selection routes to the chosen record', async () => {
  await open('initial_training');
  const before = await open('annual_training');
  const original = recordSnapshot(before);
  let db = await run({ type: 'caregiver-reply', caregiverId: 'maria', sampleId: 'training-hours-letter' });
  assert.equal(lastPhoto(db).photoCheck.status, 'not-checked');
  assert.deepEqual(recordSnapshot(db), original);

  db = await photo('training-hours-letter', 'initial_training');
  assert.equal(state(db, 'initial_training').status, 'pending-review');
  assert.equal(state(db, 'annual_training').status, 'requested');
  assert.deepEqual(submission(db, 'annual_training').fields, []);
  assert.deepEqual(submission(db, 'annual_training').files, []);
  assert.equal(lastPhoto(db).photoCheck.requirementName, db.rules.requirements.find((item) => item.id === 'initial_training').name);
});

test('invalid explicit target is not silently routed to an available open request', async () => {
  const before = await open();
  const original = recordSnapshot(before);
  const db = await photo('training-hours-letter', 'not-a-requirement');
  assert.equal(lastPhoto(db).photoCheck.status, 'not-checked');
  assert.deepEqual(recordSnapshot(db), original);
});

test('closed explicit target is not silently routed to another open request', async () => {
  await open('initial_training');
  let db = await open('annual_training');
  db = await run({ type: 'reject', submissionId: submission(db, 'initial_training').id, reason: 'Closed for this test.' });
  const original = recordSnapshot(db);
  db = await photo('training-hours-letter', 'initial_training');
  assert.equal(lastPhoto(db).photoCheck.status, 'not-checked');
  assert.deepEqual(recordSnapshot(db), original);
  assert.equal(state(db, 'annual_training').status, 'requested');
});

test('photo with no open request is recorded without claiming it was checked', async () => {
  const original = recordSnapshot(await store.load());
  const db = await photo('training-hours-letter');
  assert.equal(lastPhoto(db).photoCheck.status, 'not-checked');
  assert.deepEqual(recordSnapshot(db), original);
});

for (const consentCase of ['opted-out', 'no-consent']) {
  test(`${consentCase} photo is not analyzed and produces no outbound message`, async () => {
    let db = await open();
    const caregiver = db.caregivers.find((item) => item.id === 'maria');
    if (consentCase === 'opted-out') caregiver.optedOut = true;
    else caregiver.smsConsent = false;
    await store.save(db);
    const original = recordSnapshot(db);
    const previousReplies = db.messages.filter((item) => item.from !== 'caregiver').length;
    db = await photo('training-hours-letter');
    assert.equal(lastPhoto(db).photoCheck.status, 'not-checked');
    assert.equal(lastPhoto(db).photoCheck.source, 'none');
    assert.deepEqual(recordSnapshot(db), original);
    assert.equal(db.messages.filter((item) => item.from !== 'caregiver').length, previousReplies);
  });
}

test('Supabase mapping preserves photo-check snapshots and handles older messages without checks', async () => {
  await open();
  const db = await photo('training-hours-letter');
  const checkedMessage = structuredClone(lastPhoto(db));
  const olderMessage = db.messages.find((message) => !message.photoCheck);
  const tables = new Map();
  const fakeSupabase = {
    from(table) {
      const filters = [];
      const query = {
        select() { return query; },
        eq(key, value) { filters.push([key, value]); return query; },
        order() { return query; },
        async upsert(rows) {
          tables.set(table, structuredClone(Array.isArray(rows) ? rows : [rows]));
          return { data: null, error: null };
        },
        then(resolve, reject) {
          const rows = (tables.get(table) || []).filter((row) => filters.every(([key, value]) => row[key] === value));
          return Promise.resolve({ data: structuredClone(rows), error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };

  // Compile an isolated copy of the real store and inject a fake SDK client.
  // Its Supabase-shaped environment cannot reach a live SDK or a real database.
  const { createRequire } = require('node:module');
  const vm = require('node:vm');
  const dbFile = path.resolve(__dirname, '../lib/db.ts');
  const realRequire = createRequire(dbFile);
  const isolatedModule = { exports: {} };
  const { outputText } = ts.transpileModule(fs.readFileSync(dbFile, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: dbFile,
  });
  vm.runInNewContext(outputText, {
    module: isolatedModule,
    exports: isolatedModule.exports,
    require(id) {
      if (id === '@supabase/supabase-js') return { createClient: () => fakeSupabase };
      return realRequire(id);
    },
    process: { env: { CARELOOP_DATA_DIR: dataDir, SUPABASE_URL: 'https://offline.invalid', SUPABASE_SECRET_KEY: 'offline-test-key' } },
    Buffer,
    console,
  }, { filename: dbFile });
  const isolatedStore = isolatedModule.exports;
  assert.equal(isolatedStore.storage(), 'supabase');
  await isolatedStore.save(db);
  const storedMessages = tables.get('sms_messages');
  assert.deepEqual(storedMessages.find((message) => message.id === checkedMessage.id).photo_check, checkedMessage.photoCheck);
  assert.equal(storedMessages.find((message) => message.id === olderMessage.id).photo_check, null);

  const restored = await isolatedStore.load();
  const restoredMessage = restored.messages.find((message) => message.id === checkedMessage.id);
  assert.deepEqual(structuredClone(restoredMessage.photoCheck), checkedMessage.photoCheck);
  assert.deepEqual(structuredClone(restoredMessage.attachment), checkedMessage.attachment);
  assert.equal(restored.messages.find((message) => message.id === olderMessage.id).photoCheck, undefined);
});
