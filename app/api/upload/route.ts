import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { UPLOAD_DIR, newId } from '@/lib/db';

export const dynamic = 'force-dynamic';

const ALLOWED: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'application/pdf': '.pdf' };
const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file' }, { status: 400 });
  const ext = ALLOWED[file.type];
  if (!ext) return NextResponse.json({ error: 'Send a photo (PNG, JPG, WebP, GIF) or a PDF.' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'File is over 5 MB.' }, { status: 400 });
  const stored = `${newId('up')}${ext}`;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, stored), Buffer.from(await file.arrayBuffer()));
  return NextResponse.json({ name: file.name, url: `/api/files/${stored}`, mime: file.type });
}
