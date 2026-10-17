import { NextResponse } from 'next/server';
import { run } from '@/lib/agent';
import { linkView } from '@/lib/caregiverLink';
import { load } from '@/lib/db';
import { readLinkToken } from '@/lib/links';
import { saveUpload, UploadError } from '@/lib/uploads';

export const dynamic = 'force-dynamic';

const EXPIRED = { error: 'This link has expired or is not valid.' };

// strips the internal ids before the view goes to the caregiver's phone
const publicView = (v: NonNullable<ReturnType<typeof linkView>>) => {
  const { caregiverId: _c, requirementId: _r, ...rest } = v;
  return rest;
};

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const subId = readLinkToken((await params).token);
  const view = subId && linkView(await load(), subId);
  return view ? NextResponse.json(publicView(view)) : NextResponse.json(EXPIRED, { status: 404 });
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const subId = readLinkToken((await params).token);
  const view = subId && linkView(await load(), subId);
  if (!subId || !view) return NextResponse.json(EXPIRED, { status: 404 });
  if (view.state !== 'open' && view.state !== 'question') return NextResponse.json(publicView(view));

  const form = await request.formData() as unknown as FormData;
  const file = form.get('file');
  const text = String(form.get('text') ?? '').trim().slice(0, 500);
  const sampleId = view.samples?.some((s) => s.id === form.get('sampleId')) ? String(form.get('sampleId')) : undefined;
  if (!(file instanceof File) && !text && !sampleId) return NextResponse.json({ error: 'Add a photo or an answer.' }, { status: 400 });
  try {
    const upload = file instanceof File ? await saveUpload(file) : undefined;
    const db = await run(
      { type: 'caregiver-reply', caregiverId: view.caregiverId, requirementId: view.requirementId, text: text || undefined, upload, sampleId, via: 'link' },
      { origin: new URL(request.url).origin },
    );
    return NextResponse.json(publicView(linkView(db, subId)!));
  } catch (err) {
    return NextResponse.json({ error: err instanceof UploadError ? err.message : 'Something went wrong. Please try again.' }, { status: err instanceof UploadError ? 400 : 500 });
  }
}
