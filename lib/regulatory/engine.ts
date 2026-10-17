import type { Candidate, AgencyState, Worker, Profile } from "./types";
export interface Result {
  result: "applicable" | "not-applicable" | "needs-review";
  reasons: string[];
}
export function applicable(
  rule: Candidate,
  profile: Profile,
  worker?: Worker,
  on = new Date().toISOString().slice(0, 10),
): Result {
  const no = (s: string): Result => ({
    result: "not-applicable",
    reasons: [s],
  });
  const unknown = (s: string): Result => ({
    result: "needs-review",
    reasons: [s],
  });
  if (rule.legalStatus !== "enacted")
    return unknown(
      `Legal status is ${rule.legalStatus}; not an active enacted obligation.`,
    );
  if (!rule.effectiveFrom)
    return unknown("Effective date has not been established.");
  if (rule.effectiveFrom > on)
    return no(`Effective from ${rule.effectiveFrom}.`);
  if (rule.effectiveTo && rule.effectiveTo <= on)
    return no("This version is no longer effective.");
  if (!rule.scopeComplete || rule.unresolved.length)
    return unknown("Scope, exceptions or cross-references require review.");
  if (profile.ownership === "unknown")
    return unknown("Organization ownership is missing.");
  if (rule.ownership.length && !rule.ownership.includes(profile.ownership))
    return no("Ownership is outside this rule.");
  if (rule.payers.length) {
    if (!profile.payers.length)
      return unknown("Payer participation is missing.");
    if (!rule.payers.some((p) => profile.payers.includes(p)))
      return no("Payer does not match.");
  }
  if (rule.topic === "medicare-medicaid")
    return unknown(
      "Program-specific enrollment and conditions need manual review.",
    );
  if (rule.topic === "local-requirements")
    return unknown("Local jurisdiction needs manual review.");
  if (rule.subject === "worker") {
    if (!worker)
      return unknown("Worker role and service assignment are required.");
    if (rule.jurisdiction !== "US" && worker.serviceState !== rule.jurisdiction)
      return no("Service is performed in another state.");
    if (!rule.services.includes(worker.service))
      return no("Service track does not match.");
    if (rule.roles.length && !rule.roles.includes(worker.role))
      return no("Worker role does not match.");
    return {
      result: "applicable",
      reasons: [
        `Matched ${worker.role} providing ${worker.service} in ${worker.serviceState}. Authorization and submitted evidence must be verified separately.`,
      ],
    };
  }
  if (!profile.operatingStates.length || !profile.services.length)
    return unknown("Operating states and services are missing.");
  if (
    rule.jurisdiction !== "US" &&
    !profile.operatingStates.includes(rule.jurisdiction)
  )
    return no("Agency does not operate in this state.");
  if (!rule.services.some((s) => profile.services.includes(s)))
    return no("Agency service track does not match.");
  return {
    result: "applicable",
    reasons: [
      "Matched agency operating jurisdiction, service and organization profile.",
    ],
  };
}
export function impact(rule: Candidate, state: AgencyState, on?: string) {
  return rule.subject === "agency"
    ? [
        {
          id: "agency",
          name: state.profile.name,
          ...applicable(rule, state.profile, undefined, on),
        },
      ]
    : state.workers.map((w) => ({
        id: w.id,
        name: w.name,
        ...applicable(rule, state.profile, w, on),
      }));
}
export function coverage(
  sources: {
    jurisdiction: string;
    approved: boolean;
    lastSuccess?: string;
    error?: string;
    kind: string;
    intervalHours: number;
    topic: string;
  }[],
  jurisdiction: string,
) {
  const own = sources.filter((s) => s.jurisdiction === jurisdiction);
  const approved = own.filter((s) => s.approved);
  const stale = approved.some(
    (s) =>
      !s.lastSuccess ||
      Date.now() - Date.parse(s.lastSuccess) > s.intervalHours * 3600000 * 2,
  );
  return {
    sources: own.length,
    enabled: approved.length,
    readable: approved.filter((s) => s.lastSuccess).length,
    status: !approved.length
      ? "not-established"
      : approved.some((s) => s.error)
        ? "blocked"
        : stale
          ? "stale"
          : "monitored",
    legalCoverage: "Review required",
  };
}
export function impactFingerprint(
  rule: Candidate,
  state: AgencyState,
  on = new Date().toISOString().slice(0, 10),
) {
  return JSON.stringify({
    rule: rule.id,
    profile: state.profile,
    workers: state.workers,
    on,
  });
}
