import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  context,
  HttpError,
  sameOrigin,
  schedulerAuth,
  workerContext,
} from "@/lib/regulatory/auth";
import { supabase, readDoc, localMode } from "@/lib/regulatory/store";
import {
  collectionAction,
  syncCollection,
  uploadEvidence,
} from "@/lib/regulatory/collection";
import {
  workerInbox,
  acknowledgeWorkerNotice,
} from "@/lib/regulatory/worker-inbox";
import { syncAlerts } from "@/lib/regulatory/notifications";
import { agencyKey } from "@/lib/regulatory/service";
import { emptyAgency } from "@/lib/regulatory/types";
import { resetDemo } from "@/lib/regulatory/demo";
import { payload } from "@/lib/payload";
import { state, command, tick } from "@/lib/regulatory/service";
import { type Snapshot } from "@/lib/regulatory/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const cookie = (token: string, maxAge: number) =>
  `careloop_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
async function dispatch(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const path = (await params).path.join("/");
    if (req.method === "POST") sameOrigin(req);
    if (path === "session" && req.method === "DELETE")
      return NextResponse.json(
        { ok: true },
        { headers: { "set-cookie": cookie("", 0) } },
      );
    if (path === "session" && req.method === "POST") {
      const body = z
        .object({
          email: z.string().email(),
          password: z.string().min(1),
          createWorkspace: z.boolean().default(false),
        })
        .parse(await req.json());
      let data;
      try {
        data = await supabase("/auth/v1/token?grant_type=password", {
          method: "POST",
          body: JSON.stringify({ email: body.email, password: body.password }),
        });
      } catch {
        throw new HttpError(
          401,
          "Sign-in failed. Check your Supabase Auth email and password.",
        );
      }
      if (body.createWorkspace) {
        const found = await supabase(
          `/rest/v1/reg_memberships?user_id=eq.${data.user.id}&select=agency_id&limit=1`,
        );
        if (!found.length)
          await supabase("/rest/v1/reg_memberships", {
            method: "POST",
            body: JSON.stringify({
              user_id: data.user.id,
              agency_id: randomUUID(),
              role: "admin",
            }),
          });
      }
      return NextResponse.json(
        { ok: true },
        {
          headers: {
            "set-cookie": cookie(
              data.access_token,
              Math.min(data.expires_in || 3600, 3600),
            ),
          },
        },
      );
    }
    if (path === "worker" && req.method === "POST") {
      schedulerAuth(req);
      return NextResponse.json(await tick());
    }
    if (path === "worker-inbox" && req.method === "GET")
      return NextResponse.json(await workerInbox(await workerContext(req)));
    if (path === "worker-acknowledge" && req.method === "POST") {
      const body = z.object({ id: z.string() }).parse(await req.json());
      return NextResponse.json(
        await acknowledgeWorkerNotice(await workerContext(req), body.id),
      );
    }
    const ctx = await context(req, req.method === "POST");
    if (path === "alerts" && req.method === "GET") {
      await syncAlerts(ctx.agencyId);
      const a = (await readDoc(agencyKey(ctx.agencyId), emptyAgency)).data;
      return NextResponse.json({
        unread: a.notices.filter((n) => !n.read).length,
      });
    }
    if (path === "demo" && req.method === "POST")
      return NextResponse.json(await resetDemo(ctx));
    if (path === "collection" && req.method === "GET")
      return NextResponse.json(payload(await syncCollection(ctx)));
    if (path === "collection-actions" && req.method === "POST")
      return NextResponse.json(await collectionAction(ctx, await req.json()));
    if (path === "upload" && req.method === "POST")
      return NextResponse.json(
        await uploadEvidence(
          ctx,
          (await req.formData()) as unknown as FormData,
        ),
      );
    if (path.startsWith("files/") && req.method === "GET") {
      const id = path.slice(6);
      if (!z.string().uuid().safeParse(id).success)
        throw new HttpError(400, "Invalid file.");
      const file = (
        await readDoc<{ name: string; mime: string; bytes: string } | null>(
          `file:${ctx.agencyId}:${id}`,
          () => null,
        )
      ).data;
      if (!file) throw new HttpError(404, "File not found.");
      return new Response(Buffer.from(file.bytes, "base64"), {
        headers: {
          "content-type": file.mime,
          "content-disposition": 'attachment; filename="evidence"',
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }
    if (path === "rules" && req.method === "GET") {
      const data = await state(ctx);
      const jurisdiction = new URL(req.url).searchParams.get("jurisdiction");
      if (jurisdiction && !/^[A-Z]{2}$/.test(jurisdiction))
        throw new HttpError(
          400,
          "Use a two-letter jurisdiction such as CA or US.",
        );
      return NextResponse.json({
        jurisdiction: jurisdiction || "ALL",
        verificationStatus: "unverified",
        coverage: "partial",
        rules: data.candidates
          .filter(
            (r) =>
              !r.demo &&
              (!jurisdiction ||
                r.jurisdiction === jurisdiction ||
                r.jurisdiction === "US"),
          )
          .map((r) => ({
            ...r,
            verificationStatus: "unverified",
            sourceUrl:
              data.sources.find((s) => s.id === r.sourceId)?.url || null,
          })),
      });
    }
    if (path === "state" && req.method === "GET")
      return NextResponse.json(await state(ctx));
    if (path === "actions" && req.method === "POST")
      return NextResponse.json(await command(ctx, await req.json()));
    if (path.startsWith("evidence/") && req.method === "GET") {
      const id = decodeURIComponent(path.slice(9));
      if (!id.startsWith("snapshot:"))
        throw new HttpError(400, "Invalid snapshot.");
      const doc = (await readDoc<Snapshot | null>(id, () => null)).data;
      if (!doc) throw new HttpError(404, "Snapshot not found.");
      const { rawBase64, ...safe } = doc;
      void rawBase64;
      return NextResponse.json(safe);
    }
    if (path === "process" && req.method === "POST") {
      if (
        !ctx.local &&
        !process.env.REGULATORY_CURATOR_IDS?.split(",").includes(ctx.userId)
      )
        throw new HttpError(403, "Curator access required.");
      return NextResponse.json(await tick());
    }
    throw new HttpError(404, "Endpoint not found.");
  } catch (e) {
    if (e instanceof HttpError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof z.ZodError)
      return NextResponse.json(
        {
          error: "Invalid input.",
          details: e.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        { status: 400 },
      );
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Regulatory request failed." },
      { status: 503 },
    );
  }
}
export const GET = dispatch;
export const POST = dispatch;
export const DELETE = dispatch;
