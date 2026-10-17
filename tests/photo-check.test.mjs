import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectPhoto, uncheckedPhoto } from '../lib/photo-check.ts';

const caregiver = {
  id: 'cg-1', name: 'Maria Lopez', firstName: 'Maria', phone: '555-0100',
  language: 'en', hiredOn: '2026-01-01', smsConsent: true,
};
const requirement = {
  id: 'initial_training', name: 'Initial training', rule: 'At least five hours.',
  smsCollectible: true, validMonths: null, minHours: 5, ask: 'your training certificate',
  fields: [
    { key: 'name', label: 'Name', required: true, kind: 'text' },
    { key: 'course', label: 'Course', required: true, kind: 'text' },
    { key: 'completion_date', label: 'Completion date', required: true, kind: 'date' },
    { key: 'hours', label: 'Hours', required: true, kind: 'number' },
  ],
};
const field = (value, confidence = 0.95) => ({ value, confidence });
const complete = () => ({
  by: 'claude', readable: true, matchesRequirement: true, documentType: 'Training certificate',
  fields: { name: field('Maria Lopez'), course: field('Care basics'), completion_date: field('2026-10-01'), hours: field('5') },
});
const inspect = (extraction = complete(), options = {}) => inspectPhoto({
  caregiver, requirement, extraction, minConfidence: 0.8, checkedAt: '2026-10-17T12:00:00.000Z', ...options,
});
const check = (result, id) => result.checks.find((item) => item.id === id);
const previous = (key, value) => ({ key, value, label: key, required: true, source: 'ai', confidence: 0.95 });

test('complete photo is ready for staff review and remains explicitly unapproved', () => {
  const result = inspect();
  assert.equal(result.status, 'ready');
  assert.equal(result.summary, 'Ready for staff review.');
  assert.match(result.nextStep, /staff must verify/i);
  assert.equal(result.checkedAt, '2026-10-17T12:00:00.000Z');
  assert.ok(result.checks.every((item) => item.status === 'pass'));
});

test('missing hours asks for information rather than guessing', () => {
  const extraction = complete();
  extraction.fields.hours = field(null, 0);
  const result = inspect(extraction);
  assert.equal(result.status, 'needs-info');
  assert.equal(check(result, 'required-fields').status, 'attention');
  assert.match(result.nextStep, /Hours/);
  assert.equal(check(result, 'training-hours').status, 'attention');
});

test('wrong document leaves name and field checks unassessed', () => {
  const result = inspect({ ...complete(), matchesRequirement: false, documentType: 'Restaurant receipt' });
  assert.equal(result.status, 'needs-info');
  assert.equal(check(result, 'document-type').status, 'attention');
  assert.equal(check(result, 'name').status, 'not-checked');
  assert.equal(check(result, 'required-fields').status, 'not-checked');
});

test('unreadable photo is flagged without reporting a document or name pass', () => {
  const result = inspect({ ...complete(), readable: false, note: 'Too blurry to read.' });
  assert.equal(result.status, 'needs-review');
  assert.match(check(result, 'readability').detail, /blurry/);
  assert.ok(result.checks.slice(1).every((item) => item.status === 'not-checked'));
});

test('wrong name requires review, even if existing fields contain the right name', () => {
  const extraction = complete();
  extraction.fields.name = field('Ana Reyes');
  const result = inspect(extraction, { existingFields: [previous('name', 'Maria Lopez')] });
  assert.equal(result.status, 'needs-review');
  assert.equal(check(result, 'name').status, 'attention');
  assert.match(check(result, 'name').detail, /Ana Reyes/);
});

test('new low-confidence fields cannot be hidden by existing reliable values', () => {
  const extraction = complete();
  extraction.fields.hours = field('5', 0.4);
  const result = inspect(extraction, { existingFields: [previous('hours', '5')] });
  assert.equal(result.status, 'needs-review');
  assert.equal(check(result, 'confidence').status, 'attention');
  assert.match(check(result, 'confidence').detail, /Hours/);
});

test('non-finite and out-of-range confidence cannot pass', () => {
  for (const confidence of [NaN, Infinity, -1, 1.1]) {
    const extraction = complete();
    extraction.fields.hours = field('5', confidence);
    assert.equal(inspect(extraction).status, 'needs-review');
  }
});

test('insufficient or invalid new hours require review despite earlier sufficient hours', () => {
  for (const value of ['3', '-1', 'many', 'Infinity', '5 hours']) {
    const extraction = complete();
    extraction.fields.hours = field(value);
    const result = inspect(extraction, { existingFields: [previous('hours', '5')] });
    assert.equal(result.status, 'needs-review', value);
    assert.equal(check(result, 'training-hours').status, 'attention', value);
  }
});

test('no AI is unassessed, never a blurry photo or a passed check', () => {
  const result = inspect({ ...complete(), by: 'none', readable: false, note: 'AI analysis is unavailable.' });
  assert.equal(result.status, 'not-checked');
  assert.equal(result.source, 'none');
  assert.ok(result.checks.every((item) => item.status === 'not-checked'));
  assert.doesNotMatch(result.summary + result.nextStep, /blurry/);
  assert.equal(result.checkedAt, '2026-10-17T12:00:00.000Z');
});

test('demo extraction is explicitly marked as a demo', () => {
  const result = inspect({ ...complete(), by: 'sample' });
  assert.equal(result.status, 'ready');
  assert.equal(result.source, 'sample');
  assert.match(result.summary, /^Demo result:/);
});

test('complementary document can fill missing fields without discarding prior information', () => {
  const extraction = { ...complete(), fields: { hours: field('5') } };
  const existingFields = [previous('name', 'Maria Lopez'), previous('course', 'Care basics'), previous('completion_date', '2026-10-01'), previous('hours', null)];
  const result = inspect(extraction, { existingFields });
  assert.equal(result.status, 'ready');
  assert.equal(check(result, 'required-fields').status, 'pass');
  assert.equal(check(result, 'name').status, 'not-checked');
  assert.match(check(result, 'required-fields').detail, /across the submitted documents/);
  assert.equal(existingFields[3].value, null);
});

test('unrelated second document is not made valid by a complete earlier submission', () => {
  const existingFields = Object.entries(complete().fields).map(([key, item]) => previous(key, item.value));
  const result = inspect({ ...complete(), matchesRequirement: false }, { existingFields });
  assert.equal(result.status, 'needs-info');
  assert.equal(check(result, 'required-fields').status, 'not-checked');
});

test('name matching preserves first and last names, accents, and Unicode names', () => {
  for (const [expected, actual] of [['Luis Hernández', 'Luis Hernandez'], ['Maria Lopez', 'Maria Isabel Lopez'], ['山田 太郎', '山田 太郎']]) {
    const extraction = complete();
    extraction.fields.name = field(actual);
    assert.equal(check(inspect(extraction, { caregiver: { ...caregiver, name: expected } }), 'name').status, 'pass');
  }
  const extraction = complete();
  extraction.fields.name = field('!!!');
  assert.equal(check(inspect(extraction, { caregiver: { ...caregiver, name: '???' } }), 'name').status, 'attention');
});

test('non-training documents omit the training-hours check', () => {
  const result = inspect(complete(), { requirement: { ...requirement, minHours: undefined } });
  assert.equal(check(result, 'training-hours'), undefined);
});

test('generic unchecked result explains why and includes no passing checks', () => {
  const result = uncheckedPhoto('No open document request. Ask agency staff to select one.');
  assert.equal(result.status, 'not-checked');
  assert.match(result.nextStep, /No open document request/);
  assert.ok(result.checks.every((item) => item.status === 'not-checked'));
});
