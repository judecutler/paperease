import type { AgencyState, Candidate, Corpus, WorkerNotice } from "./types";
import { applicable } from "./engine";
import { hash, normalize } from "./fetch";
import { agencyDocumentIds, mutate, readDoc } from "./store";
import { emptyAgency } from "./types";
import { initialCorpus } from "./jurisdictions";

const timestamp = () => new Date().toISOString();
function relevant(rule: Candidate, a: AgencyState) {
  if (
    rule.jurisdiction !== "US" &&
    !a.profile.operatingStates.includes(rule.jurisdiction) &&
    !a.workers.some((w) => w.serviceState === rule.jurisdiction)
  )
    return false;
  return rule.services.some(
    (s) =>
      a.profile.services.includes(s) || a.workers.some((w) => w.service === s),
  );
}
function changed(rule: Candidate, corpus: Corpus) {
  if (!rule.previousId) return true;
  const old = corpus.candidates.find((r) => r.id === rule.previousId);
  if (!old) return true;
  return (
    JSON.stringify([
      normalize(rule.quote),
      rule.legalStatus,
      rule.effectiveFrom,
      rule.effectiveTo,
      rule.deadline,
      rule.services,
      rule.roles,
    ]) !==
    JSON.stringify([
      normalize(old.quote),
      old.legalStatus,
      old.effectiveFrom,
      old.effectiveTo,
      old.deadline,
      old.services,
      old.roles,
    ])
  );
}
/** Unreviewed changes alert agency staff only. Worker instructions require adoption. */
export function addChangeAlerts(a: AgencyState, corpus: Corpus) {
  let added = 0;
  for (const rule of corpus.candidates) {
    if (rule.effectiveTo && rule.effectiveTo <= timestamp().slice(0, 10))
      continue;
    if (!relevant(rule, a) || !changed(rule, corpus)) continue;
    const id = `notice:${hash(rule.id)}`;
    if (a.notices.some((n) => n.id === id)) continue;
    a.notices.push({
      id,
      ruleId: rule.id,
      kind: "regulatory-change",
      title: rule.previousId
        ? "Regulation change detected"
        : "New requirement detected",
      detail: `${rule.demo ? "SIMULATED DEMO: " : ""}${rule.title}. ${rule.jurisdiction}; ${rule.legalStatus}. Review the evidence and affected profiles before worker instructions are issued.`,
      at: timestamp(),
      read: false,
    });
    added++;
  }
  return added;
}
export function workerMessage(
  rule: Candidate,
  a: AgencyState,
  workerId: string,
  corpus: Corpus,
): WorkerNotice {
  const worker = a.workers.find((w) => w.id === workerId);
  if (
    !worker ||
    rule.subject !== "worker" ||
    applicable(rule, a.profile, worker).result !== "applicable"
  )
    throw new Error("Worker is not in scope for this obligation.");
  const source = corpus.sources.find((s) => s.id === rule.sourceId);
  if (!source) throw new Error("Source is missing.");
  const reason = `This applies to your ${worker.role.replaceAll("-", " ")} assignment providing ${worker.service.replaceAll("-", " ")} services in ${worker.serviceState}.`;
  const action =
    rule.action === "document" ||
    rule.action === "training" ||
    rule.action === "renewal"
      ? "Read the full requirement and submit the required evidence to your agency for review."
      : "Contact your agency to complete the assigned compliance action.";
  return {
    id: `worker-notice:${hash(rule.id + "|" + worker.id)}`,
    workerId: worker.id,
    ruleId: rule.id,
    title: rule.title,
    body: `${rule.demo ? "DEMO ONLY. This is a simulated company policy, not an actual regulation. " : ""}Your agency has reviewed a requirement that concerns your assignment. ${rule.obligation}`,
    reason,
    action,
    citation: rule.citation,
    sourceUrl: source.url,
    effectiveFrom: rule.effectiveFrom!,
    deadline: rule.deadline,
    createdAt: timestamp(),
    channel: "in-app",
    generatedBy: "careloop-agent",
    demo: !!rule.demo,
  };
}
export function notifyAdoptedWorkers(
  a: AgencyState,
  rule: Candidate,
  corpus: Corpus,
) {
  if (
    !a.adopted.includes(rule.id) ||
    !a.reviews.some((r) => r.ruleId === rule.id && r.decision === "approved")
  )
    return 0;
  if (rule.subject !== "worker") return 0;
  const messages = (a.workerNotices ??= []);
  let count = 0;
  for (const worker of a.workers) {
    if (applicable(rule, a.profile, worker).result !== "applicable") continue;
    const id = `worker-notice:${hash(rule.id + "|" + worker.id)}`;
    if (messages.some((m) => m.id === id)) continue;
    messages.push(workerMessage(rule, a, worker.id, corpus));
    count++;
  }
  if (count)
    a.audit.push({
      at: timestamp(),
      actor: "CareLoop agent",
      action: `Published ${count} in-app worker notification(s) for reviewed rule ${rule.id}. No SMS or email sent.`,
    });
  return count;
}
export async function syncAlerts(agencyId: string, corpus?: Corpus) {
  const c = corpus || (await readDoc("reg:corpus", initialCorpus)).data;
  const key = `reg:agency:${agencyId}`;
  const current = await readDoc(key, emptyAgency);
  const preview = structuredClone(current.data);
  if (!addChangeAlerts(preview, c)) return;
  await mutate(key, emptyAgency, (a) => {
    addChangeAlerts(a, c);
  });
}
export async function fanOutAlerts() {
  const corpus = (await readDoc("reg:corpus", initialCorpus)).data;
  for (const key of await agencyDocumentIds())
    await syncAlerts(key.slice("reg:agency:".length), corpus);
}
