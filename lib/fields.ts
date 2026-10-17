import type { ExtractedFieldValue } from './types';

/** A value nobody on staff has confirmed yet: read by AI, typed by the caregiver, or imported from a wallet. */
export const isUnconfirmed = (f: Pick<ExtractedFieldValue, 'source' | 'value' | 'required'>) =>
  (f.value !== null && (f.source === 'ai' || f.source === 'caregiver' || f.source === 'imported')) || (f.required && f.value === null);
