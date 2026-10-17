import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
export class Conflict extends Error {}
export function localMode() {
  return (
    process.env.REGULATORY_LOCAL_DEMO === "true" &&
    process.env.NODE_ENV !== "production"
  );
}
export function configured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
}
export async function supabase(endpoint: string, init: RequestInit = {}) {
  if (!configured())
    throw new Error(
      "Supabase credentials are missing. Configure SUPABASE_URL and SUPABASE_SECRET_KEY.",
    );
  const res = await fetch(
    `${process.env.SUPABASE_URL!.replace(/\/$/, "")}${endpoint}`,
    {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
      headers: {
        apikey: process.env.SUPABASE_SECRET_KEY!,
        "content-type": "application/json",
        ...init.headers,
      },
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (["PGRST205", "PGRST202", "42P01", "42883"].includes(body.code))
      throw new Error(
        "Regulatory migration required: apply supabase/migrations/20261017000007_regulatory.sql.",
      );
    throw new Error(
      `Supabase request failed (${res.status}; ${typeof body.code === "string" ? body.code : "unknown"}).`,
    );
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
const dir = () =>
  process.env.REGULATORY_DATA_DIR ||
  path.join(process.cwd(), "data", "regulatory");
export async function readDoc<T>(
  id: string,
  initial: () => T,
): Promise<{ data: T; revision: number }> {
  if (!localMode()) {
    const rows = await supabase(
      `/rest/v1/reg_documents?id=eq.${encodeURIComponent(id)}&select=body,revision`,
    );
    return rows.length
      ? { data: rows[0].body as T, revision: rows[0].revision }
      : { data: initial(), revision: 0 };
  }
  try {
    return JSON.parse(
      await fs.readFile(
        path.join(dir(), encodeURIComponent(id) + ".json"),
        "utf8",
      ),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return { data: initial(), revision: 0 };
  }
}
export async function writeDoc<T>(id: string, data: T, revision: number) {
  if (!localMode()) {
    const next = await supabase("/rest/v1/rpc/reg_compare_and_swap", {
      method: "POST",
      body: JSON.stringify({ p_id: id, p_body: data, p_revision: revision }),
    });
    if (next === null)
      throw new Conflict("Concurrent update. Reload and retry.");
    return;
  }
  await fs.mkdir(dir(), { recursive: true });
  const lock = path.join(dir(), encodeURIComponent(id) + ".lock");
  let handle;
  try {
    handle = await fs.open(lock, "wx");
  } catch {
    throw new Conflict("Another local write is in progress. Retry.");
  }
  try {
    const current = await readDoc(id, () => null);
    if (current.revision !== revision)
      throw new Conflict("Concurrent update. Reload and retry.");
    const temp = path.join(dir(), randomUUID() + ".tmp");
    await fs.writeFile(temp, JSON.stringify({ data, revision: revision + 1 }));
    await fs.rename(temp, path.join(dir(), encodeURIComponent(id) + ".json"));
  } finally {
    await handle.close();
    await fs.unlink(lock);
  }
}
export async function mutate<T, R>(
  id: string,
  initial: () => T,
  fn: (data: T) => R,
) {
  for (let n = 0; n < 5; n++) {
    const doc = await readDoc(id, initial);
    const result = fn(doc.data);
    try {
      await writeDoc(id, doc.data, doc.revision);
      return result;
    } catch (e) {
      if (!(e instanceof Conflict) || n === 4) throw e;
      await new Promise((r) => setTimeout(r, 25 * (n + 1)));
    }
  }
  throw new Error("Write contention");
}
export async function saveImmutable(id: string, body: unknown) {
  const current = await readDoc<unknown>(id, () => null);
  if (current.revision === 0) {
    try {
      await writeDoc(id, body, 0);
    } catch (e) {
      if (!(e instanceof Conflict)) throw e;
    }
  }
}

// Enumerate agency document IDs for background alert fan-out. No worker data is returned here.
export async function agencyDocumentIds(): Promise<string[]> {
  if (localMode()) {
    try {
      return (await fs.readdir(dir()))
        .filter((f) => f.endsWith(".json"))
        .map((f) => decodeURIComponent(f.slice(0, -5)))
        .filter((id) => id.startsWith("reg:agency:"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
  }
  const ids: string[] = [];
  for (let offset = 0; ; offset += 500) {
    const rows = await supabase(
      `/rest/v1/reg_documents?id=like.reg%3Aagency%3A*&select=id&order=id&offset=${offset}&limit=500`,
    );
    ids.push(...rows.map((r: { id: string }) => r.id));
    if (rows.length < 500) return ids;
  }
}
