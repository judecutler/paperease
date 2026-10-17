import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { saveUpload, UploadError } from '@/lib/uploads';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const me = await requireAdmin();
  if (me instanceof NextResponse) return me;
  const form = await request.formData() as unknown as FormData;
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file' }, { status: 400 });
  try {
    return NextResponse.json(await saveUpload(file));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: err instanceof UploadError ? 400 : 500 });
  }
}
