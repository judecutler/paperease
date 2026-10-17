"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type React from "react";
import { useEffect, useState } from "react";
import type { Admin } from "@/lib/adminRole";
import type { AiStatus } from "@/lib/types";

const NAV = [
  ["/", "Dashboard"],
  ["/audit", "Audit trail"],
  ["/rules", "Rules"],
  ["/regulatory", "Company"],
] as const;

const signOut = async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.assign("/login");
};

export function Shell({
  ai,
  me,
  children,
  error,
  onDismiss,
}: {
  ai?: AiStatus;
  me?: Admin | null;
  children: React.ReactNode;
  error?: string | null;
  onDismiss?: () => void;
}) {
  const path = usePathname();
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const res = await fetch("/api/regulatory/alerts");
        if (res.ok) {
          const data = await res.json();
          if (active) setUnread(data.unread);
        }
      } catch {}
    }
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [path]);
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand">
            <span className="brand-mark" aria-hidden="true">
              <svg
                width="22"
                height="22"
                viewBox="0 0 22 22"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.25"
                strokeLinecap="round"
              >
                <path d="M17 7.5A7 7 0 1 0 18 12" />
                <path d="M17.5 3.5v4.25h-4.25" />
              </svg>
            </span>
            PaperEase
          </Link>
          <nav className="nav">
            {NAV.map(([href, label]) => (
              <Link
                key={href}
                href={href}
                className={
                  (
                    href === "/"
                      ? path === "/" || path.startsWith("/caregivers")
                      : path.startsWith(href)
                  )
                    ? "active"
                    : ""
                }
              >
                {label}
              </Link>
            ))}
          </nav>
          {unread > 0 && (
            <a
              href="/regulatory/watch?tab=notifications"
              className="reg-shell-alert"
              aria-label={`${unread} unread regulation alerts`}
            >
              Alerts <span>{unread}</span>
            </a>
          )}
          {ai && (
            <span
              className="ai-chip"
              title={`Extraction: ${ai.extraction}. SMS copy: ${ai.messaging}. Follow-up questions: ${ai.followUps}.`}
            >
              <span
                className={`cl-dot ${ai.extraction === "claude" ? "cl-fill-agent" : "cl-fill-attention"}`}
              />
              {ai.extraction === "claude"
                ? "Live AI"
                : "Demo mode (no API key)"}
              {ai.followUps === "runanywhere"
                ? " · RunAnywhere follow-ups"
                : ""}
            </span>
          )}
          {me && (
            <span className="me" title={me.email}>
              {me.name}
              <button className="cl-btn cl-btn-quiet cl-btn-sm" onClick={signOut}>Sign out</button>
            </span>
          )}
        </div>
      </header>
      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button className="cl-btn cl-btn-quiet cl-btn-sm" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      )}
      <main className="page">{children}</main>
    </>
  );
}
