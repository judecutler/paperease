import { randomUUID } from "node:crypto";
import { notifyAdoptedWorkers } from "./notifications";
import { z } from "zod";
import { readDoc, writeDoc, mutate, saveImmutable } from "./store";
import { agencyKey, CORPUS } from "./service";
import { initialCorpus } from "./jurisdictions";
import { emptyAgency, type Context } from "./types";
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
    hcos: [],
    staff: [],
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
        !["document", "training", "renewal"].includes(rule.action)
      )
        continue;
      if (!db.rules.requirements.some((r) => r.id === id))
        db.rules.requirements.push({
          id,
          name: rule.title,
          rule: `${rule.citation}: ${rule.obligation}`,
          ruleVersionId: rule.id,
          subject: rule.subject,
          contractConfirmed: false,
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
      notifyAdoptedWorkers(a, rule, corpus);
      const definition = db.rules.requirements.find((r) => r.id === id)!;
      if (a.evidenceContracts?.[id]) Object.assign(definition, a.evidenceContracts[id]);
      const targets = rule.subject === "agency" ? [{ id: "agency", name: a.profile.name }] : a.workers;
      for (const w of targets) {
        const match = applicable(rule, a.profile, rule.subject === "worker" ? a.workers.find((x) => x.id === w.id) : undefined);
        const prior = db.requirements.find(
          (s) => s.caregiverId === w.id && s.requirementId === id,
        );
        if (match.result === "applicable" && !prior)
          db.requirements.push({
            caregiverId: w.id,
            subject: rule.subject,
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
    for (const item of db.requirements) {
      const rule = corpus.candidates.find((r) => r.id === item.requirementId);
      item.inactive = !rule || !a.adopted.includes(rule.id) || a.adopted.some((id) => {
        let next = corpus.candidates.find((r) => r.id === id);
        const seen = new Set<string>();
        while (next?.previousId && !seen.has(next.id)) {
          seen.add(next.id);
          if (next.previousId === rule?.id) return true;
          next = corpus.candidates.find((r) => r.id === next!.previousId);
        }
        return false;
      }) || applicable(rule, a.profile, a.workers.find((w) => w.id === item.caregiverId)).result !== "applicable";
      if (item.expiresOn && item.expiresOn <= new Date().toISOString().slice(0, 10)) {
        item.status = "expiring";
        const action = a.actions.find((x) => x.ruleId === item.requirementId && (x.workerId || "agency") === item.caregiverId);
        if (action) action.status = "open";
      }
      if (item.inactive) item.reevaluationRequired = true;
      if (rule?.previousId && !item.approvedSubmissionId) item.reevaluationRequired = true;
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
    const { submitStoredEvidence } = await import("./compliance");
    await submitStoredEvidence(ctx, head);
    return payload(await syncCollection(ctx));
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
      const { reviewEvidence } = await import("./compliance");
      await reviewEvidence(ctx, { type: "approve", submissionId: v.submissionId, attest: false });
      return payload(await syncCollection(ctx));
    }
    await run(v as Action, { db });
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
