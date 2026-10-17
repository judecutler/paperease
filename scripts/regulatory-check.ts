import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
async function main() {
  const { supabase, readDoc, writeDoc } = await import(
    "../lib/regulatory/store"
  );
  const { randomUUID } = await import("node:crypto");
  const id = `validation:${randomUUID()}`;
  try {
    await writeDoc(id, { technicalValidation: true }, 0);
    const result = await readDoc(id, () => null);
    console.log(
      "Supabase transactional storage:",
      result.revision === 1 ? "PASS" : "FAIL",
    );
  } finally {
    await supabase(`/rest/v1/reg_documents?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }
  const base = process.env.RUNANYWHERE_BASE_URL!.replace(/\/$/, "");
  const headers = {
    authorization: `Bearer ${process.env.RUNANYWHERE_API_KEY}`,
    "content-type": "application/json",
  };
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(60000),
    body: JSON.stringify({
      model: process.env.RUNANYWHERE_MODEL,
      max_tokens: 100,
      temperature: 0,
      messages: [
        {
          role: "user",
          content:
            'Return exactly this JSON object and nothing else: {"ok":true}',
        },
      ],
    }),
  });
  if (!response.ok) {
    console.log("RunAnywhere API: HTTP", response.status);
    return;
  }
  const result = await response.json();
  console.log(
    "RunAnywhere completion:",
    Boolean(result.choices?.[0]?.message?.content) ? "PASS" : "NO TEXT",
    "tokens:",
    result.usage?.total_tokens || "unreported",
  );
  const { fetchOfficial, parseSnapshot } = await import(
    "../lib/regulatory/fetch"
  );
  const { initialCorpus } = await import("../lib/regulatory/jurisdictions");
  const source = initialCorpus().sources.find((s) => s.id === "CA-hco")!;
  const snapshot = await parseSnapshot(source, await fetchOfficial(source.url));
  console.log(
    "Official source capture: PASS; sections:",
    snapshot.sections.length,
    "relevant links:",
    snapshot.links.length,
  );
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Validation failed");
  process.exitCode = 1;
});
