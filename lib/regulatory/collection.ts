import { randomUUID } from "node:crypto";
import { z } from "zod";
import { readDoc, writeDoc, mutate, saveImmutable } from "./store";
import { agencyKey, CORPUS } from "./service";
import { initialCorpus } from "./jurisdictions";
import { emptyAgency, type Context, type Corpus } from "./types";
import { applicable } from "./engine";
import { HttpError } from "./auth";
import { run, type Action } from "../agent";
import { payload } from "../payload";
import type { Db, SubmissionFile } from "../types";
function emptyCollection(name: string): Db {
  return {
    version: 1,
    agency: { name, admin: "Workspace administrator" },
    rules: {
      expiringWithinDays: 30,
      minConfidence: 0.8,
      maxFollowUps: 2,
      autoRequest: false,
      reminderAfterDays: 2,
      maxReminders: 2,
      requirements: [],
    },
    caregivers: [],
    requirements: [],
    submissions: [],
    messages: [],
    audit: [],
  };
}
export async function syncCollection(ctx: Context) {
  const corpus = (await readDoc(CORPUS, initialCorpus)).data;
  await mutate(agencyKey(ctx.agencyId), emptyAgency, (a) => {
    const db = (a.collection ??= emptyCollection(a.profile.name));
    db.agency.name = a.profile.name;
    for (const w of a.workers) {
      const existing = db.caregivers.find((c) => c.id === w.id);
      if (existing) {
        existing.name = w.name;
        existing.firstName = w.name.split(" ")[0];
      } else
        db.caregivers.push({
          id: w.id,
          name: w.name,
          firstName: w.name.split(" ")[0],
          phone: "",
          language: "en",
          hiredOn: new Date().toISOString().slice(0, 10),
          smsConsent: false,
        });
    }
    for (const id of a.adopted) {
      const rule = corpus.candidates.find((r) => r.id === id);
      if (
        !rule ||
        rule.subject !== "worker" ||
        !["document", "training", "renewal"].includes(rule.action)
      )
        continue;
      if (!db.rules.requirements.some((r) => r.id === id))
        db.rules.requirements.push({
          id,
          name: rule.title,
          rule: `${rule.citation}: ${rule.obligation}`,
          ruleVersionId: rule.id,
          smsCollectible: false,
          validMonths: null,
          ask: "evidence for the reviewed obligation",
          fields: [
            { key: "name", label: "Worker name", required: true, kind: "text" },
            {
              key: "completion_date",
              label: "Evidence date",
              required: true,
              kind: "date",
            },
            {
              key: "evidence_notes",
              label: "How this evidence meets the cited obligation",
              required: true,
              kind: "text",
            },
          ],
        });
      for (const w of a.workers) {
        const match = applicable(rule, a.profile, w);
        const prior = db.requirements.find(
          (s) => s.caregiverId === w.id && s.requirementId === id,
        );
        if (match.result === "applicable" && !prior)
          db.requirements.push({
            caregiverId: w.id,
            requirementId: id,
            status: "missing",
            explanation: `Evidence required under ${rule.citation}. Human review must check the full obligation and any renewal interval.`,
          });
        if (
          prior &&
          match.result !== "applicable" &&
          prior.status !== "escalated"
        ) {
          prior.status = "escalated";
          prior.explanation = `Assignment/date changed: ${match.reasons.join(" ")} Historical evidence retained; reassess applicability.`;
        }
      }
    }
  });
  return (await readDoc(agencyKey(ctx.agencyId), emptyAgency)).data.collection!;
}
export async function collectionAction(ctx: Context, input: unknown) {
  if (ctx.role !== "admin")
    throw new HttpError(403, "Administrator access required.");
  await syncCollection(ctx);
  const doc = await readDoc(agencyKey(ctx.agencyId), emptyAgency);
  const db = doc.data.collection!;
  db.agency.admin = ctx.userId;
  const head = z
    .object({
      type: z.enum([
        "verify-field",
        "edit-field",
        "approve",
        "reject",
        "run-gap-check",
        "evidence-submit",
      ]),
    })
    .passthrough()
    .parse(input);
  if (head.type === "evidence-submit") {
    const v = z
      .object({
        caregiverId: z.string(),
        requirementId: z.string(),
        notes: z.string().min(10).max(4000),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        fileId: z.string().uuid(),
      })
      .parse(head);
    const file = (
      await readDoc<{ name: string; mime: string } | null>(
        `file:${ctx.agencyId}:${v.fileId}`,
        () => null,
      )
    ).data;
    if (!file)
      throw new HttpError(404, "Evidence file not found in this workspace.");
    const cg = db.caregivers.find((c) => c.id === v.caregiverId);
    const req = db.rules.requirements.find((r) => r.id === v.requirementId);
    const state = db.requirements.find(
      (s) =>
        s.caregiverId === v.caregiverId && s.requirementId === v.requirementId,
    );
    if (!cg || !req || !state)
      throw new HttpError(404, "Checklist item not found.");
    const id = randomUUID();
    db.submissions.push({
      id,
      caregiverId: cg.id,
      requirementId: req.id,
      files: [
        {
          name: file.name,
          mime: file.mime,
          url: `/api/regulatory/files/${v.fileId}`,
        },
      ],
      fields: [
        {
          key: "name",
          label: "Worker name",
          value: cg.name,
          source: "caregiver",
          required: true,
        },
        {
          key: "completion_date",
          label: "Evidence date",
          value: v.date,
          source: "caregiver",
          required: true,
        },
        {
          key: "evidence_notes",
          label: "How evidence meets the cited obligation",
          value: v.notes,
          source: "caregiver",
          required: true,
        },
      ],
      extractedBy: "none",
      createdAt: new Date().toISOString(),
      state: "ready",
      followUps: 0,
      supersedes: state.openSubmissionId || state.approvedSubmissionId,
    });
    state.openSubmissionId = id;
    state.status = "pending-review";
    state.explanation =
      "Staff-submitted evidence. Verify every field and the full legal obligation before approval.";
  } else {
    if ("submissionId" in head) {
      const target = db.submissions.find((s) => s.id === head.submissionId);
      if (!target) throw new HttpError(404, "Submission not found.");
      if (target.state !== "ready")
        throw new HttpError(
          409,
          "Only pending evidence can be changed or approved. Submit a new version.",
        );
    }
    const v =
      head.type === "verify-field"
        ? z
            .object({
              type: z.literal("verify-field"),
              submissionId: z.string(),
              key: z.string(),
            })
            .parse(head)
        : head.type === "edit-field"
          ? z
              .object({
                type: z.literal("edit-field"),
                submissionId: z.string(),
                key: z.string(),
                value: z.string().max(4000),
              })
              .parse(head)
          : head.type === "reject"
            ? z
                .object({
                  type: z.literal("reject"),
                  submissionId: z.string(),
                  reason: z.string().max(2000).optional(),
                })
                .parse(head)
            : head.type === "approve"
              ? z
                  .object({
                    type: z.literal("approve"),
                    submissionId: z.string(),
                  })
                  .parse(head)
              : { type: "run-gap-check" as const };
    if (v.type === "approve") {
      const sub = db.submissions.find((s) => s.id === v.submissionId);
      if (!sub) throw new HttpError(404, "Submission not found.");
      const corpus = (await readDoc(CORPUS, initialCorpus)).data;
      const rule = corpus.candidates.find((r) => r.id === sub.requirementId);
      const worker = doc.data.workers.find((w) => w.id === sub.caregiverId);
      if (
        !rule ||
        applicable(rule, doc.data.profile, worker).result !== "applicable"
      )
        throw new HttpError(
          409,
          "Reassess applicability before approving evidence.",
        );
    }
    await run(v as Action, db);
  }
  doc.data.audit.push({
    at: new Date().toISOString(),
    actor: ctx.userId,
    action: `Evidence workflow: ${head.type}`,
  });
  await writeDoc(agencyKey(ctx.agencyId), doc.data, doc.revision);
  return payload(db);
}
export async function uploadEvidence(ctx: Context, form: FormData) {
  if (ctx.role !== "admin")
    throw new HttpError(403, "Administrator access required.");
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Choose a file.");
  if (
    !["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(
      file.type,
    ) ||
    file.size > 4 * 1024 * 1024 ||
    file.size === 0
  )
    throw new HttpError(
      400,
      "Use a nonempty PDF, PNG, JPEG or WebP up to 4 MB.",
    );
  const id = randomUUID();
  await saveImmutable(`file:${ctx.agencyId}:${id}`, {
    name: file.name,
    mime: file.type,
    bytes: Buffer.from(await file.arrayBuffer()).toString("base64"),
  });
  return { id };
}
