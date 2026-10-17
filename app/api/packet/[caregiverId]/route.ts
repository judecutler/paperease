import { NextResponse } from 'next/server';
import { run } from '@/lib/agent';
import { failure, requireAdmin } from '@/lib/access';
import { buildPacket, renderPacketHtml } from '@/lib/packet';
import { loadOriginals } from '@/lib/packet-files';

export const dynamic = 'force-dynamic';

// GET /api/packet/<caregiverId>            → the printable personnel file (HTML, originals embedded)
// GET /api/packet/<caregiverId>?format=json → the same content as data, without embedded images
export async function GET(request: Request, { params }: { params: Promise<{ caregiverId: string }> }) {
  try {
    await requireAdmin(request);
    const { caregiverId } = await params;
    const json = new URL(request.url).searchParams.get('format') === 'json';
    const db = await run({ type: 'export-packet', caregiverId });
    const packet = buildPacket(db, caregiverId);
    const originals = await loadOriginals(packet, !json);
    if (json) return NextResponse.json({ packet, originals });
    const name = packet.caregiver.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'caregiver';
    return new Response(renderPacketHtml(packet, originals), {
      headers: { 'content-type': 'text/html; charset=utf-8', 'content-disposition': `inline; filename="personnel-file-${name}.html"`, 'cache-control': 'private, no-store' },
    });
  } catch (err) {
    return failure(err);
  }
}
