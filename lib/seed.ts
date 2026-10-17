import type { Caregiver, Db, RequirementState, RequirementType, Rules, Submission, SmsMessage, AuditEvent } from './types';

// California HCO-oriented checklist for the demo. Verify every rule against current
// Home Care Services Bureau guidance before relying on it.
export const REQUIREMENTS: RequirementType[] = [
  {
    id: 'hca_registration',
    name: 'Home Care Aide registration',
    rule: 'Active HCA registration with the Home Care Services Bureau, renewed every 2 years.',
    smsCollectible: true,
    validMonths: 24,
    ask: 'a photo of your Home Care Aide registration',
    fields: [
      { key: 'name', label: 'Caregiver name', required: true, kind: 'text' },
      { key: 'registration_number', label: 'HCA registration number', required: true, kind: 'text' },
      { key: 'expiration_date', label: 'Expiration date', required: true, kind: 'date' },
    ],
  },
  {
    id: 'background_check',
    name: 'Background check clearance',
    rule: 'Live Scan clearance received by the agency. Collected by staff, never over SMS.',
    smsCollectible: false,
    validMonths: null,
    ask: 'background check clearance',
    fields: [
      { key: 'name', label: 'Caregiver name', required: true, kind: 'text' },
      { key: 'clearance_date', label: 'Clearance date', required: true, kind: 'date' },
    ],
  },
  {
    id: 'tb_test',
    name: 'TB screening',
    rule: 'Negative TB test or chest X-ray on file, repeated every 2 years.',
    smsCollectible: true,
    validMonths: 24,
    ask: 'a photo of your latest TB test result',
    fields: [
      { key: 'name', label: 'Caregiver name', required: true, kind: 'text' },
      { key: 'test_date', label: 'Test date', required: true, kind: 'date' },
      { key: 'result', label: 'Result', required: true, kind: 'text' },
      { key: 'provider', label: 'Clinic or provider', required: false, kind: 'text' },
    ],
  },
  {
    id: 'initial_training',
    name: 'Entry-level training',
    rule: 'At least 5 hours of entry-level training before the first client visit.',
    smsCollectible: true,
    validMonths: null,
    minHours: 5,
    ask: 'your latest training certificate',
    fields: [
      { key: 'name', label: 'Caregiver name', required: true, kind: 'text' },
      { key: 'course', label: 'Training course', required: true, kind: 'text' },
      { key: 'completion_date', label: 'Completion date', required: true, kind: 'date' },
      { key: 'hours', label: 'Training hours', required: true, kind: 'number' },
      { key: 'issuer', label: 'Issuing organization', required: false, kind: 'text' },
    ],
  },
  {
    id: 'annual_training',
    name: 'Annual training',
    rule: 'At least 5 hours of annual training in the last 12 months.',
    smsCollectible: true,
    validMonths: 12,
    minHours: 5,
    ask: 'your annual training certificate',
    fields: [
      { key: 'name', label: 'Caregiver name', required: true, kind: 'text' },
      { key: 'course', label: 'Training course', required: true, kind: 'text' },
      { key: 'completion_date', label: 'Completion date', required: true, kind: 'date' },
      { key: 'hours', label: 'Training hours', required: true, kind: 'number' },
      { key: 'issuer', label: 'Issuing organization', required: false, kind: 'text' },
    ],
  },
];

const day = 86_400_000;
const iso = (offsetDays: number, hour = 9) => {
  const d = new Date(Date.now() + offsetDays * day);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};
const date = (offsetDays: number) => iso(offsetDays).slice(0, 10);

const CAREGIVERS: Caregiver[] = [
  { id: 'maria', name: 'Maria Lopez', firstName: 'Maria', phone: '(213) 555-0142', language: 'en', hiredOn: date(-760), smsConsent: true },
  { id: 'james', name: 'James Chen', firstName: 'James', phone: '(626) 555-0177', language: 'en', hiredOn: date(-700), smsConsent: true },
  { id: 'ana', name: 'Ana Reyes', firstName: 'Ana', phone: '(323) 555-0119', language: 'es', hiredOn: date(-420), smsConsent: true },
  { id: 'david', name: 'David Kim', firstName: 'David', phone: '(818) 555-0163', language: 'en', hiredOn: date(-500), smsConsent: true },
  { id: 'grace', name: 'Grace Okafor', firstName: 'Grace', phone: '(510) 555-0108', language: 'en', hiredOn: date(-900), smsConsent: true },
  { id: 'luis', name: 'Luis Hernández', firstName: 'Luis', phone: '(909) 555-0131', language: 'es', hiredOn: date(-30), smsConsent: true },
];

function approved(caregiverId: string, requirementId: string, expiresIn?: number): RequirementState {
  return {
    caregiverId,
    requirementId,
    status: 'approved',
    explanation: 'Approved record on file.',
    expiresOn: expiresIn === undefined ? undefined : date(expiresIn),
  };
}

export const DEFAULT_RULES: Omit<Rules, 'requirements'> = {
  expiringWithinDays: 30,
  minConfidence: 0.6,
  maxFollowUps: 2,
  autoRequest: false,
  reminderAfterDays: 1,
  maxReminders: 2,
};

export function seedDb(): Db {
  const reqs: RequirementState[] = [];
  const subs: Submission[] = [];
  const messages: SmsMessage[] = [];
  const audit: AuditEvent[] = [];
  let n = 0;
  const id = (p: string) => `${p}_seed_${++n}`;

  const set = (cg: string, overrides: Partial<Record<string, Partial<RequirementState>>>) => {
    const defaults: Record<string, number | undefined> = {
      hca_registration: 410,
      background_check: undefined,
      tb_test: 380,
      initial_training: undefined,
      annual_training: 200,
    };
    for (const r of REQUIREMENTS) {
      reqs.push({ ...approved(cg, r.id, defaults[r.id]), ...(overrides[r.id] || {}) });
    }
  };

  // Maria: the hero flow. Entry-level training certificate missing.
  set('maria', {
    initial_training: {
      status: 'missing',
      expiresOn: undefined,
      explanation: 'No entry-level training certificate on file. Required before the first client visit.',
    },
  });

  // James: TB screening runs out soon.
  set('james', { tb_test: { expiresOn: date(18) } });

  // Ana: agent already asked for annual training, in Spanish.
  const anaSub = id('sub');
  set('ana', {
    annual_training: {
      status: 'requested',
      expiresOn: undefined,
      explanation: 'Annual training certificate expired. Agent asked Ana by SMS.',
      openSubmissionId: anaSub,
    },
  });
  subs.push({ id: anaSub, caregiverId: 'ana', requirementId: 'annual_training', files: [], fields: [], extractedBy: 'none', createdAt: iso(-1, 10), state: 'collecting', followUps: 0 });
  messages.push({
    id: id('msg'),
    caregiverId: 'ana',
    from: 'agent',
    text: '¡Hola Ana! Tu agencia necesita tu certificado de capacitación anual. ¿Puedes responder con una foto?',
    time: iso(-1, 10),
  });
  audit.push(
    { id: id('ev'), caregiverId: 'ana', requirementId: 'annual_training', actor: 'system', action: 'flagged annual training as missing', detail: 'Certificate on file expired 3 days ago.', time: iso(-1, 9) },
    { id: id('ev'), caregiverId: 'ana', requirementId: 'annual_training', actor: 'admin', who: 'Dana (Admin)', action: 'authorized outreach', time: iso(-1, 10) },
    { id: id('ev'), caregiverId: 'ana', requirementId: 'annual_training', actor: 'agent', action: 'sent an SMS request in Spanish', time: iso(-1, 10) },
  );

  // David: TB result waiting for review, one low-confidence field.
  const davidSub = id('sub');
  set('david', {
    tb_test: {
      status: 'pending-review',
      expiresOn: undefined,
      explanation: 'New TB result extracted. Waiting for a person to verify.',
      openSubmissionId: davidSub,
    },
  });
  subs.push({
    id: davidSub,
    caregiverId: 'david',
    requirementId: 'tb_test',
    files: [{ name: 'tb-result-david.png', url: '/samples/tb-result-david.png', mime: 'image/png' }],
    extractedBy: 'sample',
    createdAt: iso(0, 8),
    state: 'ready',
    followUps: 0,
    fields: [
      { key: 'name', label: 'Caregiver name', value: 'David Kim', required: true, source: 'ai', confidence: 0.98, sourceRef: 'p.1 · L2' },
      { key: 'test_date', label: 'Test date', value: date(-6), required: true, source: 'ai', confidence: 0.93, sourceRef: 'p.1 · L5' },
      { key: 'result', label: 'Result', value: 'Negative', required: true, source: 'ai', confidence: 0.72, sourceRef: 'p.1 · L7 (handwritten)' },
      { key: 'provider', label: 'Clinic or provider', value: 'Valley Community Clinic', required: false, source: 'ai', confidence: 0.95, sourceRef: 'p.1 · L1' },
    ],
  });
  messages.push(
    { id: id('msg'), caregiverId: 'david', from: 'agent', text: 'Hi David! Your TB screening is due for renewal. Could you reply with a photo of your latest TB test result?', time: iso(-2, 15) },
    { id: id('msg'), caregiverId: 'david', from: 'caregiver', attachment: { name: 'tb-result-david.png', url: '/samples/tb-result-david.png', mime: 'image/png' }, time: iso(0, 8) },
    { id: id('msg'), caregiverId: 'david', from: 'agent', text: 'Got it, thank you David! Our office will review it.', time: iso(0, 8) },
  );
  audit.push(
    { id: id('ev'), caregiverId: 'david', requirementId: 'tb_test', actor: 'agent', action: 'sent an SMS request', time: iso(-2, 15) },
    { id: id('ev'), caregiverId: 'david', requirementId: 'tb_test', actor: 'caregiver', who: 'David Kim', action: 'replied with a photo', detail: 'tb-result-david.png', time: iso(0, 8) },
    { id: id('ev'), caregiverId: 'david', requirementId: 'tb_test', actor: 'agent', action: 'extracted 4 fields', detail: 'Result read at 72% confidence (handwritten). Sent to review.', time: iso(0, 8) },
  );

  // Grace: complete, with a full audit-ready file: every SMS-collected record has its original, fields a person confirmed,
  // and the registration passed the registry check. Background check is kept by staff outside CareLoop.
  set('grace', {});
  {
    const who = 'Dana';
    const doneAt = (offset: number) => iso(offset, 10);
    const rec = (reqId: string, file: string | null, offset: number, values: Record<string, string>, extra: Partial<Submission> = {}) => {
      const req = REQUIREMENTS.find((r) => r.id === reqId)!;
      const subId = id('sub');
      subs.push({
        id: subId, caregiverId: 'grace', requirementId: reqId, files: file ? [{ name: file, url: `/samples/${file}`, mime: 'image/png' }] : [], extractedBy: 'sample', createdAt: doneAt(offset), state: 'approved', followUps: 0,
        fields: req.fields.map((f) => ({ key: f.key, label: f.label, required: f.required, value: values[f.key] ?? null, source: 'verified' as const, verifiedBy: who, ...(file ? { sourceRef: `${file} · p.1` } : { sourceRef: 'Live Scan clearance letter, kept by the agency' }) })),
        ...extra,
      });
      reqs.find((x) => x.caregiverId === 'grace' && x.requirementId === reqId)!.approvedSubmissionId = subId;
      audit.push(
        ...(file ? [{ id: id('ev'), caregiverId: 'grace', requirementId: reqId, actor: 'caregiver' as const, who: 'Grace Okafor', action: 'replied with a photo', detail: file, time: doneAt(offset) }] : []),
        { id: id('ev'), caregiverId: 'grace', requirementId: reqId, actor: 'admin', who: 'Dana (Admin)', action: 'verified every field', detail: `${req.fields.length} fields`, time: doneAt(offset) },
        { id: id('ev'), caregiverId: 'grace', requirementId: reqId, actor: 'admin', who: 'Dana (Admin)', action: 'approved the record', time: doneAt(offset) },
      );
    };
    const reg = { outcome: 'found' as const, status: 'REGISTERED' as const, by: 'demo' as const, checkedAt: doneAt(-330), searchedName: 'Grace Okafor', perIdMasked: '…1005' };
    rec('hca_registration', 'hca-card-grace.png', -330, { name: 'Grace Okafor', registration_number: 'HCA DEMO1005', expiration_date: date(410) }, { registryCheck: reg });
    rec('tb_test', 'tb-result-grace.png', -350, { name: 'Grace Okafor', test_date: date(-350), result: 'Negative', provider: 'Lakeside Family Clinic' });
    rec('initial_training', 'training-cert-grace.png', -880, { name: 'Grace Okafor', course: 'Home Care Aide Entry-Level Training', completion_date: date(-880), hours: '6', issuer: 'Golden State Caregiver Academy' });
    rec('annual_training', 'annual-training-grace.png', -30, { name: 'Grace Okafor', course: 'Annual Home Care Aide Training', completion_date: date(-30), hours: '5', issuer: 'CareSkills Online' });
    rec('background_check', null, -890, { name: 'Grace Okafor', clearance_date: date(-890) });
    // approved annual training lasts 12 months from completion
    reqs.find((x) => x.caregiverId === 'grace' && x.requirementId === 'annual_training')!.expiresOn = date(335);
    reqs.find((x) => x.caregiverId === 'grace' && x.requirementId === 'tb_test')!.expiresOn = date(380);
  }

  // Luis: new hire. HCA photo unreadable (escalated), entry-level training missing.
  const luisSub = id('sub');
  set('luis', {
    hca_registration: {
      status: 'escalated',
      expiresOn: undefined,
      explanation: 'The photo Luis sent is too blurry to read. A person needs to decide the next step.',
      openSubmissionId: luisSub,
    },
    initial_training: {
      status: 'missing',
      expiresOn: undefined,
      explanation: 'No entry-level training certificate on file. Required before the first client visit.',
    },
    annual_training: { status: 'approved', expiresOn: date(335), explanation: 'Not due in the first year (counted as met).' },
  });
  subs.push({
    id: luisSub,
    caregiverId: 'luis',
    requirementId: 'hca_registration',
    files: [{ name: 'IMG_2231.png', url: '/samples/hca-blurry.png', mime: 'image/png' }],
    extractedBy: 'sample',
    createdAt: iso(-1, 17),
    state: 'escalated',
    followUps: 0,
    escalation: 'The registration photo is too blurry to read the number or expiration date (confidence 31%). The agent did not guess.',
    fields: [
      { key: 'name', label: 'Caregiver name', value: 'Luis Hern…', required: true, source: 'ai', confidence: 0.41, sourceRef: 'p.1 · L1' },
      { key: 'registration_number', label: 'HCA registration number', value: null, required: true, source: 'ai' },
      { key: 'expiration_date', label: 'Expiration date', value: null, required: true, source: 'ai' },
    ],
  });
  messages.push(
    { id: id('msg'), caregiverId: 'luis', from: 'agent', text: '¡Hola Luis! Tu agencia necesita una foto de tu registro de Home Care Aide. ¿Puedes responder con una foto?', time: iso(-1, 16) },
    { id: id('msg'), caregiverId: 'luis', from: 'caregiver', attachment: { name: 'IMG_2231.png', url: '/samples/hca-blurry.png', mime: 'image/png' }, time: iso(-1, 17) },
    { id: id('msg'), caregiverId: 'luis', from: 'agent', text: '¡Gracias, Luis! Alguien de la oficina lo revisará.', time: iso(-1, 17) },
  );
  audit.push(
    { id: id('ev'), caregiverId: 'luis', requirementId: 'hca_registration', actor: 'agent', action: 'sent an SMS request in Spanish', time: iso(-1, 16) },
    { id: id('ev'), caregiverId: 'luis', requirementId: 'hca_registration', actor: 'caregiver', who: 'Luis Hernández', action: 'replied with a photo', detail: 'IMG_2231.png', time: iso(-1, 17) },
    { id: id('ev'), caregiverId: 'luis', requirementId: 'hca_registration', actor: 'agent', action: 'escalated to an admin', detail: 'Photo too blurry to read (31% confidence).', time: iso(-1, 17) },
  );

  audit.push({ id: id('ev'), actor: 'system', action: 'loaded agency records', detail: `${CAREGIVERS.length} caregivers, ${REQUIREMENTS.length} requirements each.`, time: iso(-3, 8) });
  audit.sort((a, b) => a.time.localeCompare(b.time));

  return {
    version: 1,
    agency: { name: 'Sunrise Home Care', admin: 'Dana (Admin)' },
    rules: { ...DEFAULT_RULES, requirements: REQUIREMENTS.map((r) => ({ ...r })) },
    caregivers: CAREGIVERS.map((c) => ({ ...c })),
    requirements: reqs,
    submissions: subs,
    messages,
    audit,
  };
}
