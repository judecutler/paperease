import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
// Small, reproducible import of real official pages. No legal review or adoption is implied.
async function main() {
  const { fetchOfficial, parseSnapshot, hash } = await import(
    "../lib/regulatory/fetch"
  );
  const { readDoc, mutate, saveImmutable, localMode } = await import(
    "../lib/regulatory/store"
  );
  const { initialCorpus } = await import("../lib/regulatory/jurisdictions");
  const { extract } = await import("../lib/regulatory/ai");
  const { fanOutAlerts } = await import("../lib/regulatory/notifications");
  const definitions = [
    {
      jurisdiction: "CA",
      title: "California CDSS: Home Care Services laws and policies",
      url: "https://www.cdss.ca.gov/inforesources/community-care/home-care-services/laws-and-policies",
      authority: "California Department of Social Services",
      topic: "agency-license" as const,
    },
    {
      jurisdiction: "CA",
      title: "California CDSS: Home Care Aide application process",
      url: "https://www.cdss.ca.gov/inforesources/community-care/home-care-services/home-care-aide-application-process",
      authority: "California Department of Social Services",
      topic: "worker-license" as const,
    },
    {
      jurisdiction: "US",
      title: "CMS: Home Health Agency certification requirements",
      url: "https://www.cms.gov/medicare/health-safety-standards/certification-compliance/home-health-agencies",
      authority: "Centers for Medicare & Medicaid Services",
      topic: "medicare-medicaid" as const,
    },
  ];
  const report: {
    sourceId: string;
    title: string;
    status: string;
    stored?: number;
    sections?: number;
    error?: string;
  }[] = [];
  for (const def of definitions) {
    const source = {
      ...def,
      id: `official-import:${hash(def.url).slice(0, 20)}`,
      kind: "guidance" as const,
      approved: true,
      approvedBy:
        "Official government publisher; legal interpretation remains unverified",
      approvedAt: new Date().toISOString(),
      intervalHours: 24,
    };
    try {
      const fetched = await fetchOfficial(source.url);
      const snapshot = await parseSnapshot(source, fetched);
      await saveImmutable(snapshot.id, snapshot);
      await mutate("reg:corpus", initialCorpus, (c) => {
        if (!c.sources.some((s) => s.id === source.id)) c.sources.push(source);
      });
      const prior = (await readDoc("reg:corpus", initialCorpus)).data;
      if (
        prior.candidates.some(
          (r) => r.sourceId === source.id && r.snapshotId === snapshot.id,
        )
      ) {
        report.push({
          sourceId: source.id,
          title: source.title,
          status: "already-stored",
        });
        continue;
      }
      let count = 0;
      for (let cursor = 0; cursor < snapshot.sections.length; cursor += 2) {
        const day = new Date().toISOString().slice(0, 10);
        const reserved = 24000;
        await mutate("reg:corpus", initialCorpus, (c) => {
          if (c.usage.day !== day) c.usage = { day, calls: 0, tokens: 0 };
          if (
            c.usage.calls >=
              Number(process.env.REGULATORY_DAILY_CALL_LIMIT || 20) ||
            c.usage.tokens + reserved >
              Number(process.env.REGULATORY_DAILY_TOKEN_LIMIT || 100000)
          )
            throw new Error(
              "Daily AI budget reached; remaining sources were not imported.",
            );
          c.usage.calls++;
          c.usage.tokens += reserved;
        });
        const out = await extract(
          snapshot,
          source,
          snapshot.sections.slice(cursor, cursor + 2),
        );
        await mutate("reg:corpus", initialCorpus, (c) => {
          c.usage.tokens += out.tokens - reserved;
          for (const r of out.candidates) {
            if (!c.candidates.some((old) => old.id === r.id)) {
              c.candidates.push({ ...r, verificationStatus: "unverified" });
              count++;
            }
          }
        });
      }
      await mutate("reg:corpus", initialCorpus, (c) => {
        const s = c.sources.find((s) => s.id === source.id)!;
        s.lastChecked = s.lastSuccess = new Date().toISOString();
        s.snapshotId = snapshot.id;
        s.hash = snapshot.hash;
        s.error = undefined;
      });
      report.push({
        sourceId: source.id,
        title: source.title,
        status: "stored-unverified",
        stored: count,
        sections: snapshot.sections.length,
      });
    } catch (e) {
      report.push({
        sourceId: source.id,
        title: source.title,
        status: "failed",
        error: e instanceof Error ? e.message : "Import failed",
      });
    }
  }
  await saveImmutable(`import:${new Date().toISOString()}`, {
    at: new Date().toISOString(),
    storage: localMode() ? "local" : "supabase",
    coverage: "selected official CA and federal pages only",
    humanReviewed: false,
    secondAgentRun: false,
    report,
  });
  await fanOutAlerts();
  const corpus = (await readDoc("reg:corpus", initialCorpus)).data;
  console.log(
    JSON.stringify(
      {
        storage: localMode() ? "local" : "supabase",
        totalStoredNonDemoRules: corpus.candidates.filter((r) => !r.demo)
          .length,
        report,
      },
      null,
      2,
    ),
  );
  if (!corpus.candidates.some((r) => !r.demo)) process.exitCode = 1;
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Import failed");
  process.exitCode = 1;
});
