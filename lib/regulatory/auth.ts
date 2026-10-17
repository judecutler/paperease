import { timingSafeEqual } from "node:crypto";
import { localMode, supabase } from "./store";
import type { Context } from "./types";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (origin) {
    const incoming = new URL(origin);
    const target = new URL(req.url);
    const host = req.headers.get("host") || target.host;
    if (incoming.host !== host || incoming.protocol !== target.protocol)
      throw new HttpError(403, "Cross-origin mutation rejected.");
  }
}
export async function context(req: Request, admin = false): Promise<Context> {
  if (localMode()) {
    const host = new URL(req.url).hostname;
    if (!["localhost", "127.0.0.1", "[::1]"].includes(host))
      throw new HttpError(403, "Local demo is limited to loopback.");
    return {
      agencyId: "local-demo",
      userId: "local-demo",
      role: "admin",
      local: true,
    };
  }
  const user = await identity(req);
  const rows = await supabase(
    `/rest/v1/reg_memberships?user_id=eq.${encodeURIComponent(user.id)}&select=agency_id,role&order=created_at.asc&limit=1`,
  );
  if (!rows.length)
    throw new HttpError(
      403,
      "No regulatory workspace. Create one from the sign-in screen.",
    );
  if (admin && rows[0].role !== "admin")
    throw new HttpError(403, "Administrator access required.");
  return {
    agencyId: rows[0].agency_id,
    userId: user.id,
    role: rows[0].role,
    local: false,
  };
}
export async function identity(req: Request): Promise<{ id: string }> {
  const cookie = req.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("careloop_session="))
    ?.slice(17);
  const token =
    req.headers.get("authorization")?.replace(/^Bearer /, "") || cookie;
  if (!token) throw new HttpError(401, "Sign in to your PaperEase workspace.");
  let user;
  try {
    user = await supabase("/auth/v1/user", {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch {
    throw new HttpError(401, "Session expired. Sign in again.");
  }
  return user;
}
export async function workerContext(req: Request) {
  if (localMode()) {
    const ctx = await context(req);
    return {
      agencyId: ctx.agencyId,
      userId: ctx.userId,
      workerId: new URL(req.url).searchParams.get("workerId") || "demo-maria",
      local: true,
    };
  }
  const user = await identity(req);
  const rows = await supabase(
    `/rest/v1/reg_worker_memberships?user_id=eq.${encodeURIComponent(user.id)}&select=agency_id,worker_id&limit=1`,
  );
  if (!rows.length)
    throw new HttpError(
      403,
      "Your worker account is not linked to an agency assignment.",
    );
  return {
    agencyId: rows[0].agency_id,
    userId: user.id,
    workerId: rows[0].worker_id,
    local: false,
  };
}
export function schedulerAuth(req: Request) {
  const secret = process.env.REGULATORY_CRON_SECRET;
  const got = req.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  if (
    !secret ||
    secret.length < 32 ||
    Buffer.byteLength(got) !== Buffer.byteLength(secret) ||
    !timingSafeEqual(Buffer.from(got), Buffer.from(secret))
  )
    throw new HttpError(401, "Invalid scheduler credentials.");
}
