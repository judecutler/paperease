import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LANG_CODES, PACKS, isLangCode, packFor } from '../lib/languages';
import { isOptOut, templateSms, type SmsKind } from '../lib/llm';
import { REQUIREMENTS, seedDb } from '../lib/seed';
import { isNo, isYes, walletSms } from '../lib/wallet';

const KINDS: SmsKind[] = ['request', 'follow-up', 'thanks', 'escalated', 'wrong-doc', 'reminder', 'request-another', 'opted-out', 'approved', 'passed-on'];
const caregiver = (language: any) => ({ ...seedDb().caregivers[0], firstName: 'Rosa', language });

describe('language packs', () => {
  it('every language covers every message kind, requirement and field with no leftover placeholders', () => {
    const fieldKeys = [...new Set(REQUIREMENTS.flatMap((r) => r.fields.map((f) => f.key)))];
    for (const lang of LANG_CODES) {
      for (const req of REQUIREMENTS) {
        for (const kind of KINDS) {
          const text = templateSms(kind, { caregiver: caregiver(lang), requirement: req, missingField: { key: 'hours', label: 'Training hours' }, documentType: 'Receipt' });
          assert.ok(text.length > 10 && text.length <= 320, `${lang}/${kind}/${req.id}: ${text.length} chars`);
          assert.ok(!/undefined|\$\{|\[object/.test(text), `${lang}/${kind}: ${text}`);
          assert.ok(text.includes('Rosa') || kind === 'opted-out', `${lang}/${kind} should greet by name`);
        }
      }
      const pack = packFor(lang);
      if (!pack) continue;
      for (const req of REQUIREMENTS) assert.ok(pack.ask[req.id], `${lang} missing ask for ${req.id}`);
      for (const key of fieldKeys.filter((k) => !['issuer', 'provider', 'clearance_date'].includes(k))) assert.ok(pack.field[key], `${lang} missing field ${key}`);
    }
  });
  it('wallet copy exists in every language and names the agency', () => {
    for (const lang of LANG_CODES) for (const k of ['share-ask', 'import-ask', 'share-ok', 'import-ok', 'declined'] as const) {
      const t = walletSms(k, { firstName: 'Rosa', language: lang }, 'Sunrise');
      assert.ok(t.includes('Rosa'));
      if (k !== 'declined') assert.ok(t.includes('Sunrise'), `${lang}/${k}`);
      assert.ok(t.length <= 320, `${lang}/${k} ${t.length}`);
    }
  });
  it('new languages are flagged unreviewed; Spanish text is unchanged', () => {
    assert.deepEqual(Object.entries(PACKS).filter(([, p]) => !p!.reviewed).map(([k]) => k).sort(), ['tl', 'vi', 'zh']);
    const es = templateSms('request', { caregiver: { ...caregiver('es'), firstName: 'Luis' }, requirement: REQUIREMENTS[0] });
    assert.equal(es, '¡Hola Luis! Tu agencia necesita una foto de tu registro de Home Care Aide. ¿Puedes responder con una foto?');
  });
  it('stop, yes and no work in each language', () => {
    for (const w of ['STOP', 'stop.', 'Unsubscribe', 'alto', 'parar', 'tigil', 'dừng', '停止', '退订']) assert.ok(isOptOut(w), w);
    for (const w of ['please stop texting me', 'stopping by', '']) assert.ok(!isOptOut(w), w);
    for (const w of ['YES', 'sí', 'oo', 'có', '是', '好']) assert.ok(isYes(w), w);
    for (const w of ['no', 'hindi', 'không', '否', '不']) assert.ok(isNo(w), w);
    assert.ok(!isYes('no') && !isNo('yes'));
  });
  it('rejects unknown language codes', () => {
    assert.ok(isLangCode('tl') && !isLangCode('fr') && !isLangCode(undefined));
  });
});
