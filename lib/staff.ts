import type { Caregiver, Db, Hco, Staff } from './types';

export const staffFor = (db: Db, email?: string | null): Staff | undefined => (email ? db.staff.find((s) => s.email.toLowerCase() === email.toLowerCase()) : undefined);

/** the HCO a caregiver hears from: their assigned staff member's, else none */
export const hcoFor = (db: Db, cg: Caregiver): Hco | undefined => staffFor(db, cg.assignedTo)?.hco;
