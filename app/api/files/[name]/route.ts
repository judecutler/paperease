import fs from 'node:fs';
import path from 'node:path';
import { UPLOAD_DIR } from '@/lib/db';

export const dynamic = 'force-dynamic';

const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf' };

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const file = path.join(UPLOAD_DIR, path.basename(name));
  if (!fs.existsSync(file)) return new Response('Not found', { status: 404 });
  return new Response(fs.readFileSync(file), {
    headers: { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'private, max-age=3600' },
  });
}
