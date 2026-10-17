import { run } from '@/lib/agent';
import { load } from '@/lib/db';
import { WebhookError, caregiverByPhone, firstTimeSeen, storeMedia, verifiedParams } from '@/lib/sms-inbound';

export const dynamic = 'force-dynamic';

const EMPTY = () => new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', { headers: { 'content-type': 'text/xml' } });

// Twilio → "A message comes in" webhook (HTTP POST). Replies go out through the REST API, so the TwiML answer is empty.
export async function POST(req: Request) {
  try {
    const params = await verifiedParams(req);
    if (!(await firstTimeSeen(params.MessageSid))) return EMPTY();
    const db = await load();
    const cg = caregiverByPhone(db, params.From ?? '');
    if (!cg) {
      console.warn('[paperease] text from a number that is not a caregiver; ignored');
      return EMPTY();
    }
    const upload = await storeMedia(params);
    const text = (params.Body ?? '').trim();
    if (!text && !upload) return EMPTY();
    await run({ type: 'caregiver-reply', caregiverId: cg.id, text: text || undefined, ...(upload ? { upload } : {}) });
    return EMPTY();
  } catch (err) {
    if (err instanceof WebhookError) return new Response(err.message, { status: err.status });
    console.error('[paperease] inbound text failed:', (err as Error).message);
    return new Response('Error', { status: 500 });
  }
}
