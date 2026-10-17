import { newId, writeUpload } from './db';
import type { SubmissionFile } from './types';

const ALLOWED: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'application/pdf': '.pdf' };
const MAX_BYTES = 5 * 1024 * 1024;

export class UploadError extends Error {}

/** validates a photo or PDF and stores it; the returned file is what a submission attaches */
export async function saveUpload(file: File): Promise<SubmissionFile> {
  const ext = ALLOWED[file.type];
  if (!ext) throw new UploadError('Send a photo (PNG, JPG, WebP, GIF) or a PDF.');
  if (file.size > MAX_BYTES) throw new UploadError('File is over 5 MB.');
  const stored = `${newId('up')}${ext}`;
  await writeUpload(stored, Buffer.from(await file.arrayBuffer()), file.type);
  return { name: file.name, url: `/api/files/${stored}`, mime: file.type };
}
