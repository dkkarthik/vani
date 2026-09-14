import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { v7 as uuid } from "uuid";
import { pool, transaction } from "../db.js";
import { Repository } from "../repository.js";
import { evidenceSnapshot } from "../planning/insights.js";
import { answerQuestion } from "../ask.js";
import { lexical } from "./algorithm.js";
const running = new Map<string, AbortController>();
const Id = z.string().uuid();
const wire = (row: any) => ({
  id: row.id,
  status: row.status,
  markdown: row.markdown,
  claims: row.claims,
  limitations: row.limitations,
  modelProvenance: row.model_provenance,
  createdAt: row.created_at,
});
export async function registerConversations(
  app: FastifyInstance,
  repo: Repository,
) {
  app.post("/api/v1/conversations", async (r, reply) => {
    const d = z
      .object({
        collectionId: Id.optional(),
        title: z.string().max(300).default("Local collection conversation"),
      })
      .parse(r.body ?? {});
    if (
      d.collectionId &&
      !(
        await pool.query(
          "SELECT 1 FROM collection WHERE id=$1 AND deleted_at IS NULL",
          [d.collectionId],
        )
      ).rowCount
    )
      throw Object.assign(Error("Collection not found."), { statusCode: 404 });
    const id = uuid();
    await pool.query(
      "INSERT INTO conversation(id,collection_id,title,scope) VALUES($1,$2,$3,$4)",
      [
        id,
        d.collectionId ?? null,
        d.title,
        JSON.stringify({ collectionId: d.collectionId }),
      ],
    );
    return reply.code(201).send({ id, ...d });
  });
  app.get("/api/v1/conversations/:id/messages", async (r) => ({
    items: (
      await pool.query(
        "SELECT * FROM answer WHERE conversation_id=$1 ORDER BY created_at",
        [Id.parse((r.params as any).id)],
      )
    ).rows.map((row) => ({ question: row.question, answer: wire(row) })),
  }));
  app.post("/api/v1/conversations/:id/cancel", async (r) => {
    const id = Id.parse((r.params as any).id),
      d = z.object({ requestKey: Id }).parse(r.body);
    running.get(id + ":" + d.requestKey)?.abort();
    return { status: "cancellation_requested" };
  });
  app.post("/api/v1/conversations/:id/messages", async (r, reply) => {
    const id = Id.parse((r.params as any).id),
      d = z
        .object({
          question: z.string().trim().min(2).max(2000),
          requestKey: Id.default(() => uuid()),
          extractive: z.boolean().default(false),
          scope: z
            .object({
              type: z.string().optional(),
              collectionId: Id.optional(),
              ids: z.array(Id).max(100).optional(),
            })
            .optional(),
          include: z
            .object({
              notes: z.boolean().default(true),
              reviews: z.boolean().optional(),
              externalSearch: z.boolean().default(false),
            })
            .optional(),
        })
        .parse(r.body);
    const conversation = (
      await pool.query("SELECT * FROM conversation WHERE id=$1", [id])
    ).rows[0];
    if (!conversation)
      throw Object.assign(Error("Conversation not found."), {
        statusCode: 404,
      });
    const collectionId = conversation.collection_id ?? undefined;
    if (
      d.scope?.collectionId &&
      d.scope.collectionId !== conversation.collection_id
    )
      throw Object.assign(
        Error("Conversation collection scope cannot be widened or changed."),
        { statusCode: 400 },
      );
    if (d.include?.externalSearch)
      throw Object.assign(
        Error("Collection conversations use saved local evidence only."),
        { statusCode: 400 },
      );
    const selected = d.scope?.ids?.length ? d.scope.ids : null;
    const rows = (
      await pool.query(
        `SELECT w.id FROM work w WHERE w.deleted_at IS NULL AND w.merged_into IS NULL AND ($2::uuid IS NULL OR EXISTS(SELECT 1 FROM collection_membership m WHERE m.work_id=w.id AND m.collection_id=$2)) AND ($3::uuid[] IS NULL OR w.id=ANY($3)) ORDER BY ts_rank_cd(w.search_vector,websearch_to_tsquery('english',$1)) DESC,w.id LIMIT 100`,
        [d.question, collectionId ?? null, selected],
      )
    ).rows;
    if (selected && rows.length !== new Set(selected).size)
      throw Object.assign(
        Error("Selected papers are outside this conversation scope."),
        { statusCode: 400 },
      );
    const works = (
      await Promise.all(rows.map((row) => repo.getWork(row.id)))
    ).filter((w): w is NonNullable<typeof w> => Boolean(w));
    const notes =
      d.include?.notes === false
        ? []
        : (await repo.listNotes(collectionId)).filter(
            (n: any) => !selected || selected.includes(n.workId),
          );
    const requestScope = {
      collectionId,
      selected,
      extractive: d.extractive,
      includeNotes: d.include?.notes !== false,
    };
    const prior = (
      await pool.query(
        "SELECT * FROM conversation_request WHERE conversation_id=$1 AND request_key=$2",
        [id, d.requestKey],
      )
    ).rows[0];
    if (
      prior &&
      (prior.question !== d.question ||
        prior.scope.collectionId !== collectionId ||
        JSON.stringify(prior.scope.selected) !== JSON.stringify(selected) ||
        prior.scope.extractive !== d.extractive ||
        prior.scope.includeNotes !== (d.include?.notes !== false))
    )
      throw Object.assign(
        Error("Request key belongs to a different question."),
        { statusCode: 409 },
      );
    if (prior?.answer_id)
      return reply
        .code(200)
        .send(
          wire(
            (
              await pool.query("SELECT * FROM answer WHERE id=$1", [
                prior.answer_id,
              ])
            ).rows[0],
          ),
        );
    const key = id + ":" + d.requestKey;
    if (running.has(key))
      throw Object.assign(Error("This question is already generating."), {
        statusCode: 409,
      });
    const claimed = await pool.query(
      "INSERT INTO conversation_request(conversation_id,request_key,question,scope,status) VALUES($1,$2,$3,$4,'running') ON CONFLICT(conversation_id,request_key) DO UPDATE SET status='running',updated_at=now() WHERE conversation_request.status<>'running' OR conversation_request.updated_at<now()-interval '10 minutes' RETURNING request_key",
      [id, d.requestKey, d.question, JSON.stringify(requestScope)],
    );
    if (!claimed.rowCount)
      throw Object.assign(Error("This question is already generating."), {
        statusCode: 409,
      });
    const controller = new AbortController();
    running.set(key, controller);
    try {
      const history = (
        await pool.query(
          "SELECT question,markdown,claims FROM answer WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT 6",
          [id],
        )
      ).rows.reverse();
      const retrievalQuery =
        d.question +
        " " +
        history
          .slice(-2)
          .map((x) => x.question)
          .join(" ");
      const ranked = [...works]
        .sort(
          (a, b) =>
            lexical(retrievalQuery, b.title + " " + b.abstract) -
            lexical(retrievalQuery, a.title + " " + a.abstract),
        )
        .slice(0, 12);
      const snap = await evidenceSnapshot(
        ranked.map((w) => w.id),
        notes.slice(0, 10).map((n: any) => n.id),
      );
      const assessments = collectionId
        ? (
            await pool.query(
              "SELECT c.id,c.work_id,c.assessment,c.stage,c.focus_version FROM core_candidate c JOIN core_focus f ON f.collection_id=c.collection_id WHERE c.collection_id=$1 AND c.work_id=ANY($2::uuid[]) AND c.focus_version=f.version AND c.state<>'stale' ORDER BY c.updated_at DESC LIMIT 12",
              [collectionId, ranked.map((w) => w.id)],
            )
          ).rows
        : [];
      for (const a of assessments)
        snap.sources.push({
          id: a.id,
          workId: a.work_id,
          kind: "stored_assessment",
          label: "VANI assessment · " + a.stage,
          text: JSON.stringify(a.assessment),
          url: "/collections",
        });
      let budget = 28000;
      const sources = [...snap.sources]
        .sort(
          (a, b) =>
            lexical(retrievalQuery, b.text) - lexical(retrievalQuery, a.text),
        )
        .flatMap((s) => {
          const text = s.text.slice(0, Math.min(4000, budget));
          budget -= text.length;
          return text ? [{ ...s, text }] : [];
        });
      const answer = await answerQuestion(d.question, ranked, notes, {
        collectionId,
        sources,
        history: history.map((h) => ({
          question: h.question,
          answer: h.markdown.slice(0, 700),
        })),
        signal: controller.signal,
        extractive: d.extractive,
      });
      await transaction(async (db) => {
        await db.query(
          "INSERT INTO answer(id,conversation_id,question,markdown,status,claims,limitations,model_provenance,scope_snapshot,request_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [
            answer.id,
            id,
            d.question,
            answer.markdown,
            answer.status,
            JSON.stringify(answer.claims),
            JSON.stringify(answer.limitations),
            JSON.stringify(answer.modelProvenance),
            JSON.stringify({
              collectionId,
              workIds: ranked.map((w) => w.id),
              sources,
            }),
            d.requestKey,
          ],
        );
        await db.query(
          "UPDATE conversation_request SET answer_id=$3,status=$4,updated_at=now() WHERE conversation_id=$1 AND request_key=$2",
          [id, d.requestKey, answer.id, answer.status],
        );
      });
      return reply.code(201).send(answer);
    } catch (e) {
      await pool.query(
        "UPDATE conversation_request SET status='failed',error='Local request failed',updated_at=now() WHERE conversation_id=$1 AND request_key=$2",
        [id, d.requestKey],
      );
      throw e;
    } finally {
      running.delete(key);
    }
  });
}
