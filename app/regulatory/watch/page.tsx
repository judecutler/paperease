"use client";
import { useEffect, useState } from "react";
import { RegulatoryNotifications } from "@/components/RegulatoryNotifications";
import { Shell } from "@/components/Shell";
import { Button } from "@/components/ui";
import { jurisdictions } from "@/lib/regulatory/jurisdictions";
import {
  Services,
  Roles,
  Topics,
  type Profile,
  type Worker,
} from "@/lib/regulatory/types";
import type { state } from "@/lib/regulatory/service";
import "../regulatory.css";
type Data = Awaited<ReturnType<typeof state>>;
async function api(path: string, body?: unknown, method?: string) {
  const res = await fetch(`/api/regulatory/${path}`, {
    method: method || (body ? "POST" : "GET"),
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed.");
  return data;
}
const label = (s: string) => s.replaceAll("-", " ");
const date = (s?: string | null) =>
  s ? new Date(s).toLocaleString() : "Not established";
export default function RegulatoryPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [auth, setAuth] = useState(false);
  const [tab, setTab] = useState("changes");
  const [filter, setFilter] = useState("ALL");
  const [message, setMessage] = useState("");
  async function refresh() {
    try {
      setData(await api("state"));
      setAuth(false);
      setError("");
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      if (/Sign in|Session expired|No regulatory workspace/.test(msg))
        setAuth(true);
    }
  }
  useEffect(() => {
    void refresh();
    const requestedTab = new URLSearchParams(window.location.search).get("tab");
    if (requestedTab && ["changes", "sources", "coverage", "notifications", "onboarding", "operations"].includes(requestedTab)) setTab(requestedTab);
    if (requestedTab === "checklist") window.location.replace("/regulatory");
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 10000);
    return () => clearInterval(timer);
  }, []);
  async function act(body: unknown) {
    setBusy(true);
    setError("");
    try {
      await api("actions", body);
      await refresh();
      setMessage((body as { type?: string }).type === "scan" ? "Source check queued. Open Activity to follow progress." : "Saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return (
      <Shell>
        <p><a href="/regulatory">Company home</a></p>
      <div className="page-head">
          <div>
            <div className="eyebrow">PaperEase</div>
            <h1>Regulatory watch</h1>
            <p>Review changes that affect your company.</p>
          </div>
        </div>
        {error && (
          <p role="alert" className="reg-error">
            {error}
          </p>
        )}
        {auth && <Login onDone={refresh} />}
        {!auth && error && <Button onClick={refresh}>Try again</Button>}
        {!auth && !error && <p>Loading workspace…</p>}
      </Shell>
    );
  const filtered = data.sources.filter(
    (s) => filter === "ALL" || s.jurisdiction === filter,
  );
  const today = new Date().toISOString().slice(0, 10);
  const allRules = data.candidates.filter((r) => filter === "ALL" || r.jurisdiction === filter);
  const isArchived = (r: Data["candidates"][number]) => Boolean(
    (r.effectiveTo && r.effectiveTo <= today) || data.agency.adopted.some((id) => data.candidates.find((next) => next.id === id)?.previousId === r.id),
  );
  const rules = allRules.filter((r) => !isArchived(r)).sort((a, b) => Number(data.agency.adopted.includes(a.id)) - Number(data.agency.adopted.includes(b.id)));
  const archivedRules = allRules.filter(isArchived);
  const reviewCount = rules.filter((r) => !data.agency.adopted.includes(r.id) && !data.agency.reviews.some((review) => review.ruleId === r.id && review.decision === "rejected")).length;
  const pending = data.jobs.filter((j) => ["queued", "running"].includes(j.state)).length;
  return (
    <Shell error={error || undefined} onDismiss={() => setError("")}>
      <div className="reg-watch">
      <div className="page-head reg-watch-head">
        <div>
          <div className="eyebrow">{data.agency.profile.name}</div>
          <h1>Regulatory watch</h1>
          <p className="muted">Review changes. Adopt the rules that apply.</p>
        </div>
        <Button variant="primary" disabled={busy} onClick={async () => {
          await act({ type: "scan" });
        }}>Check sources</Button>
      </div>
      <div className="reg-watch-summary" aria-label="Watch summary">
        <span><strong>{reviewCount}</strong> to review</span>
        <span><strong>{rules.filter((r) => data.agency.adopted.includes(r.id)).length}</strong> adopted</span>
        <span><strong>{filtered.filter((source) => source.approved && source.lastSuccess && !source.error).length}</strong> collected {filtered.filter((source) => source.approved && source.lastSuccess && !source.error).length === 1 ? "source" : "sources"}</span>
        {pending > 0 && <span>{pending} checks queued or running</span>}
      </div>
      <div className="reg-watch-toolbar">
        <div className="reg-tabs" role="tablist" aria-label="Regulatory watch">
          {[["changes", "Changes"], ["sources", "Sources"], ["coverage", "Coverage"]].map(([key, title]) => (
            <button key={key} role="tab" aria-selected={tab === key} onClick={() => { setTab(key); setMessage(""); }}>{title}{key === "changes" && reviewCount > 0 && <span className="reg-tab-count">{reviewCount}</span>}</button>
          ))}
        </div>
        <div className="reg-watch-filters">
          <label className="sr-only" htmlFor="watch-jurisdiction">Jurisdiction</label>
          <select id="watch-jurisdiction" className="input" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="ALL">All jurisdictions</option><option value="US">Federal</option>
            {jurisdictions.map((j) => <option key={j.code} value={j.code}>{j.name}</option>)}
          </select>
          <label className="sr-only" htmlFor="watch-more">More views</label>
          <select id="watch-more" className="input" value={["notifications", "onboarding", "operations"].includes(tab) ? tab : ""} onChange={(e) => { if (e.target.value) { setTab(e.target.value); setMessage(""); } }}>
            <option value="">More</option><option value="notifications">Alerts{data.agency.notices.some((n) => !n.read) ? ` (${data.agency.notices.filter((n) => !n.read).length} new)` : ""}</option><option value="onboarding">Company setup</option><option value="operations">Activity & demo</option>
          </select>
        </div>
      </div>
      <p className="small muted reg-watch-note">{data.local ? "Fictional demo. Policies and examples are simulated." : "Source monitoring supports review; it does not certify compliance."}</p>
      {message && <p role="status">{message}</p>}
      {tab === "notifications" && (
        <RegulatoryNotifications
          agency={data.agency}
          busy={busy}
          act={act}
          openChanges={() => setTab("changes")}
        />
      )}
      {tab === "coverage" && (
        <section className="card">
          <div className="card-head">
            <h3>Source coverage</h3>
          </div>
          <div className="reg-state-grid">
            {data.coverage
              .filter((c) => filter === "ALL" || c.code === filter)
              .map((c) => (
                <button
                  className={`reg-state reg-${c.status}`}
                  key={c.code}
                  onClick={() => {
                    setFilter(c.code);
                    setTab("sources");
                  }}
                >
                  <strong>
                    {c.code} · {c.name}
                  </strong>
                  <span>{label(c.status)}</span>
                  <small>
                    {c.enabled}/{c.sources} sources enabled · {c.legalCoverage}
                  </small>
                </button>
              ))}
          </div>
          <p className="muted small">
            Review each source before enabling it. Discovery pages help locate rules; they are not obligations.
          </p>
        </section>
      )}
      {tab === "sources" && (
        <>
          <section className="card">
            <h3>Sources</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Type / topic</th>
                    <th>Last success</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <a href={s.url} target="_blank" rel="noreferrer">
                          {s.title}
                        </a>
                        <div className="small muted">
                          {s.jurisdiction} · {s.authority}
                        </div>
                      </td>
                      <td>
                        {s.kind}
                        <br />
                        <span className="small">{label(s.topic)}</span>
                      </td>
                      <td className="small">{date(s.lastSuccess)}</td>
                      <td>
                        {s.error ? (
                          <span className="reg-error">{s.error}</span>
                        ) : s.approved ? (
                          "Enabled"
                        ) : (
                          "Needs source review"
                        )}
                      </td>
                      <td>
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            act({
                              type: "source-approve",
                              id: s.id,
                              approved: !s.approved,
                            })
                          }
                        >
                          {s.approved ? "Disable" : "Verify & enable"}
                        </Button>
                        {s.snapshotId && (
                          <Discovery id={s.snapshotId} source={s} act={act} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <details className="reg-add-source"><summary>Add a source</summary><SourceForm act={act} busy={busy} /></details>
        </>
      )}
      {tab === "changes" && (
        <section className="stack">
          <h2>{reviewCount ? "Changes to review" : "Current rules"}</h2>
          {!rules.length && <div className="card"><h3>No rules yet</h3><p className="muted">Add a source to start tracking changes.</p><Button onClick={() => setTab("sources")}>Manage sources</Button></div>}
          {rules.map((rule) => {
            const review = data.agency.reviews.find((r) => r.ruleId === rule.id);
            const adopted = data.agency.adopted.includes(rule.id);
            return <article className="card reg-rule-card" key={rule.id}>
              <div className="card-head"><div><div className="eyebrow">{rule.jurisdiction} · {label(rule.topic)}{rule.demo ? " · Demo policy" : ""}</div><h3>{rule.title.replace(/^Demo: /, "").replace(/^./, (letter) => letter.toUpperCase())}</h3></div><span className={`tag ${adopted ? "reg-adopted" : ""}`}>{adopted ? "Adopted" : review?.decision === "approved" ? "Ready to adopt" : review?.decision === "rejected" ? "Rejected" : "Needs review"}</span></div>
              <p className="reg-rule-obligation">{rule.demo ? rule.obligation.replace(/^SIMULATED COMPANY POLICY: /, "").replace(/ This is (a simulated company policy, not a verified legal requirement|not a verified law)\./, "") : rule.obligation}</p>
              <div className="reg-rule-meta"><span>Effective {rule.effectiveFrom || "date unknown"}</span>{rule.deadline && <span>Due {rule.deadline}</span>}<span>{rule.impact.filter((i) => i.result === "applicable").length} {rule.subject === "agency" ? "company" : rule.impact.filter((i) => i.result === "applicable").length === 1 ? "worker" : "workers"} affected</span></div>
              {rule.unresolved.length > 0 && <p className="reg-error">Review needed: {rule.unresolved.join("; ")}</p>}
              <details className="reg-rule-details"><summary>Source & applicability</summary><p className="small muted">{rule.citation}</p><blockquote>{rule.quote}</blockquote><p className="small">Exceptions: {rule.exceptions || "Not specified. Check the source."}</p><div className="reg-impact">{rule.impact.map((i) => <p key={i.id}><strong>{i.name}: {label(i.result)}</strong><br /><span className="small muted">{i.reasons.join(" ")}</span></p>)}</div><Evidence id={rule.snapshotId} />{rule.previousId && <details><summary>Previous version</summary><p>{data.candidates.find((r) => r.id === rule.previousId)?.obligation || "Unavailable"}</p></details>}</details>
              <Review rule={rule} busy={busy} act={act} adopted={adopted} reviewed={review?.decision === "approved"} />
            </article>;
          })}
          {archivedRules.length > 0 && <details className="reg-archive"><summary>Previous versions ({archivedRules.length})</summary>{archivedRules.map((rule) => <article className="card" key={rule.id}><h3>{rule.title.replace(/^Demo: /, "").replace(/^./, (letter) => letter.toUpperCase())}</h3><p className="small muted">Archived{rule.effectiveTo ? ` · Ended ${rule.effectiveTo}` : ""}</p><p>{rule.obligation}</p><details><summary>Source</summary><Evidence id={rule.snapshotId} /></details></article>)}</details>}
        </section>
      )}
      {tab === "onboarding" && (
        <Onboarding
          profile={data.agency.profile}
          workers={data.agency.workers}
          act={act}
          busy={busy}
        />
      )}
      {tab === "operations" && (
        <>
          <section className="card reg-utilities"><h3>Activity</h3><p className="muted small">Source checks run in stages. A queued check may need more than one step.</p><div className="actions"><Button disabled={busy} onClick={async () => { setBusy(true); try { await api("process", {}); await refresh(); setMessage("Check advanced. See progress below."); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>Continue check</Button>{data.local && <Button disabled={busy} onClick={async () => { setBusy(true); try { await api("demo", {}); await refresh(); setTab("changes"); setMessage("Demo ready. Review the two active policies."); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>Reset demo</Button>}{!data.local && <Button onClick={async () => { await api("session", undefined, "DELETE"); setData(null); setAuth(true); }}>Sign out</Button>}</div></section>
          <section className="card">
            <h3>Source activity</h3>
            <p>Last worker tick: {date(data.scheduler.lastTick)}</p>
            <p>
              {data.usage.day || "No AI usage"} · {data.usage.calls}/
              {data.limits.calls} daily calls · {data.usage.tokens}/
              {data.limits.tokens} tokens reserved or consumed
            </p>
            <Button onClick={refresh}>Refresh status</Button>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Stage</th>
                    <th>Attempts</th>
                    <th>Next attempt / error</th>
                  </tr>
                </thead>
                <tbody>
                  {data.jobs.map((j) => (
                    <tr key={j.id}>
                      <td>
                        {data.sources.find((s) => s.id === j.sourceId)?.title}
                      </td>
                      <td>{j.state}</td>
                      <td>{j.attempts}</td>
                      <td className="small">
                        {date(j.availableAt)}
                        <br />
                        {j.error}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="card">
            <h3>Workspace audit</h3>
            {[...data.agency.audit]
              .reverse()
              .slice(0, 100)
              .map((a, i) => (
                <p key={i} className="small">
                  <strong>{date(a.at)}</strong> · {a.action}
                </p>
              ))}
          </section>
        </>
      )}
      </div>
    </Shell>
  );
}
function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [create, setCreate] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="card reg-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await api("session", { email, password, createWorkspace: create });
          setPassword("");
          onDone();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Sign in</h3>
      <p>
        Use an existing application user from Supabase Authentication. Your
        Supabase dashboard login is a separate account.
      </p>
      <label>
        Email
        <input
          className="input"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label>
        Password
        <input
          className="input"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={create}
          onChange={(e) => setCreate(e.target.checked)}
        />{" "}
        Create my private regulatory workspace if needed
      </label>
      {error && <p role="alert">{error}</p>}
      <Button type="submit" disabled={busy}>
        Sign in
      </Button>
    </form>
  );
}
function Review({
  rule,
  adopted,
  reviewed,
  busy,
  act,
}: {
  rule: Data["candidates"][number];
  adopted: boolean;
  reviewed: boolean;
  busy: boolean;
  act: (b: unknown) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [checked, setChecked] = useState(false);
  const blocked =
    !rule.evidenceValid ||
    !rule.scopeComplete ||
    rule.unresolved.length > 0 ||
    !rule.effectiveFrom ||
    rule.legalStatus !== "enacted";
  if (adopted) return <div className="reg-rule-footer"><span className="small muted">Requirements are available in Company.</span><a href="/regulatory">View requirements</a></div>;
  const expired = Boolean(rule.effectiveTo && rule.effectiveTo <= new Date().toISOString().slice(0, 10));
  const applicableNow = rule.impact.some((i) => i.result === "applicable") && !rule.impact.some((i) => i.result === "needs-review");
  if (reviewed) return <div className="reg-rule-footer"><span className="small muted">{applicableNow ? "Review complete. Create the applicable requirements." : "Confirm dates and assignments before adoption."}</span><Button variant="primary" disabled={busy || blocked || expired || !applicableNow} onClick={() => act({ type: "adopt", ruleId: rule.id, fingerprint: rule.fingerprint })}>Adopt rule</Button></div>;
  return <details className="reg-review-disclosure"><summary>Review rule</summary><div className="reg-review">
    {blocked && <p className="reg-error">Resolve the source, dates or scope before approval.</p>}
    <label>Review notes<textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Summarize your review (at least 10 characters)." /></label>
    <label><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />I checked the source, dates, scope and exceptions.</label>
    <div className="actions"><Button variant="primary" disabled={busy || blocked || !checked || note.trim().length < 10 || expired} onClick={() => act({ type: "review", ruleId: rule.id, decision: "approved", note })}>Approve review</Button><Button variant="quiet" disabled={busy || note.trim().length < 10} onClick={() => act({ type: "review", ruleId: rule.id, decision: "rejected", note })}>Reject</Button></div>
  </div></details>;
}

function Evidence({ id }: { id: string }) {
  const [text, setText] = useState("");
  return (
    <div>
      <Button
        size="sm"
        onClick={async () => {
          try {
            const s = await api(`evidence/${encodeURIComponent(id)}`);
            setText(
              s.sections
                .map(
                  (p: { label: string; text: string }) =>
                    `${p.label}\n${p.text}`,
                )
                .join("\n\n"),
            );
          } catch (e) {
            setText((e as Error).message);
          }
        }}
      >
        Load captured source text
      </Button>
      {text && <pre className="reg-evidence">{text}</pre>}
    </div>
  );
}
function Discovery({
  id,
  source,
  act,
}: {
  id: string;
  source: Data["sources"][number];
  act: (b: unknown) => Promise<void>;
}) {
  const [links, setLinks] = useState<{ title: string; url: string }[]>([]);
  const [err, setErr] = useState("");
  return (
    <details>
      <summary
        onClick={async () => {
          try {
            const s = await api(`evidence/${encodeURIComponent(id)}`);
            setLinks(s.links);
          } catch (e) {
            setErr((e as Error).message);
          }
        }}
      >
        Discovered links
      </summary>
      {err}
      {links.map((l) => (
        <p key={l.url} className="small">
          <a href={l.url} target="_blank" rel="noreferrer">
            {l.title}
          </a>{" "}
          <Button
            size="sm"
            onClick={() =>
              act({
                type: "source-add",
                source: {
                  jurisdiction: source.jurisdiction,
                  title: l.title,
                  url: l.url,
                  authority: source.authority,
                  kind: "regulation",
                  topic: source.topic,
                  intervalHours: 24,
                },
              })
            }
          >
            Register for review
          </Button>
        </p>
      ))}
    </details>
  );
}
function SourceForm({
  act,
  busy,
}: {
  act: (b: unknown) => Promise<void>;
  busy: boolean;
}) {
  return (
    <form
      className="card reg-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        await act({
          type: "source-add",
          source: {
            jurisdiction: f.get("jurisdiction"),
            title: f.get("title"),
            url: f.get("url"),
            authority: f.get("authority"),
            kind: f.get("kind"),
            topic: f.get("topic"),
            intervalHours: Number(f.get("intervalHours")),
          },
        });
      }}
    >
      <h3>Register an official source</h3>
      <label>
        Jurisdiction
        <select className="input" name="jurisdiction">
          <option value="US">Federal</option>
          {jurisdictions.map((j) => (
            <option key={j.code} value={j.code}>
              {j.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Title
        <input className="input" name="title" minLength={3} required />
      </label>
      <label>
        Issuing authority
        <input className="input" name="authority" minLength={3} required />
      </label>
      <label>
        Official HTTPS URL
        <input className="input" type="url" name="url" required />
      </label>
      <label>
        Source type
        <select className="input" name="kind">
          {["law", "regulation", "guidance", "discovery"].map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </label>
      <label>
        Topic
        <select className="input" name="topic">
          {Topics.map((k) => (
            <option key={k} value={k}>
              {label(k)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Check interval (hours)
        <input
          className="input"
          type="number"
          name="intervalHours"
          min={6}
          max={720}
          defaultValue={24}
        />
      </label>
      <Button type="submit" disabled={busy}>
        Register source for verification
      </Button>
    </form>
  );
}
function States({
  value,
  onChange,
  label: caption,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  label: string;
}) {
  return (
    <label>
      {caption}
      <select
        className="input reg-multiselect"
        multiple
        value={value}
        onChange={(e) =>
          onChange(Array.from(e.target.selectedOptions, (o) => o.value))
        }
      >
        {jurisdictions.map((j) => (
          <option key={j.code} value={j.code}>
            {j.name}
          </option>
        ))}
      </select>
      <small className="muted">
        Use Command/Ctrl to select multiple states.
      </small>
    </label>
  );
}
function Onboarding({
  profile,
  workers,
  act,
  busy,
}: {
  profile: Profile;
  workers: Worker[];
  act: (b: unknown) => Promise<void>;
  busy: boolean;
}) {
  const [p, setP] = useState(profile);
  const [w, setW] = useState<Worker>({
    id: "",
    name: "",
    role: "home-care-aide",
    residence: "CA",
    serviceState: "CA",
    locality: "",
    service: "nonmedical",
    licenseStates: [],
    licenseExpires: "",
  });
  return (
    <div className="grid-2">
      <form
        className="card reg-form"
        onSubmit={(e) => {
          e.preventDefault();
          void act({ type: "profile", profile: p });
        }}
      >
        <h3>Organization and services</h3>
        <label>
          Agency name
          <input
            className="input"
            required
            value={p.name}
            onChange={(e) => setP({ ...p, name: e.target.value })}
          />
        </label>
        <label>
          Ownership
          <select
            className="input"
            value={p.ownership}
            onChange={(e) =>
              setP({ ...p, ownership: e.target.value as Profile["ownership"] })
            }
          >
            {["unknown", "for-profit", "nonprofit", "public"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Headquarters
          <select
            className="input"
            value={p.headquarters}
            onChange={(e) => setP({ ...p, headquarters: e.target.value })}
          >
            <option value="">Not established</option>
            {jurisdictions.map((j) => (
              <option key={j.code} value={j.code}>
                {j.name}
              </option>
            ))}
          </select>
        </label>
        <States
          label="States where services are delivered"
          value={p.operatingStates}
          onChange={(v) => setP({ ...p, operatingStates: v })}
        />
        <fieldset>
          <legend>Service tracks</legend>
          {Services.map((s) => (
            <label key={s}>
              <input
                type="checkbox"
                checked={p.services.includes(s)}
                onChange={(e) =>
                  setP({
                    ...p,
                    services: e.target.checked
                      ? [...p.services, s]
                      : p.services.filter((x) => x !== s),
                  })
                }
              />
              {label(s)}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Payer participation</legend>
          {(["private", "medicare", "medicaid"] as const).map((s) => (
            <label key={s}>
              <input
                type="checkbox"
                checked={p.payers.includes(s)}
                onChange={(e) =>
                  setP({
                    ...p,
                    payers: e.target.checked
                      ? [...p.payers, s]
                      : p.payers.filter((x) => x !== s),
                  })
                }
              />
              {s}
            </label>
          ))}
        </fieldset>
        <label>
          Agency license type and issuer
          <input
            className="input"
            value={p.agencyLicense}
            onChange={(e) => setP({ ...p, agencyLicense: e.target.value })}
          />
        </label>
        <label>
          Specific programs (one per line)
          <textarea
            className="input"
            value={p.programs.join("\n")}
            onChange={(e) =>
              setP({
                ...p,
                programs: e.target.value.split("\n").filter(Boolean),
              })
            }
          />
        </label>
        <Button type="submit" disabled={busy}>
          Save agency profile
        </Button>
      </form>
      <form
        className="card reg-form"
        onSubmit={(e) => {
          e.preventDefault();
          void act({
            type: "worker",
            worker: { ...w, id: w.id || crypto.randomUUID() },
          });
        }}
      >
        <h3>Worker and service assignment</h3>
        {workers.length > 0 && (
          <label>
            Edit worker
            <select
              className="input"
              value={w.id}
              onChange={(e) => {
                const found = workers.find((w) => w.id === e.target.value);
                if (found) setW(found);
              }}
            >
              <option value="">New worker</option>
              {workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Name
          <input
            className="input"
            required
            value={w.name}
            onChange={(e) => setW({ ...w, name: e.target.value })}
          />
        </label>
        <label>
          Role
          <select
            className="input"
            value={w.role}
            onChange={(e) =>
              setW({ ...w, role: e.target.value as Worker["role"] })
            }
          >
            {Roles.map((r) => (
              <option key={r} value={r}>
                {label(r)}
              </option>
            ))}
          </select>
        </label>
        {(["residence", "serviceState"] as const).map((k) => (
          <label key={k}>
            {k === "residence"
              ? "Primary residence"
              : "Patient / service state"}
            <select
              className="input"
              value={w[k]}
              onChange={(e) => setW({ ...w, [k]: e.target.value })}
            >
              {jurisdictions.map((j) => (
                <option key={j.code} value={j.code}>
                  {j.name}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label>
          Service track
          <select
            className="input"
            value={w.service}
            onChange={(e) =>
              setW({ ...w, service: e.target.value as Worker["service"] })
            }
          >
            {Services.map((r) => (
              <option key={r} value={r}>
                {label(r)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Service locality, when relevant
          <input
            className="input"
            value={w.locality}
            onChange={(e) => setW({ ...w, locality: e.target.value })}
          />
        </label>
        <States
          label="Verified license / privilege states"
          value={w.licenseStates}
          onChange={(v) => setW({ ...w, licenseStates: v })}
        />
        <label>
          License expiry
          <input
            className="input"
            type="date"
            value={w.licenseExpires}
            onChange={(e) => setW({ ...w, licenseExpires: e.target.value })}
          />
        </label>
        <p className="small muted">
          These fields record staff-verified information. No live
          license-registry verification or automatic compact privilege is
          claimed.
        </p>
        <Button type="submit" disabled={busy}>
          Save worker assignment
        </Button>
      </form>
    </div>
  );
}
