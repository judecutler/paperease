import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
async function main() {
  const { supabase, mutate } = await import("../lib/regulatory/store");
  const { randomUUID } = await import("node:crypto");
  const { GET, POST } = await import("../app/api/regulatory/[...path]/route");
  const created: string[] = [];
  const agencies: string[] = [];
  const call = async (path: string, body?: unknown, cookie?: string) => {
    const req = new Request(`http://localhost/api/regulatory/${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return (body ? POST : GET)(req, {
      params: Promise.resolve({ path: path.split("/") }),
    });
  };
  try {
    if ((await call("state")).status !== 401)
      throw new Error("Unauthenticated access was not rejected.");
    const cookies: string[] = [];
    for (let n = 0; n < 2; n++) {
      const password = randomUUID() + randomUUID();
      const email = `careloop-validation-${randomUUID()}@example.com`;
      const user = await supabase("/auth/v1/admin/users", {
        method: "POST",
        body: JSON.stringify({ email, password, email_confirm: true }),
      });
      created.push(user.id);
      const response = await call("session", {
        email,
        password,
        createWorkspace: true,
      });
      if (!response.ok)
        throw new Error(
          "Technical user sign-in failed: " +
            response.status +
            " " +
            JSON.stringify(await response.json()),
        );
      const cookie = response.headers.get("set-cookie")!.split(";")[0];
      cookies.push(cookie);
      const membership = await supabase(
        `/rest/v1/reg_memberships?user_id=eq.${user.id}&select=agency_id`,
      );
      agencies.push(membership[0].agency_id);
    }
    const profile = {
      name: "Isolated technical validation",
      ownership: "for-profit",
      headquarters: "NY",
      operatingStates: ["CA"],
      services: ["nonmedical"],
      payers: ["private"],
      agencyLicense: "",
      programs: [],
    };
    const saved = await call(
      "actions",
      { type: "profile", profile },
      cookies[0],
    );
    if (!saved.ok) throw new Error(`Profile save HTTP ${saved.status}`);
    const own = await (await call("state", undefined, cookies[0])).json();
    const other = await (await call("state", undefined, cookies[1])).json();
    if (
      own.agency.profile.name !== profile.name ||
      other.agency.profile.name === profile.name
    )
      throw new Error("Tenant isolation failed.");
    console.log(
      "Authenticated API, profile persistence and two-tenant isolation: PASS",
    );
    const { emptyAgency } = await import("../lib/regulatory/types");
    const sampleWorker = (id: string) => ({
      id,
      name: "Technical worker",
      role: "home-care-aide" as const,
      residence: "NV",
      serviceState: "CA",
      locality: "",
      service: "nonmedical" as const,
      licenseStates: [],
      licenseExpires: "",
    });
    await mutate(`reg:agency:${agencies[0]}`, emptyAgency, (a) => {
      a.workers = [sampleWorker("worker-a"), sampleWorker("worker-b")];
      a.workerNotices = ["a", "b"].map((s) => ({
        id: `message-${s}`,
        workerId: `worker-${s}`,
        ruleId: "technical-validation-only",
        title: "Technical notification fixture",
        body: "Synthetic test message; not a regulation.",
        reason: "Technical isolation test",
        action: "No action required",
        citation: "Synthetic fixture",
        sourceUrl: "https://www.cms.gov/",
        effectiveFrom: "2020-01-01",
        deadline: null,
        createdAt: new Date().toISOString(),
        channel: "in-app",
        generatedBy: "careloop-agent",
        demo: false,
      }));
    });
    for (let n = 0; n < 2; n++)
      await supabase("/rest/v1/reg_worker_memberships", {
        method: "POST",
        body: JSON.stringify({
          user_id: created[n],
          agency_id: agencies[0],
          worker_id: n === 0 ? "worker-a" : "worker-b",
        }),
      });
    const inboxResponse = await GET(
      new Request(
        "http://localhost/api/regulatory/worker-inbox?workerId=worker-b",
        { headers: { cookie: cookies[0] } },
      ),
      { params: Promise.resolve({ path: ["worker-inbox"] }) },
    );
    const inbox = await inboxResponse.json();
    if (
      !inboxResponse.ok ||
      inbox.worker.id !== "worker-a" ||
      inbox.messages.length !== 1 ||
      inbox.messages[0].id !== "message-a"
    )
      throw new Error("Worker inbox identity isolation failed.");
    if (
      (await call("worker-acknowledge", { id: "message-a" }, cookies[1]))
        .status !== 404
    )
      throw new Error("Another worker could acknowledge the wrong message.");
    if (!(await call("worker-acknowledge", { id: "message-b" }, cookies[1])).ok)
      throw new Error("Worker acknowledgment failed.");
    console.log(
      "Worker identity mapping, forged ID rejection and acknowledgment isolation: PASS",
    );
  } finally {
    for (const id of agencies)
      await supabase(
        `/rest/v1/reg_documents?id=eq.${encodeURIComponent(`reg:agency:${id}`)}`,
        { method: "DELETE" },
      );
    for (const id of created) {
      await supabase(`/rest/v1/reg_worker_memberships?user_id=eq.${id}`, {
        method: "DELETE",
      });
      await supabase(`/rest/v1/reg_memberships?user_id=eq.${id}`, {
        method: "DELETE",
      });
      await supabase(`/auth/v1/admin/users/${id}`, { method: "DELETE" });
    }
    console.log("Technical users, memberships and agency data cleaned up.");
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Live test failed");
  process.exitCode = 1;
});
