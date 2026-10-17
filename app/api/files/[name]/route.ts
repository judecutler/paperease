import path from 'node:path';
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { readUpload } from '@/lib/db';
import { isStoredName } from '@/lib/files';

export const dynamic = 'force-dynamic';

const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf' };

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const me = await requireAdmin();
  if (me instanceof NextResponse) return me;
  const { name } = await params;
  const file = path.basename(name);
  // only names this app generated; anything else is not a stored upload
  if (!isStoredName(file)) return new Response('Not found', { status: 404 });
  const bytes = await readUpload(file);
  if (!bytes) return new Response('Not found', { status: 404 });
  // IDs and test results: never cached by a browser or proxy, never content-sniffed into something executable
  return new Response(new Uint8Array(bytes), {
    headers: { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' },
  });
}
