import { initialCorpus } from "./jurisdictions";
import {
  emptyAgency,
  type Candidate,
  type Snapshot,
  type Context,
} from "./types";
import { writeDoc, readDoc, localMode } from "./store";
import { CORPUS, agencyKey } from "./service";
import { hash } from "./fetch";
import { HttpError } from "./auth";
export async function resetDemo(ctx: Context) {
  if (!ctx.local || !localMode())
    throw new HttpError(
      403,
      "Guided demo is isolated from live Supabase workspaces.",
    );
  const corpus = initialCorpus();
  const a = emptyAgency();
  const now = new Date().toISOString();
  a.profile = {
    name: "Harbor Home Care · demo",
    ownership: "for-profit",
    headquarters: "NY",
    operatingStates: ["CA"],
    services: ["nonmedical"],
    payers: ["private"],
    agencyLicense: "Demo profile, not a verified license",
    programs: [],
  };
  a.workers = [
    {
      id: "demo-maria",
      name: "Maria Lopez",
      role: "home-care-aide",
      residence: "NV",
      serviceState: "CA",
      service: "nonmedical",
      locality: "",
      licenseStates: [],
      licenseExpires: "",
    },
  ];
  const old =
    "SIMULATED COMPANY POLICY, NOT A LAW. Each home care aide providing nonmedical services in California must provide evidence of three hours of annual safety training. Applies to this fictional private agency only.";
  const text =
    "SIMULATED COMPANY POLICY, NOT A LAW. Each home care aide providing nonmedical services in California must provide evidence of five hours of annual safety training. Applies to this fictional private agency only.";
  const snapshot: Snapshot = {
    id: "snapshot:guided-demo:training-v2",
    sourceId: "guided-demo-training",
    url: "https://example.invalid/simulated-policy",
    fetchedAt: now,
    hash: hash(text),
    textHash: hash(text),
    contentType: "text/plain",
    rawBase64: Buffer.from(text).toString("base64"),
    sections: [{ index: 0, label: "Simulated policy, section 1", text }],
    links: [],
    truncated: false,
  };
  const rule: Candidate = {
    id: "rule:guided-demo:training-v2",
    sourceId: snapshot.sourceId,
    snapshotId: snapshot.id,
    jurisdiction: "CA",
    title: "Demo: annual safety training changes from 3 to 5 hours",
    citation: "Simulated agency policy, section 1",
    obligation:
      "Collect evidence of five hours of annual safety training for this fictional California assignment. This is a simulated company policy, not a verified legal requirement.",
    quote: text,
    section: 0,
    topic: "training",
    subject: "worker",
    legalStatus: "enacted",
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    deadline: null,
    services: ["nonmedical"],
    roles: ["home-care-aide"],
    ownership: ["for-profit"],
    payers: ["private"],
    exceptions: "",
    unresolved: [],
    scopeComplete: true,
    action: "training",
    createdAt: now,
    evidenceValid: true,
    model: "simulated-demo",
    promptVersion: "demo-v1",
    demo: true,
    previousId: "rule:guided-demo:training-v1",
  };
  corpus.sources.push({
    id: snapshot.sourceId,
    jurisdiction: "CA",
    title: "Simulated policy change · demo only",
    url: snapshot.url,
    authority: "Fictional agency, not a regulator",
    kind: "law",
    topic: "training",
    approved: true,
    approvedBy: "Isolated demo fixture",
    intervalHours: 720,
    lastSuccess: now,
    lastChecked: now,
    snapshotId: snapshot.id,
  });
  corpus.candidates.push(
    {
      ...rule,
      id: rule.previousId!,
      snapshotId: "snapshot:guided-demo:training-v1",
      title: "Demo: previous training policy",
      obligation: old,
      quote: old,
      previousId: undefined,
      effectiveTo: "2020-01-01",
      effectiveFrom: "2019-01-01",
    },
    rule,
  );
  a.audit.push({
    at: now,
    actor: "demo",
    action:
      "Initialized an explicitly simulated policy change. No live source or AI call was used.",
  });
  const c = await readDoc(CORPUS, initialCorpus);
  await writeDoc(CORPUS, corpus, c.revision);
  const current = await readDoc(agencyKey(ctx.agencyId), emptyAgency);
  await writeDoc(agencyKey(ctx.agencyId), a, current.revision);
  const oldSnapshot = await readDoc<Snapshot | null>(snapshot.id, () => null);
  await writeDoc(snapshot.id, snapshot, oldSnapshot.revision);
  const previous = {
    ...snapshot,
    id: "snapshot:guided-demo:training-v1",
    hash: hash(old),
    textHash: hash(old),
    sections: [{ index: 0, label: "Previous simulated policy", text: old }],
    rawBase64: Buffer.from(old).toString("base64"),
  };
  const prior = await readDoc<Snapshot | null>(previous.id, () => null);
  await writeDoc(previous.id, previous, prior.revision);
  return { ok: true };
}
