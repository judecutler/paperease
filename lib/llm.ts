import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { AiStatus, Caregiver, RequirementType } from './types';
import { findSample } from './samples';
import { readUpload } from './db';
import { extraStop, languageLabel, packFor } from './languages';

// Every AI call sits behind an env key and falls back to deterministic behavior,
// so the demo runs end to end with no keys at all.

const MODEL = process.env.CARELOOP_MODEL || 'claude-opus-5-5';

let client: Anthropic | null = null;
function claude() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  client ??= new Anthropic();
  return client;
}

export function aiStatus(): AiStatus {
  const runAnywhere = !!(process.env.RUNANYWHERE_BASE_URL && process.env.RUNANYWHERE_API_KEY);
  return {
    extraction: process.env.ANTHROPIC_API_KEY ? 'claude' : 'mock',
    messaging: process.env.ANTHROPIC_API_KEY ? 'claude' : 'template',
    followUps: runAnywhere ? 'runanywhere' : process.env.ANTHROPIC_API_KEY ? 'claude' : 'template',
  };
}

/* ---------------- SMS copy ---------------- */

export type SmsKind = 'request' | 'follow-up' | 'thanks' | 'escalated' | 'wrong-doc' | 'reminder' | 'request-another' | 'opted-out' | 'approved' | 'passed-on';

export interface SmsContext {
  caregiver: Caregiver;
  requirement: RequirementType;
  missingField?: { key: string; label: string };
  documentType?: string;
}

export function templateSms(kind: SmsKind, c: SmsContext): string {
  const first = c.caregiver.firstName;
  const pack = packFor(c.caregiver.language);
  const doc = (c.documentType || 'document').toLowerCase();
  if (pack) {
    const ask = pack.ask[c.requirement.id] || c.requirement.ask;
    const field = c.missingField ? pack.field[c.missingField.key] || c.missingField.label.toLowerCase() : '';
    return pack.sms[kind]({ first, ask, field, doc });
  }
  const ask = c.requirement.ask;
  const field = c.missingField ? c.missingField.label.toLowerCase() : '';
  switch (kind) {
    case 'request': return `Hi ${first}! Your agency needs ${ask}. Could you reply with a photo?`;
    case 'follow-up': return `Thanks, ${first}! I couldn't find the ${field} on this ${doc}. Do you have another document showing them? You can also just reply with it.`;
    case 'thanks': return `Got it, thank you ${first}! Our office will review it.`;
    case 'escalated': return `Thanks, ${first}! Someone from the office will take a look and get back to you.`;
    case 'wrong-doc': return `Thanks, ${first}! This looks like a ${doc}. We need ${ask}. Could you send that one?`;
    case 'reminder': return `Hi ${first}, just a reminder: your agency still needs ${ask}. Reply with a photo whenever you can.`;
    case 'request-another': return `Hi ${first}, the office couldn't use the last one. Could you send ${ask} again as a clear photo?`;
    case 'opted-out': return "You're unsubscribed from CareLoop texts. Your agency will contact you directly.";
    case 'approved': return `Thanks, ${first}! Your document is approved. Nothing else needed.`;
    case 'passed-on': return `Thanks, ${first}! I'll pass this to the office.`;
  }
}

const SMS_SYSTEM = `You write one SMS from a home care agency's documentation assistant to a caregiver.
Rules: under 280 characters, warm and plain, one clear ask. Write in the caregiver's language.
Never ask for Social Security numbers, birth dates, ID numbers or other sensitive identifiers.
Only use facts given to you. Return the SMS text only, no quotes.`;

export async function draftSms(kind: SmsKind, c: SmsContext): Promise<string> {
  const fallback = templateSms(kind, c);
  if (kind === 'opted-out' || kind === 'passed-on') return fallback;
  const prompt = `Caregiver first name: ${c.caregiver.firstName}
Language: ${languageLabel(c.caregiver.language)}
Message purpose: ${kind}
Document needed: ${c.requirement.name} (${c.requirement.ask})
${c.missingField ? `Field we could not find: ${c.missingField.label}\n` : ''}${c.documentType ? `Document they sent looked like: ${c.documentType}\n` : ''}Reference message to adapt: ${fallback}`;
  try {
    // RunAnywhere (sponsor, small credit) only writes follow-up questions; everything else uses Claude.
    const text = (kind === 'follow-up' ? await runAnywhereText(SMS_SYSTEM, prompt).catch(() => null) : null) ?? (await claudeText(SMS_SYSTEM, prompt));
    const clean = text?.trim().replace(/^"|"$/g, '');
    return clean && clean.length <= 320 ? clean : fallback;
  } catch (err) {
    console.warn('[careloop] SMS drafting fell back to template:', (err as Error).message);
    return fallback;
  }
}

async function claudeText(system: string, prompt: string): Promise<string | null> {
  const api = claude();
  if (!api) return null;
  const res = await api.messages.create({
    model: MODEL,
    max_tokens: 2000,
    output_config: { effort: 'low' },
    system,
    messages: [{ role: 'user', content: prompt }],
  });
  if (res.stop_reason === 'refusal') return null;
  const block = res.content.find((b) => b.type === 'text');
  return block && block.type === 'text' ? block.text : null;
}

// RunAnywhere exposes an OpenAI-compatible chat endpoint; used for SMS copy only when configured.
async function runAnywhereText(system: string, prompt: string): Promise<string | null> {
  const base = process.env.RUNANYWHERE_BASE_URL;
  const key = process.env.RUNANYWHERE_API_KEY;
  if (!base || !key) return null;
  const res = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.RUNANYWHERE_MODEL || 'default',
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      max_tokens: 200,
    }),
  });
  if (!res.ok) throw new Error(`RunAnywhere ${res.status}`);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content ?? null;
}

/* ---------------- Document extraction ---------------- */

export interface Extraction {
  readable: boolean;
  documentType: string;
  matchesRequirement: boolean;
  fields: Record<string, { value: string | null; confidence: number; sourceRef?: string }>;
  note?: string;
  by: 'claude' | 'sample' | 'none';
}

const ExtractionSchema = z.object({
  readable: z.boolean().describe('false if the image is too blurry, cropped or dark to read reliably'),
  document_type: z.string().describe('what the document is, e.g. "Training certificate"'),
  matches_requirement: z.boolean().describe('true if this document can satisfy the requested requirement'),
  fields: z.array(
    z.object({
      key: z.string(),
      value: z.string().nullable().describe('null when the value is not visible on the document. Dates as YYYY-MM-DD. Hours as a plain number.'),
      confidence: z.number().describe('0 to 1'),
      location: z.string().nullable().describe('where on the document, e.g. "p.1 · L4"'),
    }),
  ),
  note: z.string().nullable().describe('one short sentence about anything unclear or conflicting'),
});

async function readImage(url: string): Promise<{ data: string; mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' } | null> {
  const ext = path.extname(url).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : null;
  if (!mime) return null;
  let bytes: Buffer | null = null;
  if (url.startsWith('/samples/')) {
    const file = path.join(process.cwd(), 'public', url);
    bytes = fs.existsSync(file) ? fs.readFileSync(file) : null;
  } else if (url.startsWith('/api/files/')) {
    bytes = await readUpload(path.basename(url));
  }
  return bytes ? { data: bytes.toString('base64'), mime } : null;
}

export async function extractDocument(req: RequirementType, fileUrl: string, sampleId?: string): Promise<Extraction> {
  const api = claude();
  const image = api ? await readImage(fileUrl) : null;
  if (api && image) {
    try {
      const res = await api.messages.parse({
        model: MODEL,
        max_tokens: 4000,
        output_config: { effort: 'medium', format: zodOutputFormat(ExtractionSchema) },
        system:
          'You read caregiver compliance documents for a California home care agency. Extract only what is visibly printed or written. Never guess a value; use null and low confidence instead.',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: image.mime, data: image.data } },
              {
                type: 'text',
                text: `Requested requirement: ${req.name}. ${req.rule}\nExtract these fields (use exactly these keys):\n${req.fields
                  .map((f) => `- ${f.key}: ${f.label} (${f.kind})`)
                  .join('\n')}`,
              },
            ],
          },
        ],
      });
      const out = res.parsed_output;
      if (res.stop_reason !== 'refusal' && out) {
        return {
          readable: out.readable,
          documentType: out.document_type,
          matchesRequirement: out.matches_requirement,
          fields: Object.fromEntries(out.fields.map((f) => [f.key, { value: f.value, confidence: f.confidence, sourceRef: f.location ?? undefined }])),
          note: out.note ?? undefined,
          by: 'claude',
        };
      }
    } catch (err) {
      console.warn('[careloop] Claude extraction failed, using fallback:', (err as Error).message);
    }
  }
  const sample = sampleId ? findSample(sampleId) : undefined;
  if (sample) {
    const { fits, ...rest } = sample.extraction;
    return { ...rest, matchesRequirement: fits.includes(req.id), by: 'sample' };
  }
  return {
    readable: false,
    documentType: 'Unreviewed upload',
    matchesRequirement: true,
    fields: {},
    note: 'AI extraction is off (no ANTHROPIC_API_KEY), so a person needs to read this document.',
    by: 'none',
  };
}

/* ---------------- Reply interpretation ---------------- */

const STOP_WORDS = ['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', ...extraStop()];
export function isOptOut(text: string) {
  return STOP_WORDS.includes(text.trim().replace(/[.!\s]+$/g, '').toLowerCase());
}

const ReplySchema = z.object({
  value: z.string().nullable().describe('the field value stated in the reply, normalized (dates YYYY-MM-DD, hours as a number), or null if the reply does not state it'),
  confidence: z.number(),
});

export async function interpretReply(text: string, field: { key: string; label: string; kind: string }): Promise<{ value: string | null; confidence: number }> {
  const api = claude();
  if (api) {
    try {
      const res = await api.messages.parse({
        model: MODEL,
        max_tokens: 1000,
        output_config: { effort: 'low', format: zodOutputFormat(ReplySchema) },
        messages: [{ role: 'user', content: `A caregiver was asked for "${field.label}" (${field.kind}). Their SMS reply: "${text}". What value did they give?` }],
      });
      if (res.parsed_output) return res.parsed_output;
    } catch (err) {
      console.warn('[careloop] reply interpretation fell back to rules:', (err as Error).message);
    }
  }
  if (field.kind === 'number') {
    const m = text.match(/(\d+(?:\.\d+)?)/);
    return m ? { value: m[1], confidence: 0.85 } : { value: null, confidence: 0 };
  }
  if (field.kind === 'date') {
    const d = new Date(text.replace(/^[^\d\w]*/, ''));
    return isNaN(d.getTime()) ? { value: null, confidence: 0 } : { value: d.toISOString().slice(0, 10), confidence: 0.75 };
  }
  return text.trim().length > 1 ? { value: text.trim(), confidence: 0.7 } : { value: null, confidence: 0 };
}
