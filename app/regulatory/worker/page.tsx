"use client";
import { useEffect, useState } from "react";
import type { workerInbox } from "@/lib/regulatory/worker-inbox";
import { Button } from "@/components/ui";
import "../regulatory.css";
type Inbox = Awaited<ReturnType<typeof workerInbox>>;
export default function WorkerInboxPage() {
  const [data, setData] = useState<Inbox | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [login, setLogin] = useState(false);
  const query = () =>
    typeof window !== "undefined" ? window.location.search : "";
  async function refresh() {
    try {
      const res = await fetch(`/api/regulatory/worker-inbox${query()}`);
      const body = await res.json();
      if (!res.ok) {
        setLogin(res.status === 401);
        throw new Error(body.error);
      }
      setData(body);
      setError("");
      setLogin(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 10000);
    return () => clearInterval(id);
  }, []);
  async function acknowledge(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/regulatory/worker-acknowledge${query()}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="reg-worker-page">
      <div className="reg-worker-brand">PaperEase</div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Your work updates</div>
          <h1>
            {data ? `Hello, ${data.worker.name.split(" ")[0]}` : "Worker inbox"}
          </h1>
          <p>New requirements that concern your service assignment.</p>
        </div>
      </div>
      {data?.local && (
        <p className="reg-caution">
          Isolated demo worker view. Messages concern a simulated policy, not an
          actual legislative change.
        </p>
      )}
      {error && (
        <p className="reg-error" role="alert">
          {error}
        </p>
      )}
      {login && (
        <form
          className="card reg-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const f = new FormData(e.currentTarget);
              const res = await fetch("/api/regulatory/session", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  email: f.get("email"),
                  password: f.get("password"),
                  createWorkspace: false,
                }),
              });
              const body = await res.json();
              if (!res.ok) throw new Error(body.error);
              await refresh();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Email
            <input
              className="input"
              name="email"
              type="email"
              autoComplete="username"
              required
            />
          </label>
          <label>
            Password
            <input
              className="input"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <Button type="submit" disabled={busy}>
            Sign in to my inbox
          </Button>
        </form>
      )}
      {data && (
        <>
          <div className="reg-inbox-summary" role="status">
            {data.messages.filter((m) => !m.acknowledgedAt).length} unread
            requirement update(s)
          </div>
          {!data.messages.length && (
            <section className="card">
              <h3>You’re up to date</h3>
              <p>No new reviewed requirement has been assigned to you.</p>
            </section>
          )}
          {[...data.messages].reverse().map((m) => (
            <article className="card reg-worker-message" key={m.id}>
              <div className="card-head">
                <span className="reg-notice-label">
                  {m.acknowledgedAt ? "Acknowledged" : "New requirement"}
                </span>
                <span className="small muted">PaperEase agent</span>
              </div>
              <h2>{m.title}</h2>
              <p>{m.body}</p>
              <div className="reg-worker-reason">
                <strong>Why this concerns you</strong>
                <p>{m.reason}</p>
              </div>
              <p>
                <strong>Your next step</strong>
                <br />
                {m.action}
              </p>
              <p>
                <strong>Effective date:</strong> {m.effectiveFrom}
                <br />
                <strong>Deadline:</strong>{" "}
                {m.deadline ||
                  "No deadline specified. Ask your agency if you need clarification."}
              </p>
              <p className="small muted">{m.citation}</p>
              {!m.demo && (
                <p>
                  <a href={m.sourceUrl} target="_blank" rel="noreferrer">
                    Read the official source
                  </a>
                </p>
              )}
              {m.currentApplicability !== "applicable" && (
                <p className="reg-caution">
                  Your assignment or the rule’s dates have changed. Contact your
                  agency before acting on this update.
                </p>
              )}
              <Button
                variant="primary"
                disabled={busy || !!m.acknowledgedAt}
                onClick={() => acknowledge(m.id)}
              >
                {m.acknowledgedAt ? "Acknowledged" : "I have read this update"}
              </Button>
              <p className="small muted">
                Acknowledging this message does not complete the requirement or
                approve your evidence.
              </p>
            </article>
          ))}
        </>
      )}
    </main>
  );
}
