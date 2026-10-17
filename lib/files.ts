// Content checks for uploaded files. A browser-reported MIME type is only a claim, so the first
// bytes must agree with it before anything is stored or shown back.

const SIGNATURES: Record<string, (b: Uint8Array) => boolean> = {
  'image/png': (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/gif': (b) => b.length > 6 && String.fromCharCode(...b.slice(0, 4)) === 'GIF8',
  'image/webp': (b) => b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP',
  'application/pdf': (b) => b.length > 5 && String.fromCharCode(...b.slice(0, 5)) === '%PDF-',
};

export const sniffMatches = (mime: string, bytes: Uint8Array) => !!SIGNATURES[mime]?.(bytes);

export function mimeFromBytes(bytes: Uint8Array): string | null {
  return Object.keys(SIGNATURES).find((m) => SIGNATURES[m](bytes)) ?? null;
}

/** Only names this app generated may be requested back: up_<id>.<ext> */
export const isStoredName = (name: string) => /^up_[a-z0-9]+\.(png|jpg|webp|gif|pdf)$/.test(name);
