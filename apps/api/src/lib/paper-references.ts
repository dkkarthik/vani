import { paperReference, type PaperReference } from "@vani/shared";
import { pool } from "../db.js";

/** Read-only, batched metadata lookup; opening a collection never starts enrichment. */
export async function paperReferences(
  papers: Array<{ paper: any; workId?: string | null }>,
): Promise<PaperReference[]> {
  const ids = [...new Set(papers.flatMap((p) => (p.workId ? [p.workId] : [])))];
  const records = ids.length
    ? (
        await pool.query(
          `SELECT requested.id, sources.payloads, files.attachments
     FROM unnest($1::uuid[]) requested(id)
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(s.payload ORDER BY s.retrieved_at DESC) payloads
       FROM source_record s WHERE canonical_work(s.work_id)=canonical_work(requested.id)
     ) sources ON true
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(jsonb_build_object('id',a.id) ORDER BY a.created_at DESC,a.id) attachments
       FROM attachment a JOIN object_store o ON o.hash_sha256=a.object_hash
       WHERE canonical_work(a.work_id)=canonical_work(requested.id)
         AND a.attachment_type='paper' AND o.mime_type='application/pdf'
     ) files ON true`,
          [ids],
        )
      ).rows
    : [];
  const byId = new Map(records.map((r) => [r.id, r]));
  return papers.map(({ paper, workId }) => {
    const row = workId ? byId.get(workId) : undefined;
    const reference = paperReference(paper, row?.payloads ?? []);
    reference.pdfLinks.unshift(
      ...(row?.attachments ?? []).map((a: { id: string }) => ({
        url: `/api/v1/attachments/${a.id}/content`,
        kind: "local" as const,
      })),
    );
    return reference;
  });
}
