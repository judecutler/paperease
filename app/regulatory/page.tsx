"use client";
import { useEffect, useState } from "react";
import { RegulatoryNotifications } from "@/components/RegulatoryNotifications";
import { Shell } from "@/components/Shell";
import { Button, StatusBadge } from "@/components/ui";
import { jurisdictions } from "@/lib/regulatory/jurisdictions";
import {
  Services,
  Roles,
  Topics,
  type Profile,
  type Worker,
} from "@/lib/regulatory/types";
import type { state } from "@/lib/regulatory/service";
import type { Payload } from "@/lib/payload";
import "./regulatory.css";
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
  const [tab, setTab] = useState("coverage");
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
    if (
      new URLSearchParams(window.location.search).get("tab") === "notifications"
    )
      setTab("notifications");
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
      setMessage("Saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return (
      <Shell>
        <div className="page-head">
          <div>
            <div className="eyebrow">CareLoop</div>
            <h1>Regulatory watch</h1>
            <p>Official sources. Cited changes. Reviewed obligations.</p>
          </div>
        </div>
        {error && (
          <p role="alert" className="reg-error">
            {error}
          </p>
        )}
        {auth && <Login onDone={refresh} />}
        <p className="muted">
          This workspace is separate from the original California demonstration.
          Existing records are preserved.
        </p>
        {!auth && !error && <p>Loading workspace…</p>}
      </Shell>
    );
  const filtered = data.sources.filter(
    (s) => filter === "ALL" || s.jurisdiction === filter,
  );
  const rules = data.candidates.filter(
    (r) => filter === "ALL" || r.jurisdiction === filter,
  );
  const pending = data.jobs.filter((j) =>
    ["queued", "running"].includes(j.state),
  ).length;
  return (
    <Shell error={error || undefined} onDismiss={() => setError("")}>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            {data.agency.profile.name} ·{" "}
            {data.local ? "Isolated local demo" : "Private workspace"}
          </div>
          <h1>Regulatory watch</h1>
          <p className="muted">
            50 states, federal overlays and DC. Coverage is tracked separately
            from legal review.
          </p>
        </div>
        <div className="actions">
          {data.local && (
            <Button
              variant="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api("demo", {});
                  await refresh();
                  setTab("changes");
                  setMessage(
                    "Guided demo ready: review the simulated change, approve it, then adopt it.",
                  );
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Reset guided demo
            </Button>
          )}
          <Button disabled={busy} onClick={() => act({ type: "scan" })}>
            Queue due sources
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const result = await api("process", {});
                setMessage(`Worker stage: ${result.state || "idle"}`);
                await refresh();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Process next stage
          </Button>
          {!data.local && (
            <Button
              onClick={async () => {
                await api("session", undefined, "DELETE");
                setData(null);
                setAuth(true);
              }}
            >
              Sign out
            </Button>
          )}
        </div>
      </div>
      {data.agency.notices.some((n) => !n.read) && (
        <section
          className="reg-alert-banner"
          role="alert"
          aria-label="Unread regulation alerts"
        >
          <div>
            <span className="reg-alert-icon" aria-hidden="true">
              !
            </span>
            <div>
              <strong>
                {data.agency.notices.filter((n) => !n.read).length} regulation
                alert(s) need your attention
              </strong>
              <p>
                {[...data.agency.notices].reverse().find((n) => !n.read)
                  ?.detail || "A reviewed regulation update has been adopted."}
              </p>
            </div>
          </div>
          <Button variant="primary" onClick={() => setTab("notifications")}>
            View alerts
          </Button>
        </section>
      )}
      <div className="reg-stats">
        <div className="card">
          <strong>50</strong>
          <span>States inventoried as jurisdictions</span>
        </div>
        <div className="card">
          <strong>
            {
              data.coverage.filter(
                (c) =>
                  c.code !== "US" &&
                  c.code !== "DC" &&
                  c.status === "monitored",
              ).length
            }
            /50
          </strong>
          <span>States with fresh monitored sources</span>
        </div>
        <div className="card">
          <strong>{rules.length}</strong>
          <span>Candidate obligations, review required</span>
        </div>
        <div className="card">
          <strong>{pending}</strong>
          <span>Queued or running source jobs</span>
        </div>
      </div>
      <p className="reg-caution">
        Monitoring a source does not establish complete legal coverage. Missing
        rules, exceptions and local or program requirements remain review tasks.
        No automatic legal-compliance certification is issued.
      </p>
      <div
        className="reg-tabs"
        role="tablist"
        aria-label="Regulatory workspace"
      >
        {[
          "notifications",
          "coverage",
          "sources",
          "changes",
          "onboarding",
          "checklist",
          "operations",
        ].map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => {
              setTab(t);
              setMessage("");
            }}
          >
            {label(t)}
          </button>
        ))}
        <label>
          Jurisdiction{" "}
          <select
            className="input"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="ALL">All jurisdictions</option>
            <option value="US">Federal</option>
            {jurisdictions.map((j) => (
              <option key={j.code} value={j.code}>
                {j.name}
              </option>
            ))}
          </select>
        </label>
      </div>
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
            <h3>Coverage and source freshness</h3>
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
            State regulator starting points require verification before
            activation. Add statutes, administrative registers, licensing and
            Medicaid sources for each topic. Discovery pages cannot become legal
            obligations.
          </p>
        </section>
      )}
      {tab === "sources" && (
        <>
          <section className="card">
            <h3>Source registry</h3>
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
                        {s.approved && (
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              act({ type: "scan", sourceId: s.id })
                            }
                          >
                            Scan
                          </Button>
                        )}
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
          <SourceForm act={act} busy={busy} />
        </>
      )}
      {tab === "changes" && (
        <section className="stack">
          {!rules.length && (
            <div className="card">
              <h3>No extracted obligations yet</h3>
              <p>
                Add and enable an official legal source, queue a scan, and let
                the worker process it. Initial extraction establishes the
                current baseline; later scans detect changes.
              </p>
            </div>
          )}
          {rules.map((rule) => {
            const review = data.agency.reviews.find(
              (r) => r.ruleId === rule.id,
            );
            return (
              <article className="card" key={rule.id}>
                <div className="card-head">
                  <h3>{rule.title}</h3>
                  <span className="tag">
                    {rule.jurisdiction} ·{" "}
                    {rule.demo ? "SIMULATED POLICY" : rule.legalStatus} ·{" "}
                    {review?.decision || "Unreviewed"}
                  </span>
                </div>
                <p>{rule.obligation}</p>
                <p className="small muted">
                  {rule.citation} · Effective {rule.effectiveFrom || "unknown"}
                  {rule.effectiveTo ? ` until ${rule.effectiveTo}` : ""} ·
                  Deadline {rule.deadline || "not specified"} ·{" "}
                  {label(rule.topic)}
                </p>
                {rule.demo && (
                  <p className="reg-caution">
                    Simulated company policy for the presentation. This is not
                    an actual legislative change.
                  </p>
                )}
                <blockquote>{rule.quote}</blockquote>
                <p className="small">
                  Exceptions:{" "}
                  {rule.exceptions || "No exception extracted; verify scope."}
                </p>
                {rule.unresolved.length > 0 && (
                  <p className="reg-error">
                    Unresolved: {rule.unresolved.join("; ")}
                  </p>
                )}
                <details>
                  <summary>Captured evidence and previous version</summary>
                  <Evidence id={rule.snapshotId} />
                  {rule.previousId && (
                    <p>
                      {data.candidates.find((r) => r.id === rule.previousId)
                        ?.obligation || "Previous candidate unavailable"}
                    </p>
                  )}
                </details>
                <div className="reg-impact">
                  {rule.impact.length ? (
                    rule.impact.map((i) => (
                      <p key={i.id}>
                        <strong>
                          {i.name}: {label(i.result)}
                        </strong>
                        <br />
                        <span className="small muted">
                          {i.reasons.join(" ")}
                        </span>
                      </p>
                    ))
                  ) : (
                    <p>
                      Add workers and service assignments to evaluate impact.
                    </p>
                  )}
                </div>
                <Review
                  rule={rule}
                  busy={busy}
                  act={act}
                  adopted={data.agency.adopted.includes(rule.id)}
                  reviewed={review?.decision === "approved"}
                />
              </article>
            );
          })}
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
      {tab === "checklist" && (
        <>
          <section className="card">
            <h3>Agency and worker actions</h3>
            {!data.agency.actions.length && (
              <p>
                No adopted obligations. Complete onboarding, review a sourced
                obligation, and adopt the applicable version.
              </p>
            )}
            {data.agency.actions.map((a) => (
              <div className="reg-action" key={a.id}>
                <div>
                  <strong>{a.title}</strong>
                  <p className="small muted">
                    {a.workerId
                      ? data.agency.workers.find((w) => w.id === a.workerId)
                          ?.name
                      : "Agency"}{" "}
                    · {a.kind} · Due {a.due || "not specified"} · {a.status}
                  </p>
                </div>
                {a.status === "open" && (
                  <CompleteAction id={a.id} act={act} busy={busy} />
                )}
              </div>
            ))}
          </section>
          <Checklist />
        </>
      )}
      {tab === "operations" && (
        <>
          <section className="card">
            <h3>Worker and usage</h3>
            <p>Last worker tick: {date(data.scheduler.lastTick)}</p>
            <p>
              {data.usage.day || "No AI usage"} · {data.usage.calls}/
              {data.limits.calls} daily calls · {data.usage.tokens}/
              {data.limits.tokens} tokens reserved or consumed
            </p>
            <p className="small muted">
              Run the persistent worker with{" "}
              <code>npm run regulatory:worker</code>. A queue action does not
              start an unattended process. Failed AI calls keep their
              conservative token reservation. No Anthropic fallback is used by
              regulatory extraction.
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
  return (
    <div className="reg-review">
      <label>
        Review notes
        <textarea
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Confirm scope, exceptions, dates and required evidence against the official source."
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />{" "}
        I reviewed the source, dates, scope and exceptions for this exact
        version.
      </label>
      <div className="actions">
        <Button
          disabled={busy || note.trim().length < 10 || adopted}
          onClick={() =>
            act({ type: "review", ruleId: rule.id, decision: "rejected", note })
          }
        >
          Reject
        </Button>
        <Button
          disabled={
            busy || blocked || !checked || note.trim().length < 10 || adopted
          }
          onClick={() =>
            act({ type: "review", ruleId: rule.id, decision: "approved", note })
          }
        >
          Approve version
        </Button>
        <Button
          variant="primary"
          disabled={busy || adopted || !reviewed || blocked}
          onClick={() =>
            act({
              type: "adopt",
              ruleId: rule.id,
              fingerprint: rule.fingerprint,
            })
          }
        >
          {adopted ? "Adopted" : "Adopt applicable obligations"}
        </Button>
      </div>
    </div>
  );
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
function CompleteAction({
  id,
  act,
  busy,
}: {
  id: string;
  act: (b: unknown) => Promise<void>;
  busy: boolean;
}) {
  const [note, setNote] = useState("");
  return (
    <div className="actions">
      <input
        className="input"
        aria-label="Completion evidence or notes"
        placeholder="Completion evidence / notes"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <Button
        disabled={busy || note.trim().length < 5}
        onClick={() => act({ type: "action-complete", id, note })}
      >
        Record completion
      </Button>
    </div>
  );
}
function Checklist() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    try {
      setData(await api("collection"));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function act(body: unknown) {
    setBusy(true);
    try {
      setData(await api("collection-actions", body));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <h3>Worker document evidence</h3>
      <p className="small muted">
        Documents are retained per rule version. Staff must verify the original
        and confirm the full obligation. Completing an action does not approve a
        document.
      </p>
      {error && <p role="alert">{error}</p>}
      {!data ? (
        <p>Loading checklist…</p>
      ) : data.db.requirements.length === 0 ? (
        <p>No adopted worker document requirements.</p>
      ) : (
        data.db.requirements.map((item) => {
          const cg = data.db.caregivers.find((c) => c.id === item.caregiverId)!;
          const req = data.db.rules.requirements.find(
            (r) => r.id === item.requirementId,
          )!;
          const sub = data.db.submissions.find(
            (s) =>
              s.id === (item.openSubmissionId || item.approvedSubmissionId),
          );
          return (
            <article
              className="reg-check-item"
              key={item.caregiverId + item.requirementId}
            >
              <div className="card-head">
                <h4>
                  {cg.name} · {req.name}
                </h4>
                <StatusBadge status={item.status} />
              </div>
              <p className="small">{req.rule}</p>
              {sub ? (
                <>
                  <p>
                    {sub.files.map((f) => (
                      <a
                        key={f.url}
                        href={f.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {f.name}
                      </a>
                    ))}
                  </p>
                  {sub.fields.map((f) => (
                    <div className="reg-field" key={f.key}>
                      <div>
                        <strong>{f.label}</strong>
                        <p>{f.value}</p>
                        <small>
                          {f.source === "verified"
                            ? "Verified"
                            : "Needs verification"}
                        </small>
                      </div>
                      <Button
                        disabled={
                          busy ||
                          f.source === "verified" ||
                          sub.state === "approved"
                        }
                        onClick={() =>
                          act({
                            type: "verify-field",
                            submissionId: sub.id,
                            key: f.key,
                          })
                        }
                      >
                        Verify
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="primary"
                    disabled={
                      busy ||
                      sub.state === "approved" ||
                      sub.fields.some(
                        (f) => f.source !== "verified" && f.source !== "edited",
                      )
                    }
                    onClick={() =>
                      act({ type: "approve", submissionId: sub.id })
                    }
                  >
                    Approve evidence
                  </Button>
                  <Button
                    disabled={busy || sub.state === "approved"}
                    onClick={() =>
                      act({
                        type: "reject",
                        submissionId: sub.id,
                        reason:
                          "Evidence does not establish the full obligation.",
                      })
                    }
                  >
                    Reject evidence
                  </Button>
                </>
              ) : null}
              <EvidenceForm
                caregiverId={cg.id}
                requirementId={req.id}
                onSubmit={act}
                busy={busy}
              />
            </article>
          );
        })
      )}
    </section>
  );
}
function EvidenceForm({
  caregiverId,
  requirementId,
  onSubmit,
  busy,
}: {
  caregiverId: string;
  requirementId: string;
  onSubmit: (b: unknown) => Promise<void>;
  busy: boolean;
}) {
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  return (
    <details>
      <summary>Submit new evidence</summary>
      <form
        className="reg-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setUploading(true);
          try {
            const form = new FormData(e.currentTarget);
            const response = await fetch("/api/regulatory/upload", {
              method: "POST",
              body: form,
            });
            const uploaded = await response.json();
            if (!response.ok) throw new Error(uploaded.error);
            await onSubmit({
              type: "evidence-submit",
              caregiverId,
              requirementId,
              fileId: uploaded.id,
              notes: form.get("notes"),
              date: form.get("date"),
            });
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setUploading(false);
          }
        }}
      >
        <label>
          Original evidence
          <input
            type="file"
            name="file"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            required
          />
        </label>
        <label>
          Evidence date
          <input className="input" type="date" name="date" required />
        </label>
        <label>
          How the evidence satisfies the full obligation
          <textarea className="input" name="notes" minLength={10} required />
        </label>
        {error && <p role="alert">{error}</p>}
        <Button type="submit" disabled={busy || uploading}>
          Submit for human verification
        </Button>
      </form>
    </details>
  );
}
