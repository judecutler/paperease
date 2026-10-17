import https from "node:https";
import dns from "node:dns/promises";
import net from "node:net";
import { createHash } from "node:crypto";
import { gunzipSync, brotliDecompressSync, inflateSync } from "node:zlib";
import * as cheerio from "cheerio";
import { officialHosts } from "./jurisdictions";
import type { Snapshot, Section, Source } from "./types";
const MAX = 4 * 1024 * 1024;
export const hash = (s: string | Buffer) =>
  createHash("sha256").update(s).digest("hex");
export function publicIP(ip: string) {
  if (net.isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  // Only public global-unicast IPv6; reject mapped IPv4 and local/link-local ranges.
  return (
    net.isIP(ip) === 6 &&
    /^[23][0-9a-f]{3}:/i.test(ip) &&
    !ip.toLowerCase().startsWith("2001:db8:")
  );
}
export function officialURL(value: string) {
  const u = new URL(value);
  const host = u.hostname.toLowerCase();
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443") ||
    net.isIP(host) ||
    !(
      host.endsWith(".gov") ||
      officialHosts.has(host) ||
      officialHosts.has(host.replace(/^www\./, ""))
    )
  )
    throw new Error(
      "Use a reviewed official HTTPS government or regulator URL.",
    );
  u.hash = "";
  return u;
}
export async function fetchOfficial(
  value: string,
  headers: Record<string, string> = {},
  hops = 0,
): Promise<{
  bytes: Buffer;
  type: string;
  url: string;
  etag?: string;
  modified?: string;
  notModified?: boolean;
}> {
  if (hops > 4) throw new Error("Too many redirects.");
  const u = officialURL(value);
  const addresses = await dns.lookup(u.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !publicIP(a.address)))
    throw new Error("Source resolves to a non-public address.");
  const address = addresses[0];
  return new Promise((resolve, reject) => {
    const req = https.request(
      u,
      {
        headers: {
          "user-agent": "PaperEase-RegulatoryWatch/1.0",
          accept: "text/html,application/pdf,text/plain",
          "accept-encoding": "identity",
          ...headers,
        },
        lookup: ((
          _h: unknown,
          options: { all?: boolean },
          cb: (e: null, a: unknown, f?: number) => void,
        ) =>
          options.all
            ? cb(null, [address])
            : cb(null, address.address, address.family)) as never,
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          fetchOfficial(
            new URL(res.headers.location, u).href,
            {},
            hops + 1,
          ).then(resolve, reject);
          return;
        }
        if (status === 304) {
          res.resume();
          resolve({
            bytes: Buffer.alloc(0),
            type: "",
            url: u.href,
            notModified: true,
          });
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(new Error(`Official source HTTP ${status}`));
          return;
        }
        if (Number(res.headers["content-length"] || 0) > MAX) {
          res.destroy();
          reject(new Error("Source exceeds 4 MB."));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (b: Buffer) => {
          size += b.length;
          if (size > MAX) {
            res.destroy(new Error("Source exceeds 4 MB."));
            return;
          }
          chunks.push(b);
        });
        res.on("error", reject);
        res.on("end", () => {
          try {
            let bytes = Buffer.concat(chunks);
            const enc = res.headers["content-encoding"];
            if (enc === "gzip")
              bytes = gunzipSync(bytes, { maxOutputLength: MAX });
            if (enc === "br")
              bytes = brotliDecompressSync(bytes, { maxOutputLength: MAX });
            if (enc === "deflate")
              bytes = inflateSync(bytes, { maxOutputLength: MAX });
            resolve({
              bytes,
              type: String(res.headers["content-type"] || ""),
              url: u.href,
              etag: res.headers.etag,
              modified: res.headers["last-modified"],
            });
          } catch {
            reject(new Error("Source decompression failed or exceeded limit."));
          }
        });
      },
    );
    req.setTimeout(25000, () =>
      req.destroy(new Error("Official source timed out.")),
    );
    req.on("error", reject);
    req.end();
  });
}
export const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
export async function parseSnapshot(
  source: Source,
  fetched: Awaited<ReturnType<typeof fetchOfficial>>,
): Promise<Snapshot> {
  const { bytes, type, url } = fetched;
  const sections: Section[] = [];
  const links: Snapshot["links"] = [];
  let truncated = false;
  if (type.includes("pdf") || bytes.subarray(0, 4).toString() === "%PDF") {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: true,
    });
    const doc = await task.promise;
    try {
      truncated = doc.numPages > 200;
      for (let n = 1; n <= Math.min(doc.numPages, 200); n++) {
        const page = await doc.getPage(n);
        const content = await page.getTextContent();
        sections.push({
          index: n - 1,
          label: `PDF page ${n}`,
          text: normalize(
            content.items.map((i) => ("str" in i ? i.str : "")).join(" "),
          ),
        });
      }
    } finally {
      await task.destroy();
    }
  } else if (type.includes("html")) {
    const $ = cheerio.load(bytes.toString("utf8"));
    const title = normalize($("title").text());
    const opening = normalize(
      $("h1").first().text() + " " + $("body").text().slice(0, 2200),
    );
    if (
      /^(access denied|request access|just a moment|attention required|page not found|404)/i.test(
        title,
      ) ||
      /your request has been flagged as potentially automated|please complete the captcha|access to this page has been denied|verify you are human|checking your browser|programmatic access to these sites is limited/i.test(
        opening,
      )
    )
      throw new Error(
        "Source returned an access-block or challenge page, not regulatory text.",
      );

    $("a[href]").each((_i, el) => {
      try {
        const target = officialURL(new URL($(el).attr("href")!, url).href);
        const title = normalize($(el).text());
        if (
          title &&
          /home.?care|home.?health|nurs|regulat|statut|practice act|administrative code/i.test(
            title,
          ) &&
          !links.some((l) => l.url === target.href)
        )
          links.push({ url: target.href, title: title.slice(0, 200) });
      } catch {}
    });
    $(
      "script,style,nav,header,footer,noscript,svg,input,button,select,textarea",
    ).remove();
    const root =
      [
        "main",
        "[role=main]",
        "#main-content",
        ".main-primary",
        "#content",
        "body",
      ]
        .map((selector) => $(selector).first())
        .find((node) => normalize(node.text()).length >= 100) || $("body");
    const text = normalize(root.text());
    for (let pos = 0; pos < Math.min(text.length, 500000); pos += 10000)
      sections.push({
        index: sections.length,
        label: `Text block ${sections.length + 1}`,
        text: text.slice(pos, pos + 10000),
      });
    truncated = text.length > 500000;
  } else if (type.includes("text/plain")) {
    const text = normalize(bytes.toString("utf8"));
    truncated = text.length > 500000;
    for (let n = 0; n < Math.min(text.length, 500000); n += 10000)
      sections.push({
        index: sections.length,
        label: `Text block ${sections.length + 1}`,
        text: text.slice(n, n + 10000),
      });
  } else throw new Error("Unsupported source format. Use HTML, text or PDF.");
  if (normalize(sections.map((s) => s.text).join(" ")).length < 100)
    throw new Error(
      "No readable legal text. Scanned PDF may require OCR or a different official source.",
    );
  const textHash = hash(sections.map((s) => s.text).join("\n"));
  return {
    id: `snapshot:${source.id}:${hash(bytes)}`,
    sourceId: source.id,
    url,
    fetchedAt: new Date().toISOString(),
    hash: hash(bytes),
    textHash,
    sections,
    rawBase64: bytes.toString("base64"),
    contentType: type,
    links: links.slice(0, 80),
    truncated,
  };
}
