"use client";
import { useEffect, useState } from "react";
import { Button } from "./ui";
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
/** The worker's private space: what was requested, the evidence to submit, and the history of documents sent. */
export function WorkerSpace() {
  const [data, setData] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [auth, setAuth] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function refresh() {
    try { setData(await api("worker-compliance")); setAuth(false); setError(""); }
    catch (e) { const text = (e as Error).message; setError(text); setAuth(/Sign in|Session expired|No regulatory workspace/.test(text)); }
  }
  useEffect(() => { void refresh(); const interval = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 10000); return () => clearInterval(interval); }, []);
  async function perform(path: string, body: unknown, confirmation: string) {
    setBusy(true); setError(""); setMessage("");
    try { await api(path, body); await refresh(); setMessage(confirmation); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const items = data?.items || [];
  const documents = [...items.flatMap((i) => i.submissions), ...(data?.history || [])];
  return <>
    <header className="topbar"><div className="topbar-inner"><a className="brand" href="/regulatory/watch"><BrandMark /><BrandName /></a><nav className="nav"><a href="/regulatory/watch">Regulatory watch</a><a href="/regulatory/worker" className="active">Worker home</a></nav></div></header>
    <main className="page compliance-page">
      <div className="page-head"><div><div className="eyebrow">Worker</div><h1>{data ? `Hello ${data.name.split(" ")[0]}` : "Your requests"}</h1><p className="muted">Submit your documents and follow their progress here.</p></div><Button disabled={busy || !data} onClick={refresh}>Refresh</Button></div>
      {error && <div className="reg-caution" role="alert">{error} <Button disabled={busy} onClick={refresh}>Try again</Button></div>}
      {message && <p className="reg-caution" role="status">{message}</p>}
      {busy && <p role="status">Saving and checking your document…</p>}
      {!data && !error && <p role="status">Loading your space…</p>}
      {auth && <form className="card reg-form" onSubmit={(e) => { e.preventDefault(); const form = new FormData(e.currentTarget); void perform("session", { email: form.get("email"), password: form.get("password"), createWorkspace: false }, "Signed in."); }}><h2>Sign in to your space</h2><label>Email<input className="input" type="email" name="email" autoComplete="username" required /></label><label>Password<input className="input" type="password" name="password" autoComplete="current-password" required /></label><Button type="submit" disabled={busy} variant="primary">Sign in</Button></form>}
      {data && <>
        {data.local && <p className="reg-caution">Fictional demo: one California company and one profession. Sample documents and their analyses are simulated. They do not establish regulatory compliance.</p>}
        {!items.length && <section className="card"><h2>No requests yet</h2><p>Your company will let you know when a document is needed. Adopted obligations appear here after review in Regulatory watch.</p><a href="/regulatory/watch">Open Regulatory watch</a></section>}
        <section><h2>To do</h2>{items.map((item) => <EvidenceCard key={item.requirementId} item={item} busy={busy} local={data.local} perform={perform} />)}{!items.length && <p className="muted">Nothing is requested from you right now.</p>}</section>
        <section><h2>My documents</h2>{!documents.length && <p className="muted">Your documents will appear here after submission.</p>}{[...documents].reverse().map((sub) => <div className="card" key={sub.id}><DocumentSummary sub={sub} /><p className="small muted">{new Date(sub.createdAt).toLocaleString("en-US")}{!items.some((i) => i.requirementId === sub.requirementId) ? " · Previous version retained, reassessment required" : ""}</p></div>)}</section>
      </>}
    </main>
  </>;
}
type Perform = (path: string, body: unknown, confirmation: string) => Promise<void>;
function DocumentSummary({ sub }: { sub: Submission }) {
  return <><div className="card-head"><strong>{sub.files[0]?.name || "Document"}</strong><span className="tag">{sub.state === "approved" ? "Approved" : sub.state === "rejected" ? "Needs information" : "Under review"}</span></div><p><strong>AI check: </strong>{sub.extractedBy === "sample" ? "Simulated result. " : ""}{sub.analysis?.status === "not-checked" ? "Not checked. A person must read the original." : sub.analysis?.status === "ready" ? "Information found. Human review required." : sub.analysis?.nextStep || "Not checked."}</p><p><strong>Human review: </strong>{sub.reviewedAt ? `Approved on ${new Date(sub.reviewedAt).toLocaleDateString("en-US")}` : sub.state === "rejected" ? "A replacement document is needed." : "Waiting for your company."}</p>{sub.files.map((file) => <p key={file.url}><a href={file.url + (typeof window !== "undefined" ? window.location.search : "")}>Download {file.name}</a></p>)}</>;
}
function EvidenceCard({ item, busy, local, perform }: { item: Item; busy: boolean; local: boolean; perform: Perform }) {
  const latest = item.submissions.find((s) => s.id === (item.openSubmissionId || item.approvedSubmissionId));
  return <article className="card compliance-item"><div className="card-head"><div><div className="eyebrow">{item.name}</div><h3>{item.requirement.ask}</h3></div><span className="tag">{item.label}</span></div><p>{item.requirement.rule}</p><p className="small"><strong>Due:</strong> {item.due || "No deadline specified. Contact your company if needed."}</p>{item.reevaluationRequired && <p className="reg-caution">New rule version: new evidence must be checked. Earlier documents remain in your history.</p>}
    {!item.requirement.contractConfirmed ? <p className="reg-caution">Your company is confirming the document criteria. You can submit once they are ready.</p> : <>
      <details><summary>Required information</summary><ul>{item.requirement.fields.map((f) => <li key={f.key}>{f.label}{f.required ? " (required)" : ""}</li>)}</ul>{item.requirement.minHours !== undefined && <p>Minimum: {item.requirement.minHours} hours.</p>}</details>
      {latest && <DocumentSummary sub={latest} />}
      {item.status !== "approved" && <form className="reg-form" onSubmit={(e) => { e.preventDefault(); const form = new FormData(e.currentTarget); form.set("requirementId", item.requirementId); form.set("caregiverId", item.caregiverId); void perform("worker-submit", form, "Document received and saved. See the result and next step above."); }}><label>Your document<input className="input" type="file" name="file" accept="image/png,image/jpeg,image/webp,application/pdf" required /></label><span className="small muted">Image or PDF, up to 4 MB. PDFs require human review.</span><Button variant="primary" type="submit" disabled={busy}>{busy ? "Sending…" : "Send my document"}</Button></form>}
      {local && item.status !== "approved" && <details className="compliance-fixtures"><summary>Fictional examples for the presentation</summary><p>No AI call: these documents and results are explicitly simulated.</p><div className="actions">{([ ["incomplete", "Incomplete document"], ["complete", "Complete document"], ["expired", "Expired document"], ["unavailable", "Analysis unavailable"] ] as const).map(([fixture, label]) => <Button size="sm" key={fixture} disabled={busy} onClick={() => perform("worker-demo-evidence", { requirementId: item.requirementId, caregiverId: item.caregiverId, fixture }, "Fictional example saved. No real AI analysis was performed.")}>{label}</Button>)}</div></details>}
    </>}
  </article>;
}