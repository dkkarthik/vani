import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import { config } from './config.js';
import { discover } from './connectors.js';
import { query } from './db.js';
import { ObjectStore } from './object-store.js';
import { Repository } from './repository.js';
import { answerQuestion } from './ask.js';

const Id = z.string().uuid();
const workInput = z.object({ title: z.string().min(1), abstract: z.string().optional(), year: z.number().int().min(1000).max(3000).nullable().optional(),
  venue: z.string().optional(), doi: z.string().nullable().optional(), authors: z.array(z.object({ given: z.string().optional(), family: z.string().min(1), orcid: z.string().nullable().optional() })).optional(),
  verificationStatus: z.enum(['unverified','partial','verified','verified_multi_source','conflict']).optional(), manifestationType: z.string().optional(), accessClass: z.string().optional() });

export async function registerRoutes(app: FastifyInstance, repository: Repository) {
  const objects = new ObjectStore();

  app.get('/api/v1/health', async () => ({ status: 'ok', version: '0.1.0', databaseTime: (await repository.health()).toISOString() }));
  app.get('/api/v1/capabilities', async () => ({ version: '0.1.0', connectors: ['openalex','crossref'], graph: true, pdf: true,
    localAsk: true, remoteAsk: Boolean(config.openAiKey), demoMode: config.demoMode }));

  app.get('/api/v1/works', async (request) => {
    const params = z.object({ q: z.string().optional(), collectionId: z.string().uuid().optional(), limit: z.coerce.number().optional() }).parse(request.query);
    return { items: await repository.listWorks(params) };
  });
  app.post('/api/v1/works', async (request, reply) => reply.code(201).send(await repository.createWork(workInput.parse(request.body))));
  app.get('/api/v1/works/:id', async (request, reply) => {
    const id = Id.parse((request.params as any).id); const work = await repository.getWork(id);
    return work ?? reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Work not found', retryable: false, request_id: request.id } });
  });

  app.get('/api/v1/collections', async () => ({ items: await repository.listCollections() }));
  app.post('/api/v1/collections', async (request, reply) => {
    const input = z.object({ name: z.string().min(1), description: z.string().optional(), parentId: z.string().uuid().nullable().optional() }).parse(request.body);
    return reply.code(201).send(await repository.createCollection(input));
  });
  app.get('/api/v1/collections/:id/members', async (request) => ({ items: await repository.listWorks({ collectionId: Id.parse((request.params as any).id) }) }));
  app.post('/api/v1/collections/:id/members', async (request) => {
    const id = Id.parse((request.params as any).id); const { workIds } = z.object({ workIds: z.array(z.string().uuid()).min(1) }).parse(request.body);
    return { items: await repository.addToCollection(id, workIds) };
  });
  app.patch('/api/v1/collections/:id/members/:workId', async (request, reply) => {
    const params = z.object({ id: z.string().uuid(), workId: z.string().uuid() }).parse(request.params);
    const { status } = z.object({ status: z.enum(['inbox','to_read','skimming','reading','read','foundational','cited','rejected','archived']) }).parse(request.body);
    await repository.updateMembership(params.id, params.workId, status); return reply.code(204).send();
  });
  app.post('/api/v1/collections/:id/exports', async (request, reply) => {
    const id = Id.parse((request.params as any).id); z.object({ format: z.enum(['bibtex']).default('bibtex') }).parse(request.body ?? {});
    const bib = await repository.exportBibtex(id); return reply.header('content-type','application/x-bibtex').header('content-disposition',`attachment; filename="vani-${id}.bib"`).send(bib);
  });

  app.post('/api/v1/search', async (request) => {
    const input = z.object({ query: z.string().min(1), scope: z.object({ collectionId: z.string().uuid().optional() }).optional() }).parse(request.body);
    return { items: await repository.search(input.query, input.scope?.collectionId) };
  });

  app.post('/api/v1/discover', async (request) => {
    const input = z.object({ query: z.string().min(2), sources: z.array(z.enum(['openalex','crossref'])).default(['openalex','crossref']) }).parse(request.body);
    return { items: await discover(input.query, input.sources, config.openAlexEmail) };
  });
  app.post('/api/v1/discover/import', async (request, reply) => {
    const input = workInput.extend({ connector: z.string(), externalId: z.string(), sourcePayload: z.unknown() }).parse(request.body);
    return reply.code(201).send(await repository.createWork(input));
  });

  app.post('/api/v1/graph/neighborhood', async (request) => {
    const input = z.object({ collectionId: z.string().uuid().optional(), workId: z.string().uuid().optional(), limit: z.number().int().min(1).max(500).default(200) }).parse(request.body ?? {});
    return repository.graph(input.collectionId, input.workId, input.limit);
  });
  app.post('/api/v1/relationships', async (request, reply) => {
    const input = z.object({ sourceId: z.string().uuid(), targetId: z.string().uuid(), predicate: z.enum(['semantically_similar','cites','cited_by','co_cited','bibliographic_coupling','uses_as_baseline','compares_against','evaluates_on','uses_method','extends','contradicts']),
      confidence: z.number().min(0).max(1), verificationStatus: z.enum(['inferred','verified','rejected']), evidence: z.array(z.object({ exactText: z.string(), page: z.number().optional(), section: z.string().optional() })).optional() }).parse(request.body);
    return reply.code(201).send({ id: await repository.createRelationship(input) });
  });

  app.get('/api/v1/notes', async (request) => {
    const input = z.object({ collectionId: z.string().uuid().optional(), workId: z.string().uuid().optional() }).parse(request.query);
    return { items: await repository.listNotes(input.collectionId, input.workId) };
  });
  app.post('/api/v1/notes', async (request, reply) => {
    const input = z.object({ title: z.string().min(1), markdown: z.string().optional(), noteType: z.string().optional(), collectionId: z.string().uuid().optional(), workId: z.string().uuid().optional() }).parse(request.body);
    return reply.code(201).send(await repository.createNote(input));
  });

  app.post('/api/v1/objects', async (request, reply) => {
    const file = await request.file({ limits: { fileSize: 100 * 1024 * 1024, files: 1 } });
    if (!file) return reply.code(400).send({ error: { code: 'VALIDATION', message: 'A file is required', retryable: false, request_id: request.id } });
    const data = await file.toBuffer(); const stored = await objects.put(data, file.mimetype);
    return reply.code(201).send({ ...stored, filename: file.filename });
  });
  app.post('/api/v1/works/:id/attachments', async (request, reply) => {
    const workId = Id.parse((request.params as any).id); const file = await request.file({ limits: { fileSize: 100 * 1024 * 1024, files: 1 } });
    if (!file) return reply.code(400).send({ error: { code: 'VALIDATION', message: 'A PDF is required', retryable: false, request_id: request.id } });
    if (file.mimetype !== 'application/pdf') return reply.code(415).send({ error: { code: 'VALIDATION', message: 'Only PDF attachments are accepted', retryable: false, request_id: request.id } });
    const stored = await objects.put(await file.toBuffer(), file.mimetype); const id = uuidv7();
    await query('INSERT INTO attachment(id,work_id,object_hash,filename) VALUES($1,$2,$3,$4)', [id, workId, stored.hash, file.filename]);
    return reply.code(201).send({ id, workId, objectHash: stored.hash, filename: file.filename });
  });
  app.get('/api/v1/works/:id/attachments', async (request) => {
    const workId = Id.parse((request.params as any).id);
    const result = await query<any>(`SELECT a.id,a.work_id,a.object_hash,a.filename,a.attachment_type,a.access_class,a.created_at,
      o.byte_size,o.mime_type FROM attachment a JOIN object_store o ON o.hash_sha256=a.object_hash
      WHERE a.work_id=$1 ORDER BY a.created_at DESC`, [workId]);
    return { items: result.rows };
  });
  app.get('/api/v1/attachments/:id/content', async (request, reply) => {
    const result = await query<any>(`SELECT o.storage_path,o.mime_type,a.filename FROM attachment a JOIN object_store o ON o.hash_sha256=a.object_hash WHERE a.id=$1`, [Id.parse((request.params as any).id)]);
    if (!result.rows[0]) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Attachment not found', retryable: false, request_id: request.id } });
    return reply.type(result.rows[0].mime_type).header('content-disposition', `inline; filename="${result.rows[0].filename.replace(/["\r\n]/g,'')}"`).send(createReadStream(result.rows[0].storage_path));
  });

  app.post('/api/v1/conversations', async (request, reply) => {
    const input = z.object({ collectionId: z.string().uuid().optional(), title: z.string().optional(), scope: z.record(z.string(),z.unknown()).optional() }).parse(request.body ?? {});
    const id = uuidv7(); await query('INSERT INTO conversation(id,collection_id,title,scope) VALUES($1,$2,$3,$4)', [id,input.collectionId ?? null,input.title ?? 'New conversation',JSON.stringify(input.scope ?? {})]);
    return reply.code(201).send({ id, ...input, createdAt: new Date().toISOString() });
  });
  app.post('/api/v1/conversations/:id/messages', async (request, reply) => {
    const conversationId = Id.parse((request.params as any).id);
    const input = z.object({ question: z.string().min(2), scope: z.object({ type: z.string().default('collection'), ids: z.array(z.string().uuid()).optional(), collectionId: z.string().uuid().optional() }).optional(), include: z.object({ notes: z.boolean().default(true), reviews: z.boolean().default(true), externalSearch: z.boolean().default(false) }).optional() }).parse(request.body);
    const works = input.scope?.ids ? (await Promise.all(input.scope.ids.map((id) => repository.getWork(id)))).filter(Boolean) as any[] : await repository.listWorks({ collectionId: input.scope?.collectionId, limit: 100 });
    const notes = input.include?.notes === false ? [] : await repository.listNotes(input.scope?.collectionId);
    const answer = await answerQuestion(input.question, works, notes);
    await query(`INSERT INTO answer(id,conversation_id,question,markdown,status,claims,limitations,model_provenance,scope_snapshot)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [answer.id,conversationId,input.question,answer.markdown,answer.status,JSON.stringify(answer.claims),JSON.stringify(answer.limitations),JSON.stringify(answer.modelProvenance),JSON.stringify(input.scope ?? {})]);
    return reply.code(201).send(answer);
  });
}
