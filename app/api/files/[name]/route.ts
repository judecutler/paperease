import path from 'node:path';
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { readUpload } from '@/lib/db';

export const dynamic = 'force-dynamic';

const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf' };

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const me = await requireAdmin();
  if (me instanceof NextResponse) return me;
  const { name } = await params;
  const file = path.basename(name);
  const bytes = await readUpload(file);
  if (!bytes) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'private, max-age=3600' },
  });
}
