import { z } from "zod";
import { randomUUID } from "node:crypto";
import { readDoc, mutate, saveImmutable } from "./store";
import { agencyKey } from "./service";
import { emptyAgency, type Context } from "./types";
import { HttpError } from "./auth";
import { syncCollection } from "./collection";
import type { WorkerContext } from "./worker-inbox";
import type { Db, RequirementState, Submission, RequirementType } from "../types";
import { extractDocument, type Extraction } from "../llm";
import { inspectPhoto, sameCaregiverName } from "../photo-check";

export const statusLabels = { missing: "To provide", incomplete: "Needs information", review: "Under review", approved: "Approved", expired: "Expired" } as const;
type EvidenceFile = { name: string; mime: string; bytes: string; workerId?: string };
export const adminContext = (ctx: WorkerContext): Context => ({ agencyId: ctx.agencyId, userId: ctx.userId, local: ctx.local, role: "viewer" });
export function evidenceIssues(req: RequirementType, sub: Submission) {
  const value = (key: string) => sub.fields.find((f) => f.key === key)?.value?.trim();
  const issues = req.fields.filter((f) => f.required && !value(f.key)).map((f) => `${f.label} : missing information`);
  for (const field of req.fields) {
    const v = value(field.key);
    if (v && field.kind === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v)) issues.push(`${field.label} : invalid date`);
    if (v && field.kind === "number" && !Number.isFinite(Number(v))) issues.push(`${field.label} : invalid number`);
  }
  if (req.minHours !== undefined && (!value("hours") || !Number.isFinite(Number(value("hours"))) || Number(value("hours")) < req.minHours)) issues.push(`At least ${req.minHours} training hours are required`);
  const expiration = req.expirationField && value(req.expirationField);
  if (expiration && expiration <= new Date().toISOString().slice(0, 10)) issues.push("The document has expired");
  return issues;
}
export function evidenceStatus(db: Db, item: RequirementState): keyof typeof statusLabels {
  const req = db.rules.requirements.find((r) => r.id === item.requirementId)!;
  const sub = db.submissions.find((s) => s.id === (item.openSubmissionId || item.approvedSubmissionId));
  if (!sub) return "missing";
  const expiration = req.expirationField && sub.fields.find((f) => f.key === req.expirationField)?.value;
  if (expiration && expiration <= new Date().toISOString().slice(0, 10)) return "expired";
  if (sub.state === "rejected" || evidenceIssues(req, sub).length) return "incomplete";
  if (sub.state === "approved" && sub.ruleVersionId === req.ruleVersionId) return "approved";
  return "review";
}
export async function complianceView(ctx: Context, workerId?: string) {
  const db = await syncCollection(ctx);
  const a = (await readDoc(agencyKey(ctx.agencyId), emptyAgency)).data;
  if (workerId && !a.workers.some((w) => w.id === workerId)) throw new HttpError(404, "Record not found.");
  const items = db.requirements.filter((s) => !s.inactive && (!workerId || s.caregiverId === workerId)).map((item) => {
    const requirement = db.rules.requirements.find((r) => r.id === item.requirementId)!;
    const submissions = db.submissions.filter((s) => s.caregiverId === item.caregiverId && s.requirementId === item.requirementId).map((s) => ({ ...s, files: s.files.map((f) => ({ ...f, url: workerId ? f.url.replace("/files/", "/worker-files/") : f.url })) }));
    const status = evidenceStatus(db, item);
    return { ...item, status, label: statusLabels[status], requirement, submissions, due: a.actions.find((x) => x.ruleId === item.requirementId && (x.workerId || "agency") === item.caregiverId)?.due, name: item.caregiverId === "agency" ? a.profile.name : a.workers.find((w) => w.id === item.caregiverId)?.name };
  });
  // Older versions remain available, but never enter the active compliance counts.
  const history = db.submissions.filter((s) => (!workerId || s.caregiverId === workerId) && !items.some((i) => i.requirementId === s.requirementId && i.caregiverId === s.caregiverId)).map((s) => ({ ...s, files: s.files.map((f) => ({ ...f, url: workerId ? f.url.replace("/files/", "/worker-files/") : f.url })) }));
  return { name: workerId ? a.workers.find((w) => w.id === workerId)!.name : a.profile.name, local: ctx.local, items, history, workers: workerId ? [] : a.workers.map(({ id, name }) => ({ id, name })) };
}
export async function workerFile(ctx: WorkerContext, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new HttpError(404, "Document not found.");
  const file = (await readDoc<EvidenceFile | null>(`file:${ctx.agencyId}:${id}`, () => null)).data;
  if (!file || file.workerId !== ctx.workerId) throw new HttpError(404, "Document not found.");
  return file;
}
export async function submitEvidence(ctx: Context, form: FormData, workerId?: string) {
  const target = workerId || String(form.get("caregiverId") || "");
  const requirementId = String(form.get("requirementId") || "");
  const view = await complianceView(ctx, workerId);
  const item = view.items.find((s) => s.requirementId === requirementId && s.caregiverId === target);
  if (!item) throw new HttpError(404, "Requirement not found.");
  if (!item.requirement.contractConfirmed) throw new HttpError(409, "Your company must confirm the document criteria before you can submit.");
  const file = form.get("file");
  if (!(file instanceof File) || !["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size === 0 || file.size > 4 * 1024 * 1024) throw new HttpError(400, "Choose a PDF or image up to 4 MB.");
  const fileId = randomUUID();
  await saveImmutable(`file:${ctx.agencyId}:${fileId}`, { name: file.name, mime: file.type, bytes: Buffer.from(await file.arrayBuffer()).toString("base64"), workerId: target });
  return submitStoredEvidence(ctx, { caregiverId: target, requirementId, fileId }, workerId);
}
export async function submitStoredEvidence(ctx: Context, input: unknown, workerId?: string) {
  if (!workerId && ctx.role !== "admin") throw new HttpError(403, "Administrator access required.");
  const v = z.object({ caregiverId: z.string(), requirementId: z.string(), fileId: z.string().uuid() }).parse(input);
  if (workerId && workerId !== v.caregiverId) throw new HttpError(404, "Document not found.");
  const view = await complianceView(ctx, workerId);
  const item = view.items.find((s) => s.requirementId === v.requirementId && s.caregiverId === v.caregiverId);
  if (!item || !item.requirement.contractConfirmed) throw new HttpError(409, "Document criteria must be confirmed by your company.");
  const file = (await readDoc<EvidenceFile | null>(`file:${ctx.agencyId}:${v.fileId}`, () => null)).data;
  if (!file || (workerId && file.workerId !== workerId)) throw new HttpError(404, "Document not found.");
  const req = item.requirement;
  const extraction = await extractDocument(req, "", undefined, file.mime.startsWith("image/") ? { data: file.bytes, mime: file.mime as "image/png" | "image/jpeg" | "image/webp" } : undefined);
  return saveAnalysis(ctx, v, file, req, extraction);
}
async function saveAnalysis(ctx: Context, v: {caregiverId: string; requirementId: string; fileId: string}, file: EvidenceFile, req: RequirementType, extraction: Extraction) {
  // Re-evaluate after the potentially slow AI call, so a concurrently replaced rule cannot be approved.
  await syncCollection(ctx);
  await mutate(agencyKey(ctx.agencyId), emptyAgency, (a) => {
    const db = a.collection!;
    const item = db.requirements.find((s) => s.caregiverId === v.caregiverId && s.requirementId === v.requirementId && !s.inactive);
    if (!item) throw new HttpError(409, "The requirement has changed. Refresh and try again.");
    const person = { id: v.caregiverId, name: v.caregiverId === "agency" ? a.profile.name : a.workers.find((w) => w.id === v.caregiverId)!.name, firstName: "", phone: "", language: "en" as const, smsConsent: false, hiredOn: "" };
    const sub: Submission = { id: randomUUID(), caregiverId: v.caregiverId, requirementId: req.id, ruleVersionId: req.ruleVersionId, createdAt: new Date().toISOString(), files: [{ name: file.name, mime: file.mime, url: `/api/regulatory/files/${v.fileId}` }], fields: req.fields.map((spec) => ({ ...spec, value: extraction.fields[spec.key]?.value || null, confidence: extraction.fields[spec.key]?.confidence, source: "ai" })), extractedBy: extraction.by, analysis: inspectPhoto({ caregiver: person, requirement: req, extraction, minConfidence: .8 }), state: "ready", followUps: 0, supersedes: item.openSubmissionId || item.approvedSubmissionId };
    const issues = evidenceIssues(req, sub);
    if (issues.length && extraction.by !== "none") {
      sub.analysis!.status = "needs-info";
      sub.analysis!.summary = "More information is needed.";
      sub.analysis!.nextStep = issues.join(". ");
    }
    db.submissions.push(sub);
    item.openSubmissionId = sub.id;
    item.status = "pending-review";
    item.explanation = sub.analysis!.nextStep;
    const action = a.actions.find((x) => x.ruleId === req.id && (x.workerId || "agency") === v.caregiverId);
    if (action) action.status = "open";
    a.audit.push({ at: sub.createdAt, actor: ctx.userId, action: `Evidence ${sub.id} submitted for ${req.ruleVersionId}; analysis ${extraction.by}. Human review required.` });
  });
  return { ok: true };
}
const contractSchema = z.object({ type: z.literal("contract"), requirementId: z.string(), ask: z.string().trim().min(3).max(300), fields: z.array(z.object({ key: z.string().regex(/^[a-z][a-z0-9_]*$/), label: z.string().min(1).max(100), required: z.boolean(), kind: z.enum(["text", "date", "number"]) })).min(1).max(20), minHours: z.number().nonnegative().optional(), expirationField: z.string().optional() });
export async function reviewEvidence(ctx: Context, input: unknown) {
  if (ctx.role !== "admin") throw new HttpError(403, "Administrator access required.");
  await syncCollection(ctx);
  const head = z.object({ type: z.enum(["contract", "approve", "reject", "request"]) }).passthrough().parse(input);
  await mutate(agencyKey(ctx.agencyId), emptyAgency, (a) => {
    const db = a.collection!;
    if (head.type === "contract") {
      const v = contractSchema.parse(input);
      const req = db.rules.requirements.find((r) => r.id === v.requirementId);
      if (!req) throw new HttpError(404, "Requirement not found.");
      if (db.submissions.some((s) => s.requirementId === req.id)) throw new HttpError(409, "Evidence already exists. Create a new rule version to change these criteria.");
      if (new Set(v.fields.map((f) => f.key)).size !== v.fields.length || (v.expirationField && !v.fields.some((f) => f.key === v.expirationField && f.kind === "date")) || (v.minHours !== undefined && !v.fields.some((f) => f.key === "hours" && f.kind === "number"))) throw new HttpError(400, "Check the fields, minimum hours and expiration date.");
      (a.evidenceContracts ??= {})[req.id] = { ...req, ask: v.ask, fields: v.fields, minHours: v.minHours, expirationField: v.expirationField, contractConfirmed: true };
    } else if (head.type === "request") {
      const v = z.object({ requirementId: z.string(), caregiverId: z.string() }).parse(input);
      const item = db.requirements.find((s) => s.requirementId === v.requirementId && s.caregiverId === v.caregiverId && !s.inactive);
      if (!item) throw new HttpError(404, "Requirement not found.");
      item.status = "requested";
      item.explanation = "Document requested. Find this request in your worker space.";
    } else {
      const v = z.object({ submissionId: z.string(), attest: z.boolean().default(false), values: z.record(z.string(), z.string().max(4000)).optional() }).parse(input);
      const sub = db.submissions.find((s) => s.id === v.submissionId);
      const item = sub && db.requirements.find((s) => s.requirementId === sub.requirementId && s.caregiverId === sub.caregiverId && !s.inactive && s.openSubmissionId === sub.id);
      if (!sub || !item || sub.state !== "ready") throw new HttpError(409, "This document is no longer pending review for the active requirement.");
      const req = db.rules.requirements.find((r) => r.id === sub.requirementId)!;
      if (head.type === "approve") {
        if (!v.attest && sub.fields.some((f) => f.source !== "verified" && f.source !== "edited")) throw new HttpError(409, "Confirm that you read the original document and checked every field.");
        if (v.values) for (const f of sub.fields) if (f.key in v.values) f.value = v.values[f.key];
        const issues = evidenceIssues(req, sub);
        const name = sub.fields.find((f) => f.key === "name")?.value;
        const expected = sub.caregiverId === "agency" ? a.profile.name : a.workers.find((w) => w.id === sub.caregiverId)?.name;
        if (name && expected && !sameCaregiverName(name, expected)) issues.push("The name does not match this record.");
        if (!req.contractConfirmed || sub.ruleVersionId !== req.ruleVersionId || issues.length) throw new HttpError(409, issues.join(". ") || "Reassess the criteria or rule version.");
        for (const f of sub.fields) { f.source = "verified"; f.verifiedBy = ctx.userId; }
        sub.state = "approved";
        sub.reviewedBy = ctx.userId;
        sub.reviewedAt = new Date().toISOString();
        item.approvedSubmissionId = sub.id;
        item.openSubmissionId = undefined;
        item.reevaluationRequired = false;
        item.status = "approved";
        item.expiresOn = req.expirationField ? sub.fields.find((f) => f.key === req.expirationField)?.value || undefined : undefined;
      } else { sub.state = "rejected"; item.status = "following-up"; }
      const action = a.actions.find((x) => x.ruleId === sub.requirementId && (x.workerId || "agency") === sub.caregiverId);
      if (action) action.status = head.type === "approve" ? "done" : "open";
    }
    a.audit.push({ at: new Date().toISOString(), actor: ctx.userId, action: `Document workflow: ${head.type}` });
  });
  return { ok: true };
}

/** Isolated, visibly synthetic fixtures. Never invoke a model or modify hosted workspaces. */
export async function demoEvidence(ctx: Context, input: unknown, workerId?: string) {
  const { localMode } = await import("./store");
  if (!ctx.local || !localMode()) throw new HttpError(403, "Examples are available only in the local demo.");
  const v = z.object({ requirementId: z.string(), caregiverId: z.string(), fixture: z.enum(["incomplete", "complete", "expired", "unavailable"]) }).parse(input);
  if (workerId && workerId !== v.caregiverId) throw new HttpError(404, "Record not found.");
  const item = (await complianceView(ctx, workerId)).items.find((i) => i.requirementId === v.requirementId && i.caregiverId === v.caregiverId);
  if (!item || !item.requirement.contractConfirmed || !item.requirementId.startsWith("rule:guided-demo:")) throw new HttpError(409, "Adopt the demo rule first.");
  const fields = Object.fromEntries(item.requirement.fields.map((f) => [f.key, { value: f.key === "name" ? item.name! : f.key === "hours" ? (v.fixture === "incomplete" ? null : "5") : f.key === "expiration_date" ? (v.fixture === "expired" ? "2020-01-01" : "2099-01-01") : f.kind === "date" ? "2026-01-01" : "Fictional example", confidence: .99 }]));
  const fileId = randomUUID();
  const file = { name: `DEMO-${v.fixture}.txt`, mime: "text/plain", bytes: Buffer.from(`FICTIONAL EXAMPLE. NOT A REAL DOCUMENT.\n${JSON.stringify(fields, null, 2)}`).toString("base64"), workerId: v.caregiverId };
  await saveImmutable(`file:${ctx.agencyId}:${fileId}`, file);
  return saveAnalysis(ctx, { ...v, fileId }, file, item.requirement, { by: v.fixture === "unavailable" ? "none" : "sample", readable: true, documentType: "Fictional sample document", matchesRequirement: true, fields: v.fixture === "unavailable" ? {} : fields, note: v.fixture === "unavailable" ? "Not checked: analysis unavailable. A person must read the original." : "Simulated result for this demonstration." });
}
