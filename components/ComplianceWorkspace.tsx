"use client";
import { useEffect, useState } from "react";
import { Button, ExtractedField } from "./ui";
import { BrandMark, BrandName } from "./Logo";
import type { complianceView } from "@/lib/regulatory/compliance";
import type { Submission } from "@/lib/types";
import "@/app/regulatory/regulatory.css";
type View = Awaited<ReturnType<typeof complianceView>>;
type Item = View["items"][number];
async function api(path: string, body?: unknown) {
  const query = typeof window === "undefined" ? "" : window.location.search;
  const response = await fetch(`/api/regulatory/${path}${query}`, { method: body ? "POST" : "GET", headers: body && !(body instanceof FormData) ? { "content-type": "application/json" } : undefined, body: body ? body instanceof FormData ? body : JSON.stringify(body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Unable to complete this request. Try again.");
  return data;
}
export function ComplianceWorkspace({ worker = false }: { worker?: boolean }) {
  const [data, setData] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [auth, setAuth] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState("");
  async function refresh() {
    try { setData(await api(worker ? "worker-compliance" : "compliance")); setAuth(false); setError(""); }
    catch (e) { const text = (e as Error).message; setError(text); setAuth(/Sign in|Session expired|No regulatory workspace/.test(text)); }
  }
  useEffect(() => { void refresh(); const interval = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 10000); return () => clearInterval(interval); }, [worker]);
  async function perform(path: string, body: unknown, confirmation: string) {
    setBusy(true); setError(""); setMessage("");
    try { await api(path, body); await refresh(); setMessage(confirmation); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const items = data?.items || [];
  const documents = [...items.flatMap((i) => i.submissions), ...(data?.history || [])];
  return <>
    <header className="topbar"><div className="topbar-inner"><a className="brand" href={worker ? "/regulatory/worker" : "/regulatory"}><BrandMark /><BrandName /></a><nav className="nav"><a href={worker ? "/regulatory/worker" : "/regulatory"} className="active">{worker ? "Worker home" : "Company home"}</a>{!worker && <a href="/regulatory/watch">Regulatory watch</a>}{data?.local && <a href={worker ? "/regulatory" : "/regulatory/worker"}>{worker ? "Company" : "Demo worker"}</a>}</nav></div></header>
    <main className="page compliance-page">
      <div className="page-head"><div><div className="eyebrow">{worker ? "worker" : "company"}</div><h1>{data ? worker ? `Hello ${data.name.split(" ")[0]}` : data.name : "Your documents and requirements"}</h1><p className="muted">{worker ? "Submit your documents and follow their progress here." : "See what to request, review and approve."}</p></div><Button disabled={busy} onClick={refresh}>Refresh</Button></div>
      {error && <div className="reg-caution" role="alert">{error} <Button disabled={busy} onClick={refresh}>Try again</Button></div>}
      {message && <p className="reg-caution" role="status">{message}</p>}
      {busy && <p role="status">Saving and checking your document…</p>}
      {!data && !error && <p role="status">Loading your space…</p>}
      {auth && <form className="card reg-form" onSubmit={(e) => { e.preventDefault(); const form = new FormData(e.currentTarget); void perform("session", { email: form.get("email"), password: form.get("password"), createWorkspace: !worker }, "Signed in."); }}><h2>Sign in to your space</h2><label>Email<input className="input" type="email" name="email" autoComplete="username" required /></label><label>Password<input className="input" type="password" name="password" autoComplete="current-password" required /></label><Button type="submit" disabled={busy} variant="primary">Sign in</Button></form>}
      {data && <>
        {data.local && <p className="reg-caution">Fictional demo: one California company and one profession. Sample documents and their analyses are simulated. They do not establish regulatory compliance.</p>}
        {!worker && <div className="reg-stats"><div className="card"><strong>{items.filter((i) => i.status === "missing" || i.status === "incomplete" || i.status === "expired").length}</strong><span>Documents to collect</span></div><div className="card"><strong>{items.filter((i) => i.status === "review").length}</strong><span>Documents to review</span></div><div className="card"><strong>{items.filter((i) => i.status === "approved").length}</strong><span>Approved by a person</span></div></div>}
        {!items.length && <section className="card"><h2>{worker ? "No requests yet" : "Set up your first record"}</h2><p>{worker ? "Your company will let you know when a document is needed." : "Set up your company and team, then review and adopt a rule in Regulatory watch."}</p>{!worker && <><a href="/regulatory/watch">Open Regulatory watch and setup</a>{data.local && <p><Button disabled={busy} onClick={() => perform("demo", {}, "Demo ready. Open Regulatory watch, then review and adopt both active fictional rules.")}>Set up fictional demo</Button></p>}</>}</section>}
        {worker ? <section><h2>To do</h2>{items.map((item) => <EvidenceCard key={item.requirementId} item={item} worker busy={busy} local={data.local} perform={perform} />)}</section> : <>
          <section><h2>Company obligations</h2>{items.filter((i) => i.requirement.subject === "agency").map((item) => <EvidenceCard key={item.requirementId} item={item} busy={busy} local={data.local} perform={perform} />)}{!items.some((i) => i.requirement.subject === "agency") && <p className="muted">No company document obligations have been adopted.</p>}</section>
          <section><h2>Team</h2><div className="reg-tabs">{data.workers.map((w) => <Button key={w.id} onClick={() => setSelected(selected === w.id ? "" : w.id)}>{w.name} · {items.filter((i) => i.caregiverId === w.id && i.status !== "approved").length} to follow up</Button>)}</div>{items.filter((i) => i.requirement.subject !== "agency" && (!selected || i.caregiverId === selected)).map((item) => <EvidenceCard key={`${item.caregiverId}:${item.requirementId}`} item={item} busy={busy} local={data.local} perform={perform} />)}</section>
        </>}
        <section><h2>{worker ? "My documents" : "Documents and history"}</h2>{!documents.length && <p className="muted">Your documents will appear here after submission.</p>}{[...documents].reverse().map((sub) => <div className="card" key={sub.id}><DocumentSummary sub={sub} worker={worker} /><p className="small muted">{new Date(sub.createdAt).toLocaleString("en-US")}{!items.some((i) => i.requirementId === sub.requirementId) ? " · Previous version retained, reassessment required" : ""}</p></div>)}</section>
      </>}
    </main>
  </>;
}
type Perform = (path: string, body: unknown, confirmation: string) => Promise<void>;
function DocumentSummary({ sub, worker }: { sub: Submission; worker?: boolean }) {
  return <><div className="card-head"><strong>{sub.files[0]?.name || "Document"}</strong><span className="tag">{sub.state === "approved" ? "Approved" : sub.state === "rejected" ? "Needs information" : "Under review"}</span></div><p><strong>AI check: </strong>{sub.extractedBy === "sample" ? "Simulated result. " : ""}{sub.analysis?.status === "not-checked" ? "Not checked. A person must read the original." : sub.analysis?.status === "ready" ? "Information found. Human review required." : sub.analysis?.nextStep || "Not checked."}</p><p><strong>Human review: </strong>{sub.reviewedAt ? `Approved on ${new Date(sub.reviewedAt).toLocaleDateString("en-US")}` : sub.state === "rejected" ? "A replacement document is needed." : "Waiting for your company."}</p>{sub.files.map((file) => <p key={file.url}><a href={file.url + (worker && typeof window !== "undefined" ? window.location.search : "")}>Download {file.name}</a></p>)}</>;
}
function EvidenceCard({ item, worker, busy, local, perform }: { item: Item; worker?: boolean; busy: boolean; local: boolean; perform: Perform }) {
  const [review, setReview] = useState(false);
  const latest = item.submissions.find((s) => s.id === (item.openSubmissionId || item.approvedSubmissionId));
  return <article className="card compliance-item"><div className="card-head"><div><div className="eyebrow">{item.name}</div><h3>{item.requirement.ask}</h3></div><span className="tag">{item.label}</span></div><p>{item.requirement.rule}</p><p className="small"><strong>Due:</strong> {item.due || "No deadline specified. Contact your company if needed."}</p>{item.reevaluationRequired && <p className="reg-caution">New rule version: new evidence must be checked. Earlier documents remain in your history.</p>}
    {!item.requirement.contractConfirmed ? worker ? <p className="reg-caution">Your company is confirming the document criteria. You can submit once they are ready.</p> : <ContractForm item={item} busy={busy} perform={perform} /> : <>
      <details><summary>Required information</summary><ul>{item.requirement.fields.map((f) => <li key={f.key}>{f.label}{f.required ? " (required)" : ""}</li>)}</ul>{item.requirement.minHours !== undefined && <p>Minimum: {item.requirement.minHours} hours.</p>}</details>
      {latest && <DocumentSummary sub={latest} worker={worker} />}
      {item.status !== "approved" && <form className="reg-form" onSubmit={(e) => { e.preventDefault(); const form = new FormData(e.currentTarget); form.set("requirementId", item.requirementId); form.set("caregiverId", item.caregiverId); void perform(worker ? "worker-submit" : "submit", form, "Document received and saved. See the result and next step above."); }}><label>Your document<input className="input" type="file" name="file" accept="image/png,image/jpeg,image/webp,application/pdf" required /></label><span className="small muted">Image or PDF, up to 4 MB. PDFs require human review.</span><Button variant="primary" type="submit" disabled={busy}>{busy ? "Sending…" : worker ? "Send my document" : "Add document"}</Button></form>}
      {!worker && item.status !== "approved" && <div className="actions"><Button disabled={busy} onClick={() => perform("review", { type: "request", requirementId: item.requirementId, caregiverId: item.caregiverId }, "Request available in the worker space.")}>Request document</Button>{latest?.state === "ready" && <Button variant="primary" disabled={busy} onClick={() => setReview(!review)}>Review document</Button>}</div>}
      {!worker && review && latest?.state === "ready" && <form className="reg-form compliance-review" onSubmit={(e) => { e.preventDefault(); const form = new FormData(e.currentTarget); const values = Object.fromEntries(item.requirement.fields.map((f) => [f.key, String(form.get(f.key) || "")])); void perform("review", { type: "approve", submissionId: latest.id, attest: true, values }, "Human approval saved. The worker sees the same status."); }}><h4>Human review</h4><p>Download the original document, check its type and every field, and correct any values as needed.</p>{item.requirement.fields.map((spec) => {
        const field = latest.fields.find((value) => value.key === spec.key);
        return <ExtractedField key={`${latest.id}:${spec.key}`} label={spec.label} value={field?.value} source={field?.source} confidence={field?.confidence} verifiedBy={field?.verifiedBy} missing={!field?.value && (latest.extractedBy === "none" ? "Not entered yet" : true)}>
          <label>{spec.label}<input className="input" name={spec.key} type={spec.kind === "date" ? "date" : spec.kind === "number" ? "number" : "text"} step={spec.kind === "number" ? "any" : undefined} required={spec.required} defaultValue={field?.value || ""} /></label>
        </ExtractedField>;
      })}<label><input type="checkbox" required /> I read the original document and confirmed the criteria and every field for this requirement.</label><div className="actions"><Button variant="primary" type="submit" disabled={busy}>Approve</Button><Button disabled={busy} onClick={() => perform("review", { type: "reject", submissionId: latest.id }, "More information needed. The worker can send a replacement.")}>Request replacement</Button></div></form>}
      {local && item.status !== "approved" && <details className="compliance-fixtures"><summary>Fictional examples for the presentation</summary><p>No AI call: these documents and results are explicitly simulated.</p><div className="actions">{([ ["incomplete", "Incomplete document"], ["complete", "Complete document"], ["expired", "Expired document"], ["unavailable", "Analysis unavailable"] ] as const).map(([fixture, label]) => <Button size="sm" key={fixture} disabled={busy} onClick={() => perform(worker ? "worker-demo-evidence" : "demo-evidence", { requirementId: item.requirementId, caregiverId: item.caregiverId, fixture }, "Fictional example saved. No real AI analysis was performed.")}>{label}</Button>)}</div></details>}
    </>}
  </article>;
}
function ContractForm({ item, busy, perform }: { item: Item; busy: boolean; perform: Perform }) {
  return <details open><summary>Setup needed: confirm document criteria</summary><form className="reg-form" onSubmit={(e) => { e.preventDefault(); const form = new FormData(e.currentTarget); const fields = [{ key: "name", label: "Name on document", kind: "text", required: true }, ...(form.get("hours") ? [{ key: "hours", label: "Training hours", kind: "number", required: true }] : []), ...(form.get("expiry") ? [{ key: "expiration_date", label: "Expiration date", kind: "date", required: true }] : [])]; void perform("review", { type: "contract", requirementId: item.requirementId, ask: form.get("ask"), fields, minHours: form.get("hours") ? Number(form.get("hours")) : undefined, expirationField: form.get("expiry") ? "expiration_date" : undefined }, "Criteria confirmed. The document can now be submitted."); }}><label>Which document is needed?<input className="input" name="ask" required minLength={3} placeholder="E.g. training certificate" /></label><label>Minimum hours, only if confirmed in the adopted rule<input className="input" name="hours" type="number" min="0" step="any" /></label><label><input type="checkbox" name="expiry" /> The document must show an expiration date</label><label><input type="checkbox" required /> I confirmed these criteria against the adopted rule.</label><Button type="submit" variant="primary" disabled={busy}>Confirm criteria</Button></form></details>;
}
