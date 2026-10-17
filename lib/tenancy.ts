import type { Admin } from './adminRole';
import { staffFor } from './staff';
import type { Db } from './types';

// HCOs are isolated from each other. A signed-in staff member's view of the store holds only their own HCO:
// its caregivers and everything about them, its staff and its details. Rules are shared by every HCO.

/** undefined: no sign-in, nothing is scoped (local demo). null: signed in but not linked to an HCO, sees nothing. */
export function hcoScope(db: Db, me?: Admin): string | null | undefined {
  if (!me) return undefined;
  return staffFor(db, me.email)?.hcoId ?? null;
}

export function scopeDb(db: Db, hcoId: string | null | undefined): Db {
  if (hcoId === undefined) return db;
  const caregivers = db.caregivers.filter((c) => c.hcoId === hcoId);
  const ids = new Set(caregivers.map((c) => c.id));
  const staff = db.staff.filter((s) => s.hcoId === hcoId);
  const colleagues = new Set(staff.map((s) => s.name));
  const submissions = db.submissions.filter((s) => ids.has(s.caregiverId));
  const hcos = db.hcos.filter((h) => h.id === hcoId);
  return {
    ...db,
    // the deployment-wide agency name is one HCO's; staff see their own HCO's name instead
    agency: { name: hcos[0]?.name ?? '', admin: '' },
    hcos,
    staff,
    caregivers,
    requirements: db.requirements.filter((s) => ids.has(s.caregiverId)),
    submissions,
    messages: db.messages.filter((m) => ids.has(m.caregiverId)),
    // events about a caregiver follow the caregiver; events about no one are kept when a colleague did them,
    // or when the system did them, without their detail (a shared sweep's summary covers every HCO)
    audit: db.audit
      .filter((e) => (e.caregiverId ? ids.has(e.caregiverId) : e.actor === 'system' || (!!e.who && colleagues.has(e.who))))
      .map((e) => (!e.caregiverId && e.actor === 'system' ? { ...e, detail: undefined } : e)),
  };
}

/** whether an uploaded file (/api/files/<name>) belongs to this HCO's records or messages */
export function ownsFile(db: Db, hcoId: string | null | undefined, name: string) {
  const scoped = scopeDb(db, hcoId);
  const url = `/api/files/${name}`;
  return scoped.submissions.some((s) => s.files.some((f) => f.url === url)) || scoped.messages.some((m) => m.attachment?.url === url);
}
