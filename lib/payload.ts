import { aiStatus } from './llm';
import { sampleDocs } from './samples';
import type { Db } from './types';

export function payload(db: Db) {
  return {
    db,
    ai: aiStatus(),
    samples: sampleDocs().map(({ id, label, file }) => ({ id, label, file })),
  };
}

export type Payload = ReturnType<typeof payload>;
