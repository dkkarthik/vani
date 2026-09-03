import { v7 as uuidv7 } from 'uuid';
import type { Collection, GraphProjection, Relationship, Work, WorkStatus } from '@vani/shared';
import { pool, query, transaction } from './db.js';
import { cleanDoi, makeCitationKey, normalizeTitle, toBibtex, venueAbbreviation } from './lib/citations.js';

type WorkRow = {
  id: string; title: string; abstract: string; year: number | null; venue: string | null;
  venue_abbreviation: string | null; doi: string | null; citation_key: string;
  manifestation_type: string; verification_status: Work['verificationStatus']; access_class: string;
  authors: Array<{ id: string; given: string; family: string; orcid?: string | null }> | null;
  source_metadata: Record<string, any>;
  created_at: Date; updated_at: Date;
};

const workSelect = `
  SELECT w.id, w.title, w.abstract, w.year, w.doi, w.citation_key, w.manifestation_type,
    w.verification_status, w.access_class, w.created_at, w.updated_at,
    w.source_metadata,
    v.canonical_name AS venue, v.abbreviation AS venue_abbreviation,
    COALESCE(jsonb_agg(jsonb_build_object('id', p.id, 'given', p.given_names, 'family', p.family_name, 'orcid', p.orcid)
      ORDER BY a.position) FILTER (WHERE p.id IS NOT NULL), '[]') AS authors
  FROM work w LEFT JOIN venue v ON v.id = w.venue_id
  LEFT JOIN authorship a ON a.work_id = w.id LEFT JOIN person p ON p.id = a.person_id`;

const rowToWork = (row: WorkRow): Work => ({
  id: row.id, title: row.title, abstract: row.abstract, year: row.year,
  venue: row.venue ?? '', venueAbbreviation: row.venue_abbreviation ?? 'misc', doi: row.doi,
  citationKey: row.citation_key, authors: row.authors ?? [], verificationStatus: row.verification_status,
  publisher: row.source_metadata?.publisher ?? '', publicationPlace: row.source_metadata?.publicationPlace ?? '',
  publicationDate: row.source_metadata?.publicationDate ?? '', volume: row.source_metadata?.volume ?? '',
  issue: row.source_metadata?.issue ?? '', pages: row.source_metadata?.pages ?? '',
  affiliations: row.source_metadata?.affiliations ?? [], salientContribution: row.source_metadata?.salientContribution ?? '',
  recordKind: row.source_metadata?.recordKind ?? 'scholarly_record',
  manifestationType: row.manifestation_type, accessClass: row.access_class,
  createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString()
});

export interface WorkInput {
  title: string; abstract?: string; year?: number | null; venue?: string; doi?: string | null;
  authors?: Array<{ given?: string; family: string; orcid?: string | null }>;
  verificationStatus?: Work['verificationStatus']; manifestationType?: string; accessClass?: string;
  publisher?: string; publicationPlace?: string; publicationDate?: string; volume?: string; issue?: string; pages?: string;
  affiliations?: Array<{ name: string; place?: string }>; salientContribution?: string; recordKind?: 'scholarly_record' | 'demo_fixture';
  connector?: string; externalId?: string; sourcePayload?: unknown;
}

export class Repository {
  async health() { const result = await query<{ now: Date }>('SELECT now()'); return result.rows[0]!.now; }

  async listWorks({ q = '', collectionId, limit = 100 }: { q?: string; collectionId?: string; limit?: number } = {}) {
    const values: unknown[] = [];
    const where = ['w.deleted_at IS NULL'];
    let join = '';
    if (collectionId) { values.push(collectionId); join = 'JOIN collection_membership cm_filter ON cm_filter.work_id = w.id'; where.push(`cm_filter.collection_id = $${values.length}`); }
    if (q) { values.push(q); where.push(`(w.search_vector @@ websearch_to_tsquery('english', $${values.length}) OR w.normalized_title % lower($${values.length}))`); }
    values.push(Math.min(limit, 500));
    const result = await query<WorkRow>(`${workSelect} ${join} WHERE ${where.join(' AND ')} GROUP BY w.id, v.id ORDER BY w.updated_at DESC LIMIT $${values.length}`, values);
    return result.rows.map(rowToWork);
  }

  async getWork(id: string) {
    const result = await query<WorkRow>(`${workSelect} WHERE w.id = $1 AND w.deleted_at IS NULL GROUP BY w.id, v.id`, [id]);
    return result.rows[0] ? rowToWork(result.rows[0]) : null;
  }

  async createWork(input: WorkInput) {
    const doi = cleanDoi(input.doi);
    if (doi) {
      const existing = await query<{ id: string }>('SELECT id FROM work WHERE lower(doi) = $1 AND deleted_at IS NULL', [doi]);
      if (existing.rows[0]) return (await this.getWork(existing.rows[0].id))!;
    }
    const family = input.authors?.[0]?.family ?? 'anon';
    const year = input.year ?? new Date().getUTCFullYear();
    const venue = input.venue?.trim() || 'Unknown venue';
    return transaction(async (client) => {
      let venueRow = await client.query<{ id: string; abbreviation: string }>('SELECT id, abbreviation FROM venue WHERE lower(canonical_name) = lower($1) LIMIT 1', [venue]);
      if (!venueRow.rows[0]) {
        const id = uuidv7();
        venueRow = await client.query('INSERT INTO venue(id, canonical_name, abbreviation) VALUES($1,$2,$3) RETURNING id, abbreviation', [id, venue, venueAbbreviation(venue)]);
      }
      let key = makeCitationKey(family, venue, year);
      for (let suffix = 0; ; suffix++) {
        const candidate = suffix ? makeCitationKey(family, venue, year, String.fromCharCode(96 + suffix)) : key;
        const collision = await client.query('SELECT 1 FROM work WHERE citation_key = $1', [candidate]);
        if (!collision.rowCount) { key = candidate; break; }
      }
      const id = uuidv7();
      await client.query(`INSERT INTO work(id,title,normalized_title,abstract,year,venue_id,doi,citation_key,manifestation_type,verification_status,access_class,source_metadata)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [id, input.title.trim(), normalizeTitle(input.title), input.abstract ?? '', input.year ?? null,
        venueRow.rows[0]!.id, doi, key, input.manifestationType ?? 'version_of_record', input.verificationStatus ?? 'unverified', input.accessClass ?? 'metadata_only', JSON.stringify({
          publisher: input.publisher ?? '', publicationPlace: input.publicationPlace ?? '', publicationDate: input.publicationDate ?? '',
          volume: input.volume ?? '', issue: input.issue ?? '', pages: input.pages ?? '', affiliations: input.affiliations ?? [],
          salientContribution: input.salientContribution ?? '', recordKind: input.recordKind ?? 'scholarly_record'
        })]);
      for (const [position, author] of (input.authors ?? []).entries()) {
        const personId = uuidv7();
        await client.query('INSERT INTO person(id,given_names,family_name,display_name,orcid) VALUES($1,$2,$3,$4,$5)',
          [personId, author.given ?? '', author.family, `${author.given ?? ''} ${author.family}`.trim(), author.orcid ?? null]);
        await client.query('INSERT INTO authorship(work_id,person_id,position) VALUES($1,$2,$3)', [id, personId, position]);
      }
      if (input.connector && input.externalId) {
        const payload = input.sourcePayload ?? input;
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)));
        const payloadHash = Buffer.from(hash).toString('hex');
        await client.query(`INSERT INTO source_record(id,work_id,connector,external_id,payload,payload_hash)
          VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [uuidv7(), id, input.connector, input.externalId, JSON.stringify(payload), payloadHash]);
      }
      return id;
    }).then((id) => this.getWork(id) as Promise<Work>);
  }

  async listCollections(): Promise<Collection[]> {
    const result = await query<any>(`SELECT c.*, count(cm.work_id)::int AS member_count FROM collection c
      LEFT JOIN collection_membership cm ON cm.collection_id=c.id WHERE c.deleted_at IS NULL GROUP BY c.id ORDER BY c.created_at`);
    return result.rows.map((row) => ({ id: row.id, name: row.name, description: row.description, parentId: row.parent_id,
      memberCount: row.member_count, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() }));
  }

  async createCollection(input: { name: string; description?: string; parentId?: string | null }) {
    const id = uuidv7();
    await query('INSERT INTO collection(id,name,description,parent_id) VALUES($1,$2,$3,$4)', [id, input.name, input.description ?? '', input.parentId ?? null]);
    return (await this.listCollections()).find((item) => item.id === id)!;
  }

  async addToCollection(collectionId: string, workIds: string[]) {
    await transaction(async (client) => {
      for (const [ordinal, workId] of workIds.entries()) await client.query(`INSERT INTO collection_membership(collection_id,work_id,ordinal)
        VALUES($1,$2,$3) ON CONFLICT(collection_id,work_id) DO NOTHING`, [collectionId, workId, ordinal]);
    });
    return this.listWorks({ collectionId });
  }

  async updateMembership(collectionId: string, workId: string, status: WorkStatus) {
    await query('UPDATE collection_membership SET status=$3, updated_at=now() WHERE collection_id=$1 AND work_id=$2', [collectionId, workId, status]);
  }

  async exportBibtex(collectionId: string) {
    const works = await this.listWorks({ collectionId, limit: 500 });
    return works.map((work) => toBibtex({ citationKey: work.citationKey, title: work.title, authors: work.authors, venue: work.venue, year: work.year, doi: work.doi })).join('\n\n');
  }

  async search(q: string, collectionId?: string) {
    const works = await this.listWorks({ q, collectionId, limit: 50 });
    return works.map((work, index) => ({ work, rank: index + 1, score: Math.max(0.3, 1 - index * 0.06),
      features: { lexical: Math.max(0.2, 0.95 - index * 0.05), semantic: Math.max(0.2, 0.82 - index * 0.03), citation: 0, userProfile: collectionId ? 0.7 : 0.2 },
      whyShown: [`Matches “${q}” in stored title or abstract`, collectionId ? 'Within the active collection' : 'Across your library'] }));
  }

  async graph(collectionId?: string, workId?: string, limit = 200): Promise<GraphProjection> {
    const values: unknown[] = [];
    const filters: string[] = ['w.deleted_at IS NULL'];
    let membershipJoin = '';
    if (collectionId) { values.push(collectionId); membershipJoin = 'JOIN collection_membership cm ON cm.work_id=w.id'; filters.push(`cm.collection_id=$${values.length}`); }
    if (workId) { values.push(workId); filters.push(`(w.id=$${values.length} OR EXISTS(SELECT 1 FROM typed_relationship rr WHERE (rr.source_work_id=$${values.length} AND rr.target_work_id=w.id) OR (rr.target_work_id=$${values.length} AND rr.source_work_id=w.id)))`); }
    values.push(limit + 1);
    const membershipStatus = collectionId ? 'cm.status' : 'NULL::text AS status';
    const rows = await query<any>(`SELECT w.id,w.title,w.year,w.abstract,v.abbreviation AS venue,
      COALESCE(NULLIF(w.source_metadata->>'salientContribution',''), w.abstract) AS gist,${membershipStatus} FROM work w ${membershipJoin}
      LEFT JOIN venue v ON v.id=w.venue_id WHERE ${filters.join(' AND ')} ORDER BY w.year DESC NULLS LAST LIMIT $${values.length}`, values);
    const selected = rows.rows.slice(0, limit);
    const ids = selected.map((row) => row.id);
    const edgeRows = ids.length ? await query<any>('SELECT * FROM typed_relationship WHERE source_work_id=ANY($1::uuid[]) AND target_work_id=ANY($1::uuid[])', [ids]) : { rows: [] };
    return { nodes: selected.map((row) => ({ id: row.id, label: row.title, year: row.year, venue: row.venue ?? '', gist: row.gist ?? row.abstract ?? '', status: row.status ?? undefined })),
      edges: edgeRows.rows.map((row): Relationship => ({ id: row.id, sourceId: row.source_work_id, targetId: row.target_work_id, predicate: row.predicate,
        confidence: row.confidence, verificationStatus: row.verification_status, evidence: row.evidence })), truncated: rows.rows.length > limit };
  }

  async createRelationship(input: Omit<Relationship, 'id'>) {
    const id = uuidv7();
    await query(`INSERT INTO typed_relationship(id,source_work_id,target_work_id,predicate,confidence,verification_status,evidence)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(source_work_id,target_work_id,predicate) DO UPDATE SET confidence=excluded.confidence,evidence=excluded.evidence`,
      [id, input.sourceId, input.targetId, input.predicate, input.confidence, input.verificationStatus, JSON.stringify(input.evidence ?? [])]);
    return id;
  }

  async createNote(input: { title: string; markdown?: string; noteType?: string; collectionId?: string; workId?: string }) {
    const id = uuidv7();
    const result = await query<any>(`INSERT INTO note(id,title,markdown,note_type,collection_id,work_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [id, input.title, input.markdown ?? '', input.noteType ?? 'source', input.collectionId ?? null, input.workId ?? null]);
    return result.rows[0];
  }

  async listNotes(collectionId?: string, workId?: string) {
    const clauses = ['deleted_at IS NULL']; const values: unknown[] = [];
    if (collectionId) { values.push(collectionId); clauses.push(`collection_id=$${values.length}`); }
    if (workId) { values.push(workId); clauses.push(`work_id=$${values.length}`); }
    return (await query<any>(`SELECT * FROM note WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC`, values)).rows;
  }

  async close() { await pool.end(); }
}
