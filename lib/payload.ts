import { aiStatus } from './llm';
import { registryInfo } from './registry-providers';
import { sampleDocs } from './samples';
import type { Db } from './types';

export function payload(db: Db) {
  return {
    db,
    ai: aiStatus(),
    registry: registryInfo(),
    samples: sampleDocs().map(({ id, label, file }) => ({ id, label, file })),
  };
}

export type Payload = ReturnType<typeof payload>;
