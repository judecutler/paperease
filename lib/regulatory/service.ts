import { randomUUID } from "node:crypto";
import { z } from "zod";
import { initialCorpus, jurisdictions, validStates } from "./jurisdictions";
import { readDoc, mutate, saveImmutable, writeDoc } from "./store";
import {
  emptyAgency,
  ProfileSchema,
  WorkerSchema,
  Topics,
  type AgencyState,
  type Corpus,
  type Context,
  type Source,
  type Snapshot,
  type Candidate,
} from "./types";
import { fetchOfficial, parseSnapshot, officialURL, hash } from "./fetch";
import { extract } from "./ai";
import { impact, coverage, impactFingerprint } from "./engine";
import { HttpError } from "./auth";
import {
  syncAlerts,
  notifyAdoptedWorkers,
  fanOutAlerts,
} from "./notifications";
export const CORPUS = "reg:corpus";
export const agencyKey = (id: string) => `reg:agency:${id}`;
const now = () => new Date().toISOString();
export async function state(ctx: Context) {
  await syncAlerts(ctx.agencyId);
  const [catalog, agency] = await Promise.all([
    readDoc(CORPUS, initialCorpus),
    readDoc(agencyKey(ctx.agencyId), emptyAgency),
  ]);
  const corpus = catalog.data;
  return {
    agency: agency.data,
    agencyRevision: agency.revision,
    role: ctx.role,
    local: ctx.local,
    coverage: [...jurisdictions, { code: "US", name: "Federal", host: "" }].map(
      (j) => ({ ...j, ...coverage(corpus.sources, j.code) }),
    ),
    sources: corpus.sources,
    candidates: corpus.candidates.map((r) => ({
      ...r,
      impact: impact(r, agency.data),
      fingerprint: hash(impactFingerprint(r, agency.data)),
    })),
    jobs: corpus.jobs.slice(-100).reverse(),
    usage: corpus.usage,
    limits: {
      calls: Number(process.env.REGULATORY_DAILY_CALL_LIMIT || 20),
      tokens: Number(process.env.REGULATORY_DAILY_TOKEN_LIMIT || 100000),
    },
    scheduler: { lastTick: corpus.lastTick || null },
  };
}
const SourceSchema = z.object({
  jurisdiction: z.string().regex(/^[A-Z]{2}$/),
  title: z.string().min(3).max(200),
  url: z.string().url(),
  authority: z.string().min(3).max(200),
  kind: z.enum(["discovery", "law", "regulation", "guidance"]),
  topic: z.enum(Topics),
  intervalHours: z.number().int().min(6).max(720),
});
function checkStates(states: string[]) {
  if (states.some((s) => !validStates.has(s)))
    throw new HttpError(400, "Unknown state code.");
}
export async function command(ctx: Context, input: unknown) {
  if (ctx.role !== "admin")
    throw new HttpError(403, "Administrator access required.");
  const body = z
    .object({ type: z.string() })
    .passthrough()
    .parse(input) as Record<string, unknown> & { type: string };
  if (body.type === "profile") {
    const profile = ProfileSchema.parse(body.profile);
    checkStates(profile.operatingStates);
    if (profile.headquarters) checkStates([profile.headquarters]);
    await mutate(agencyKey(ctx.agencyId), emptyAgency, (a) => {
      a.profile = profile;
      a.audit.push({
        at: now(),
        actor: ctx.userId,
        action: "Updated agency applicability profile.",
      });
    });
  } else if (body.type === "worker") {
    const w = WorkerSchema.parse(body.worker);
    checkStates([w.residence, w.serviceState, ...w.licenseStates]);
    await mutate(agencyKey(ctx.agencyId), emptyAgency, (a) => {
      a.workers = a.workers.filter((x) => x.id !== w.id);
      a.workers.push(w);
      a.audit.push({
        at: now(),
        actor: ctx.userId,
        action: `Updated worker assignment ${w.id}.`,
      });
    });
  } else if (body.type === "source-add") {
    const v = SourceSchema.parse(body.source);
    if (v.jurisdiction !== "US") checkStates([v.jurisdiction]);
    const url = officialURL(v.url).href;
    await mutate(CORPUS, initialCorpus, (c) => {
      if (
        c.sources.some(
          (s) => s.url === url && s.jurisdiction === v.jurisdiction,
        )
      )
        throw new HttpError(409, "Source is already registered.");
      c.sources.push({
        ...v,
        url,
        id: `source:${hash(url + v.jurisdiction)}`,
        approved: false,
      });
    });
  } else if (body.type === "source-approve") {
    const { id, approved } = z
      .object({ id: z.string(), approved: z.boolean() })
      .parse(body);
    // Shared source registry changes require a separately designated curator in hosted mode.
    if (
      !ctx.local &&
      !process.env.REGULATORY_CURATOR_IDS?.split(",")
        .map((x) => x.trim())
        .includes(ctx.userId)
    )
      throw new HttpError(
        403,
        "Source activation requires a designated regulatory curator.",
      );
    await mutate(CORPUS, initialCorpus, (c) => {
      const s = c.sources.find((s) => s.id === id);
      if (!s) throw new HttpError(404, "Source not found.");
      s.approved = approved;
      s.approvedBy = ctx.userId;
      s.approvedAt = now();
    });
  } else if (body.type === "scan") {
    const v = z.object({ sourceId: z.string().optional() }).parse(body);
    await enqueue(v.sourceId, true);
  } else if (body.type === "review") {
    const v = z
      .object({
        ruleId: z.string(),
        decision: z.enum(["approved", "rejected"]),
        note: z.string().trim().min(10).max(2000),
      })
      .parse(body);
    const c = (await readDoc(CORPUS, initialCorpus)).data;
    const r = c.candidates.find((r) => r.id === v.ruleId);
    if (!r) throw new HttpError(404, "Rule not found.");
    if (v.decision === "approved") validateReview(r, c, ctx.local);
    await mutate(agencyKey(ctx.agencyId), emptyAgency, (a) => {
      if (a.adopted.includes(r.id))
        throw new HttpError(
          409,
          "Already adopted. Preserve its decision; review a new version instead.",
        );
      a.reviews = a.reviews.filter((x) => x.ruleId !== r.id);
      a.reviews.push({ ...v, reviewer: ctx.userId, at: now() });
      a.audit.push({
        at: now(),
        actor: ctx.userId,
        action: `${v.decision} ${r.citation}: ${v.note}`,
      });
    });
  } else if (body.type === "adopt") {
    const v = z
      .object({ ruleId: z.string(), fingerprint: z.string() })
      .parse(body);
    const c = (await readDoc(CORPUS, initialCorpus)).data;
    const r = c.candidates.find((r) => r.id === v.ruleId);
    if (!r) throw new HttpError(404, "Rule not found.");
    validateReview(r, c, ctx.local);
    await mutate(agencyKey(ctx.agencyId), emptyAgency, (a) => {
      if (a.adopted.includes(r.id)) return;
      if (
        !a.reviews.some((x) => x.ruleId === r.id && x.decision === "approved")
      )
        throw new HttpError(409, "Approve this exact version first.");
      if (hash(impactFingerprint(r, a)) !== v.fingerprint)
        throw new HttpError(
          409,
          "Profile or effective date changed. Refresh the impact preview.",
        );
      const results = impact(r, a);
      if (!results.length || results.some((x) => x.result === "needs-review"))
        throw new HttpError(
          409,
          "Complete applicability review before adoption.",
        );
      const targets = results.filter((x) => x.result === "applicable");
      if (!targets.length)
        throw new HttpError(
          409,
          "No applicable profiles today. Future rules remain visible until effective.",
        );
      for (const target of targets) {
        const id = `action:${hash(r.id + "|" + target.id)}`;
        if (!a.actions.some((x) => x.id === id))
          a.actions.push({
            id,
            ruleId: r.id,
            workerId: target.id === "agency" ? undefined : target.id,
            title: r.title,
            kind: r.action,
            due: r.deadline,
            status: "open",
          });
      }
      a.adopted.push(r.id);
      notifyAdoptedWorkers(a, r, c);
      a.notices.push({
        id: randomUUID(),
        kind: "adoption",
        ruleId: r.id,
        title: `Adopted ${r.title}: ${targets.length} affected profile(s).`,
        at: now(),
        read: false,
      });
      a.audit.push({
        at: now(),
        actor: ctx.userId,
        action: `Adopted ${r.id}; ${targets.length} actions created. Previous evidence retained.`,
      });
    });
  } else if (body.type === "notice-read") {
    const v = z.object({ id: z.string() }).parse(body);
    await mutate(agencyKey(ctx.agencyId), emptyAgency, (a) => {
      const n = a.notices.find((n) => n.id === v.id);
      if (!n) throw new HttpError(404, "Alert not found.");
      n.read = true;
    });
  } else if (body.type === "action-complete") {
    const v = z
      .object({ id: z.string(), note: z.string().trim().min(5).max(1000) })
      .parse(body);
    await mutate(agencyKey(ctx.agencyId), emptyAgency, (a) => {
      const action = a.actions.find((x) => x.id === v.id);
      if (!action) throw new HttpError(404, "Action not found.");
      if (a.collection?.rules.requirements.some((r) => r.id === action.ruleId) || ["document", "training", "renewal"].includes(action.kind))
        throw new HttpError(409, "Documentary evidence must be approved before completing this obligation.");
      action.status = "done";
      a.audit.push({
        at: now(),
        actor: ctx.userId,
        action: `Completed ${action.id}: ${v.note}`,
      });
    });
  } else throw new HttpError(400, "Unknown regulatory action.");
  return { ok: true };
}
function validateReview(r: Candidate, c: Corpus, local = false) {
  if (r.demo && !local)
    throw new HttpError(
      403,
      "Demo rules cannot be adopted in a live workspace.",
    );
  if (
    !r.evidenceValid ||
    !r.scopeComplete ||
    r.unresolved.length ||
    !r.effectiveFrom ||
    r.legalStatus !== "enacted"
  )
    throw new HttpError(
      409,
      "Evidence, enacted status, effective date and complete scope are required.",
    );
  const source = c.sources.find((s) => s.id === r.sourceId);
  if (
    !source?.approved ||
    source.kind === "discovery" ||
    source.error ||
    !source.lastSuccess
  )
    throw new HttpError(409, "Source is not ready for adoption.");
  if (
    Date.now() - Date.parse(source.lastSuccess) >
    source.intervalHours * 7200000
  )
    throw new HttpError(409, "Source is stale. Rescan before approval.");
  if (source.snapshotId !== r.snapshotId)
    throw new HttpError(
      409,
      "A newer source snapshot exists. Review the latest candidates.",
    );
}
export async function enqueue(sourceId?: string, manual = false) {
  return mutate(CORPUS, initialCorpus, (c) => {
    let count = 0;
    for (const s of c.sources) {
      if (sourceId && s.id !== sourceId) continue;
      if (!s.approved) continue;
      if (
        !manual &&
        s.lastChecked &&
        Date.now() - Date.parse(s.lastChecked) < s.intervalHours * 3600000
      )
        continue;
      if (
        c.jobs.some(
          (j) =>
            j.sourceId === s.id &&
            (j.state === "queued" || j.state === "running"),
        )
      )
        continue;
      c.jobs.push({
        id: randomUUID(),
        sourceId: s.id,
        state: "queued",
        attempts: 0,
        availableAt: now(),
        createdAt: now(),
      });
      count++;
    }
    c.jobs = c.jobs.filter(
      (j) =>
        j.state === "queued" ||
        j.state === "running" ||
        Date.now() - Date.parse(j.createdAt) < 30 * 86400000,
    );
    return count;
  });
}
// One bounded stage per lease. Cursor/snapshot checkpoints survive process restarts.
export async function tick() {
  await fanOutAlerts();
  await enqueue();
  const token = randomUUID();
  const job = await mutate(CORPUS, initialCorpus, (c) => {
    c.lastTick = now();
    const j = c.jobs.find(
      (j) =>
        (j.state === "queued" ||
          (j.state === "running" &&
            Date.parse(j.leaseUntil || "") < Date.now())) &&
        Date.parse(j.availableAt) <= Date.now(),
    );
    if (!j) return null;
    j.state = "running";
    j.token = token;
    j.leaseUntil = new Date(Date.now() + 180000).toISOString();
    j.attempts++;
    return { ...j };
  });
  if (!job) return { processed: false };
  try {
    const catalog = (await readDoc(CORPUS, initialCorpus)).data;
    const source = catalog.sources.find((s) => s.id === job.sourceId);
    if (!source?.approved) throw new Error("Source disabled or missing.");
    const checkpoint = {
      data: job.snapshotId
        ? { snapshotId: job.snapshotId, cursor: job.cursor || 0 }
        : null,
    };
    if (!checkpoint.data) {
      const fetched = await fetchOfficial(source.url, {
        ...(source.etag ? { "if-none-match": source.etag } : {}),
        ...(source.modified ? { "if-modified-since": source.modified } : {}),
      });
      if (fetched.notModified) {
        await finish(job.id, token, (s) => {
          s.lastSuccess = now();
          s.lastChecked = now();
          s.error = undefined;
        });
        return { processed: true, state: "unchanged" };
      }
      const snap = await parseSnapshot(source, fetched);
      await saveImmutable(snap.id, snap);
      let unchanged = false;
      if (source.snapshotId) {
        const old = (
          await readDoc<Snapshot | null>(source.snapshotId, () => null)
        ).data;
        unchanged = old?.textHash === snap.textHash;
      }
      if (source.kind === "discovery" || unchanged) {
        await finish(job.id, token, (s) => {
          s.lastChecked = now();
          s.lastSuccess = now();
          s.error = undefined;
          s.hash = snap.hash;
          s.etag = fetched.etag;
          s.modified = fetched.modified;
          if (!unchanged) s.snapshotId = snap.id;
        });
        return {
          processed: true,
          state: unchanged ? "unchanged" : "discovery",
          links: snap.links.length,
        };
      }
      await mutate(CORPUS, initialCorpus, (c) => {
        const live = c.jobs.find((j) => j.id === job.id);
        if (live?.token !== token) throw new Error("Lease lost.");
        live.snapshotId = snap.id;
        live.cursor = 0;
      });
      await release(job.id, token);
      return { processed: true, state: "captured" };
    }
    const snap = (
      await readDoc<Snapshot | null>(checkpoint.data.snapshotId, () => null)
    ).data;
    if (!snap) throw new Error("Source snapshot missing.");
    const cursor = checkpoint.data.cursor;
    const chunk = snap.sections.slice(cursor, cursor + 2);
    if (!chunk.length) {
      await finish(job.id, token, (s) => {
        s.lastChecked = now();
        s.lastSuccess = now();
        s.error = undefined;
        s.hash = snap.hash;
        s.snapshotId = snap.id;
      });
      return { processed: true, state: "complete" };
    }
    const today = now().slice(0, 10);
    const reservation = 24000;
    await mutate(CORPUS, initialCorpus, (c) => {
      if (c.usage.day !== today) c.usage = { day: today, calls: 0, tokens: 0 };
      if (
        c.usage.calls >=
          Number(process.env.REGULATORY_DAILY_CALL_LIMIT || 20) ||
        c.usage.tokens + reservation >
          Number(process.env.REGULATORY_DAILY_TOKEN_LIMIT || 100000)
      )
        throw new Error(
          "Daily AI budget reached. Work remains queued until tomorrow.",
        );
      c.usage.calls++;
      c.usage.tokens += reservation;
    });
    const out = await extract(snap, source, chunk);
    await mutate(CORPUS, initialCorpus, (c) => {
      const live = c.jobs.find((j) => j.id === job.id);
      if (live?.token !== token) throw new Error("Lease lost.");
      live.cursor = cursor + chunk.length;
      live.state = "queued";
      live.attempts = 0;
      live.leaseUntil = undefined;
      c.usage.tokens += out.tokens - reservation;
      for (const candidate of out.candidates) {
        if (!c.candidates.some((r) => r.id === candidate.id)) {
          const prior = [...c.candidates]
            .reverse()
            .find(
              (r) =>
                r.sourceId === source.id && r.citation === candidate.citation,
            );
          c.candidates.push({ ...candidate, previousId: prior?.id });
        }
      }
    });
    await fanOutAlerts();
    return {
      processed: true,
      state: "extracted",
      candidates: out.candidates.length,
    };
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Source processing failed.";
    const budget = message.includes("Daily AI budget");
    await mutate(CORPUS, initialCorpus, (c) => {
      const j = c.jobs.find((j) => j.id === job.id);
      if (!j || j.token !== token) return;
      j.error = message;
      j.state = budget || j.attempts < 3 ? "queued" : "failed";
      j.availableAt = new Date(
        budget
          ? Date.parse(now().slice(0, 10)) + 86400000
          : Date.now() + Math.pow(2, j.attempts) * 60000,
      ).toISOString();
      j.leaseUntil = undefined;
      const s = c.sources.find((s) => s.id === j.sourceId);
      if (s) {
        s.error = message;
        s.lastChecked = now();
      }
    });
    return { processed: true, state: "failed", error: message };
  }
}
async function release(id: string, token: string) {
  await mutate(CORPUS, initialCorpus, (c) => {
    const j = c.jobs.find((j) => j.id === id);
    if (j?.token !== token) throw new Error("Lease lost.");
    j.state = "queued";
    j.attempts = 0;
    j.leaseUntil = undefined;
  });
}
async function finish(id: string, token: string, update: (s: Source) => void) {
  await mutate(CORPUS, initialCorpus, (c) => {
    const j = c.jobs.find((j) => j.id === id);
    if (j?.token !== token) throw new Error("Lease lost.");
    j.state = "done";
    j.finishedAt = now();
    j.leaseUntil = undefined;
    const s = c.sources.find((s) => s.id === j.sourceId);
    if (s) update(s);
  });
}
