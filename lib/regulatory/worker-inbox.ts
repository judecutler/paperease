import { readDoc, mutate } from "./store";
import { emptyAgency } from "./types";
import { applicable } from "./engine";
import { initialCorpus } from "./jurisdictions";
import { HttpError } from "./auth";
export interface WorkerContext {
  agencyId: string;
  workerId: string;
  userId: string;
  local: boolean;
}
export async function workerInbox(ctx: WorkerContext) {
  const a = (await readDoc(`reg:agency:${ctx.agencyId}`, emptyAgency)).data;
  const worker = a.workers.find((w) => w.id === ctx.workerId);
  if (!worker) throw new HttpError(404, "Worker assignment not found.");
  const corpus = (await readDoc("reg:corpus", initialCorpus)).data;
  return {
    worker: {
      id: worker.id,
      name: worker.name,
      serviceState: worker.serviceState,
    },
    local: ctx.local,
    messages: (a.workerNotices || [])
      .filter((m) => m.workerId === ctx.workerId)
      .map((m) => {
        const rule = corpus.candidates.find((r) => r.id === m.ruleId);
        return {
          ...m,
          currentApplicability: rule
            ? applicable(rule, a.profile, worker).result
            : "needs-review",
        };
      }),
  };
}
export async function acknowledgeWorkerNotice(ctx: WorkerContext, id: string) {
  await mutate(`reg:agency:${ctx.agencyId}`, emptyAgency, (a) => {
    const message = a.workerNotices?.find(
      (m) => m.id === id && m.workerId === ctx.workerId,
    );
    if (!message) throw new HttpError(404, "Message not found.");
    if (message.acknowledgedAt) return;
    message.acknowledgedAt = new Date().toISOString();
    message.acknowledgedBy = ctx.userId;
    a.audit.push({
      at: message.acknowledgedAt,
      actor: ctx.userId,
      action: `Worker ${ctx.workerId} acknowledged ${id}. Acknowledgment does not establish compliance.`,
    });
  });
  return { ok: true };
}
