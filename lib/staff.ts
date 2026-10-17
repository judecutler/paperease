import type { Caregiver, Db, Hco, Staff } from './types';

export const staffFor = (db: Db, email?: string | null): Staff | undefined => (email ? db.staff.find((s) => s.email.toLowerCase() === email.toLowerCase()) : undefined);

export const hcoById = (db: Db, id?: string | null): Hco | undefined => (id ? db.hcos.find((h) => h.id === id) : undefined);

/** the HCO a caregiver hears from */
export const hcoFor = (db: Db, cg: Caregiver): Hco | undefined => hcoById(db, cg.hcoId);
