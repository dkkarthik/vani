import { v7 as uuid } from "uuid";
import { downloadPaper } from "../ingestion/download.js";
import { pool } from "../db.js";
import { enqueueCore } from "./service.js";
import { hash } from "./algorithm.js";
export function articleLeads(html: string, base: string) {
  const clean = html.replace(/<(script|style|nav)\b[\s\S]*?<\/\1>/gi, "");
  const links = [...clean.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].flatMap(
    (m) => {
      try {
        return [new URL(m[1]!, base).href];
      } catch {
        return [];
      }
    },
  );
  const dois = [
    ...new Set(
      links.flatMap((link) => {
        const m = link.match(
          /^https?:\/\/(?:dx\.)?doi.org\/(10\.\d{4,9}\/[^\s?#]+)/i,
        );
        return m ? [decodeURIComponent(m[1]!)] : [];
      }),
    ),
  ];
  const arxiv = [
    ...new Set(
      links.flatMap((link) => {
        const m = link.match(
          /^https?:\/\/(?:www\.)?arxiv.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})(?:v\d+)?/i,
        );
        return m ? ["10.48550/arXiv." + m[1]] : [];
      }),
    ),
  ];
  return {
    dois: [...dois, ...arxiv].slice(0, 100),
    omitted: Math.max(0, dois.length + arxiv.length - 100),
    text: clean
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, 20000),
  };
}
export async function importArticle(collectionId: string, url: string) {
  const downloaded = await downloadPaper(url, 2 * 1024 * 1024);
  if (!downloaded.type.includes("text/html"))
    throw Object.assign(Error("Provide a public HTML research article."), {
      statusCode: 422,
    });
  const leads = articleLeads(downloaded.bytes.toString("utf8"), downloaded.url),
    family = hash(downloaded.url);
  const run = await enqueueCore(collectionId);
  const record = {
    id: uuid(),
    url: downloaded.url,
    hash: hash(downloaded.bytes.toString("utf8")),
    text: leads.text,
    leads: leads.dois,
    evidenceFamily: family,
    authority: "discovery lead; primary papers must be read independently",
  };
  await pool.query(
    "UPDATE core_run SET frontier=frontier||$2::jsonb,coverage=coverage||$3::jsonb,phase='discovery',status='queued' WHERE id=$1",
    [
      run.id,
      JSON.stringify(
        leads.dois.map((query) => ({
          source: "anchor",
          query,
          cursor: "*",
          pages: 0,
          discoveredVia: record.id,
          evidenceFamily: family,
        })),
      ),
      JSON.stringify([
        {
          source: "article",
          state: "complete",
          returned: leads.dois.length,
          omitted: leads.omitted,
          record,
        },
      ]),
    ],
  );
  return { runId: run.id, article: record, primaryLeads: leads.dois.length };
}
