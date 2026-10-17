import { HttpError, context, sameOrigin } from '@/lib/regulatory/auth';

// Who may use the core app (caregiver records, uploads, actions).
//
//   CARELOOP_AUTH unset / "open"  → the hackathon demo: no sign-in, exactly as before.
//   CARELOOP_AUTH=required        → every request needs a signed-in agency admin, using the same
//                                   Supabase session and reg_memberships table as Regulatory watch.
//
export const authRequired = () => process.env.CARELOOP_AUTH === 'required';

// The default stays open so the hosted demo (sample data only) keeps working. Any deployment that holds
// real caregiver IDs or test photos must set CARELOOP_AUTH=required; securityPosture() reports which mode runs.

export function securityPosture(): { auth: 'required' | 'open'; warning?: string } {
  if (authRequired()) return { auth: 'required' };
  return process.env.NODE_ENV === 'production'
    ? { auth: 'open', warning: 'Sign-in is off. Use sample data only, or set CARELOOP_AUTH=required.' }
    : { auth: 'open' };
}

export interface Actor { userId: string; agencyId: string; open: boolean }

/** Gate for a core-app route. `write` adds the cross-origin check browsers need for cookie sessions. */
export async function requireAdmin(req: Request, write = false): Promise<Actor> {
  if (!authRequired()) return { userId: 'demo', agencyId: 'demo', open: true };
  if (write) sameOrigin(req);
  const ctx = await context(req, true);
  return { userId: ctx.userId, agencyId: ctx.agencyId, open: false };
}

export function failure(err: unknown) {
  const status = err instanceof HttpError ? err.status : 400;
  return Response.json({ error: (err as Error).message }, { status });
}
