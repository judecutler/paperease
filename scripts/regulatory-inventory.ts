import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
async function main() {
  const { readDoc, mutate } = await import("../lib/regulatory/store");
  const { initialCorpus } = await import("../lib/regulatory/jurisdictions");
  const { fetchOfficial, parseSnapshot } = await import(
    "../lib/regulatory/fetch"
  );
  const { CORPUS } = await import("../lib/regulatory/service");
  const sources = (await readDoc(CORPUS, initialCorpus)).data.sources.filter(
    (s) => s.kind === "discovery" && !s.approved,
  );
  let cursor = 0,
    enabled = 0,
    failed = 0;
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (cursor < sources.length) {
        const source = sources[cursor++];
        try {
          const snap = await parseSnapshot(
            source,
            await fetchOfficial(source.url),
          );
          await mutate(CORPUS, initialCorpus, (c) => {
            const live = c.sources.find((s) => s.id === source.id)!;
            live.approved = true;
            live.approvedBy =
              "Automated official-domain/readability check; legal scope unreviewed";
            live.approvedAt = new Date().toISOString();
            live.error = undefined;
          });
          enabled++;
          console.log(
            `${source.jurisdiction}: official discovery page reachable (${snap.links.length} relevant links).`,
          );
        } catch (e) {
          failed++;
          await mutate(CORPUS, initialCorpus, (c) => {
            const live = c.sources.find((s) => s.id === source.id)!;
            live.error = e instanceof Error ? e.message : "Inventory failed";
          });
          console.log(
            `${source.jurisdiction}: source needs manual verification.`,
          );
        }
      }
    }),
  );
  console.log(
    JSON.stringify({
      enabledDiscoverySources: enabled,
      needsVerification: failed,
      legalReviewComplete: false,
    }),
  );
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Inventory failed");
  process.exitCode = 1;
});
