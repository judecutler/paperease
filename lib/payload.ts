import type { Admin } from './adminRole';
import { aiStatus } from './llm';
import { registryInfo } from './registry-providers';
import { sampleDocs } from './samples';
import type { Db } from './types';

/** me is the signed-in admin, or undefined in demo mode without sign-in */
export function payload(db: Db, me?: Admin) {
  return {
    db,
    me: me ?? null,
    ai: aiStatus(),
    registry: registryInfo(),
    samples: sampleDocs().map(({ id, label, file }) => ({ id, label, file })),
  };
}

export type Payload = ReturnType<typeof payload>;
