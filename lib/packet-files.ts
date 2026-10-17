import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readUpload } from './db';
import type { Original, Packet } from './packet';

// Reads the original files named in a packet (uploads store or bundled samples) and fingerprints them.
// Isolated from lib/packet.ts so the builder stays free of disk and network access.

export async function readOriginal(url: string): Promise<Buffer | null> {
  if (url.startsWith('/samples/')) {
    const real = path.join(process.cwd(), 'public', 'samples', path.basename(url));
    return fs.existsSync(real) ? fs.readFileSync(real) : null;
  }
  if (url.startsWith('/api/files/')) return readUpload(path.basename(url));
  return null;
}

export async function loadOriginals(p: Packet, embed = true): Promise<Record<string, Original>> {
  const out: Record<string, Original> = {};
  for (const item of p.items) {
    for (const f of item.files) {
      if (out[f.url]) continue;
      const bytes = await readOriginal(f.url).catch(() => null);
      out[f.url] = bytes
        ? { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, ...(embed ? { dataUri: `data:${f.mime};base64,${bytes.toString('base64')}` } : {}) }
        : { sha256: '', bytes: 0, missing: true };
    }
  }
  return out;
}
