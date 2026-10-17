import { run } from '@/lib/agent';
import { load } from '@/lib/db';
import { WebhookError, caregiverByPhone, verifiedParams } from '@/lib/sms-inbound';

export const dynamic = 'force-dynamic';

// Twilio → status callback. Only failures matter: they go to the audit trail (and a carrier-level STOP marks an opt-out).
export async function POST(req: Request) {
  try {
    const params = await verifiedParams(req);
    if (params.MessageStatus !== 'failed' && params.MessageStatus !== 'undelivered') return new Response(null, { status: 204 });
    const cg = caregiverByPhone(await load(), params.To ?? '');
    if (cg) await run({ type: 'sms-delivery-failed', caregiverId: cg.id, code: params.ErrorCode ? Number(params.ErrorCode) : undefined });
    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof WebhookError) return new Response(err.message, { status: err.status });
    return new Response('Error', { status: 500 });
  }
}
