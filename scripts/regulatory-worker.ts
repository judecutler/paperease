import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
// --once performs one bounded stage. Persistent mode handles scheduled due work and resumes jobs.
async function main() {
  const { tick } = await import("../lib/regulatory/service");
  const once = process.argv.includes("--once");
  let stopping = false;
  process.on("SIGTERM", () => {
    stopping = true;
  });
  process.on("SIGINT", () => {
    stopping = true;
  });
  do {
    try {
      const result = await tick();
      console.log(JSON.stringify({ at: new Date().toISOString(), ...result }));
      if (!once && !stopping)
        await new Promise((r) =>
          setTimeout(r, result.processed ? 2000 : 30000),
        );
    } catch (e) {
      console.error(e instanceof Error ? e.message : "Worker failed");
      if (once) throw e;
      await new Promise((r) => setTimeout(r, 30000));
    }
  } while (!once && !stopping);
}
main().catch(() => {
  process.exitCode = 1;
});
