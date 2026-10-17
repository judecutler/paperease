"use client";
import { useState } from "react";
import { Button } from "./ui";
import type { AgencyState } from "@/lib/regulatory/types";
export function RegulatoryNotifications({
  agency,
  busy,
  act,
  openChanges,
}: {
  agency: AgencyState;
  busy: boolean;
  act: (b: unknown) => Promise<void>;
  openChanges: () => void;
}) {
  const [workerId, setWorkerId] = useState("all");
  const messages = (agency.workerNotices || []).filter(
    (m) => workerId === "all" || m.workerId === workerId,
  );
  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <h3>Regulation alerts</h3>
          <span>{agency.notices.filter((n) => !n.read).length} unread</span>
        </div>
        {!agency.notices.length && (
          <p>No changes detected yet.</p>
        )}
        {[...agency.notices].reverse().map((n) => (
          <article
            key={n.id}
            className={`reg-notice ${n.read ? "reg-notice-read" : ""}`}
          >
            <div>
              <span className="reg-notice-label">
                {n.read ? "Read" : "New alert"}
              </span>
              <h4>{n.title}</h4>
              <p>
                {n.detail ||
                  "A reviewed rule was adopted."}
              </p>
              <small>{new Date(n.at).toLocaleString()}</small>
            </div>
            <div className="actions">
              <a href="/regulatory/watch" onClick={(e) => { e.preventDefault(); openChanges(); }}>Review changes</a>
              {!n.read && (
                <Button
                  disabled={busy}
                  onClick={() => act({ type: "notice-read", id: n.id })}
                >
                  Mark read
                </Button>
              )}
            </div>
          </article>
        ))}
      </section>
      <section className="card">
        <div className="card-head">
          <h3>Worker updates</h3>
          <span>In-app messages</span>
        </div>
        <p className="muted small">
          Workers see these updates after adoption. Delivery is in-app only.
        </p>
        <label>
          Show worker{" "}
          <select
            className="input"
            value={workerId}
            onChange={(e) => setWorkerId(e.target.value)}
          >
            <option value="all">All workers</option>
            {agency.workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        {!messages.length && (
          <p>
            No worker updates yet. Adopt an applicable rule to notify workers.
          </p>
        )}
        {[...messages].reverse().map((m) => (
          <article className="reg-worker-message" key={m.id}>
            <div className="card-head">
              <strong>
                {agency.workers.find((w) => w.id === m.workerId)?.name ||
                  "Worker"}
              </strong>
              <span className="reg-notice-label">
                {m.acknowledgedAt
                  ? "Acknowledged"
                  : "Delivered in-app"}
              </span>
            </div>
            <p className="small muted">
              PaperEase agent · {new Date(m.createdAt).toLocaleString()}
              {m.demo ? " · Simulated demo" : ""}
            </p>
            <h4>{m.title}</h4>
            <p>{m.body}</p>
            <p>
              <strong>Why this concerns you:</strong> {m.reason}
            </p>
            <p>
              <strong>What to do:</strong> {m.action}
            </p>
            <p className="small">
              Effective: {m.effectiveFrom} · Deadline:{" "}
              {m.deadline || "No date specified in the reviewed rule"}
            </p>
            <p className="small">Source: {m.citation}</p>
            <a
              className="cl-btn cl-btn-secondary cl-btn-sm"
              href={`/regulatory/worker?workerId=${encodeURIComponent(m.workerId)}`}
              target="_blank"
              rel="noreferrer"
            >
              View worker space
            </a>
          </article>
        ))}
      </section>
    </div>
  );
}
