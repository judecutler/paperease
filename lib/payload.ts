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
    // demo samples named for a caregiver, e.g. "(Maria)", only appear where that caregiver is visible
    samples: sampleDocs()
      .filter((s) => { const who = s.label.match(/\(([^)]+)\)$/)?.[1]; return !who || db.caregivers.some((c) => c.firstName === who); })
      .map(({ id, label, file }) => ({ id, label, file })),
  };
}

export type Payload = ReturnType<typeof payload>;
