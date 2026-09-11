import { resolve4 } from "node:dns/promises";
import { BlockList, isIPv4 } from "node:net";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");
export const publicAddress = (ip: string) =>
  isIPv4(ip) && !blocked.check(ip, "ipv4");
export function paperUrl(value: string) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443"].includes(url.port))
  )
    throw Error(
      "Use a public HTTP(S) paper link without credentials or a custom port.",
    );
  return url;
}
async function downloadUnchecked(
  value: string,
  maxBytes = 50 * 1024 * 1024,
  redirects = 0,
): Promise<{ bytes: Buffer; url: string; type: string }> {
  if (redirects > 4) throw Error("Too many paper redirects.");
  const url = paperUrl(value),
    addresses = await resolve4(url.hostname);
  if (!addresses.length || addresses.some((ip) => !publicAddress(ip)))
    throw Error("Paper links must resolve to public internet addresses.");
  const result = await new Promise<{
    bytes: Buffer;
    location?: string;
    type: string;
  }>((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        headers: {
          "User-Agent": "VANI/0.1 (user-requested scholarly download)",
          Accept: "application/pdf,text/html;q=0.9,*/*;q=0.1",
        },
        family: 4,
        lookup: (_host, _options, callback) => callback(null, addresses[0]!, 4),
      },
      (response) => {
        if (
          [301, 302, 303, 307, 308].includes(response.statusCode ?? 0) &&
          response.headers.location
        ) {
          response.resume();
          resolve({
            bytes: Buffer.alloc(0),
            location: response.headers.location,
            type: "",
          });
          return;
        }
        if ((response.statusCode ?? 500) >= 400) {
          response.resume();
          reject(Error("Paper download returned HTTP " + response.statusCode));
          return;
        }
        const type = String(response.headers["content-type"] ?? ""),
          limit = type.includes("text/html")
            ? Math.min(maxBytes, 2 * 1024 * 1024)
            : maxBytes;
        let size = 0;
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > limit) {
            request.destroy(Error("Paper download exceeds the size limit."));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () =>
          resolve({ bytes: Buffer.concat(chunks), type }),
        );
        response.on("error", reject);
      },
    );
    const timer = setTimeout(
      () => request.destroy(Error("Paper download timed out.")),
      20000,
    );
    request.on("close", () => clearTimeout(timer));
    request.on("error", reject);
    request.end();
  });
  if (result.location)
    return downloadPaper(
      new URL(result.location, url).href,
      maxBytes,
      redirects + 1,
    );
  return { ...result, url: url.href };
}
export const isPdf = (bytes: Buffer) =>
  bytes.length > 0 && bytes.subarray(0, 1024).includes(Buffer.from("%PDF-"));
const plain = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]*>/g, " ")
    .trim();
export function pageMetadata(html: string, url: string) {
  const tags = new Map<string, string[]>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs: Record<string, string> = {};
    for (const m of tag.matchAll(
      /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g,
    ))
      attrs[m[1]!.toLowerCase()] = plain(m[2] ?? m[3] ?? m[4] ?? "");
    const key = (attrs.name ?? attrs.property ?? "").toLowerCase();
    if (attrs.content) tags.set(key, [...(tags.get(key) ?? []), attrs.content]);
  }
  const first = (...keys: string[]) =>
    keys.map((k) => tags.get(k)?.[0]).find(Boolean) ?? "";
  const title =
    first("citation_title", "dc.title", "og:title") ||
    plain(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  if (!title)
    throw Object.assign(
      Error("No paper title found. Upload the PDF or use its DOI link."),
      { statusCode: 422 },
    );
  return {
    title: title.slice(0, 2000),
    abstract: first("citation_abstract", "dc.description", "description").slice(
      0,
      30000,
    ),
    doi: first("citation_doi", "dc.identifier").replace(
      /^https?:\/\/(?:dx\.)?doi.org\//i,
      "",
    ),
    authors: (tags.get("citation_author") ?? []).map((family) => ({ family })),
    year:
      Number(
        first("citation_publication_date", "citation_date").match(/\d{4}/)?.[0],
      ) || null,
    pdfUrls: (tags.get("citation_pdf_url") ?? [])
      .map((p) => new URL(p, url).href)
      .slice(0, 5),
  };
}

export async function downloadPaper(
  value: string,
  maxBytes = 50 * 1024 * 1024,
  redirects = 0,
) {
  try {
    return await downloadUnchecked(value, maxBytes, redirects);
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : Error(String(error)), {
      statusCode: 422,
    });
  }
}
