import { libraryWhere } from './research/organization.js';
import { LibraryRule } from '@vani/shared';
import { v7 as uuidv7 } from 'uuid';
import type { PoolClient } from 'pg';
import type { Collection, GraphProjection, Relationship, Work, WorkStatus } from '@vani/shared';
import { pool, query, transaction } from './db.js';
import { citationSuffix, cleanDoi, makeCitationKey, normalizeTitle, toBibtex, venueAbbreviation } from './lib/citations.js';

type WorkRow = {
  id: string; title: string; abstract: string; year: number | null; venue: string | null;
  venue_abbreviation: string | null; doi: string | null; citation_key: string;
  manifestation_type: string; verification_status: Work['verificationStatus']; access_class: string;
  authors: Array<{ id: string; given: string; family: string; orcid?: string | null }> | null;
  source_metadata: Record<string, any>;
  created_at: Date; updated_at: Date; version: number;
};

const workSelect = `
  SELECT w.id, w.title, w.abstract, w.year, w.doi, w.citation_key, w.manifestation_type,
    w.verification_status, w.access_class, w.created_at, w.updated_at,
    w.source_metadata, w.version,
    v.canonical_name AS venue, v.abbreviation AS venue_abbreviation,
    COALESCE(jsonb_agg(jsonb_build_object('id', p.id, 'given', p.given_names, 'family', p.family_name, 'orcid', p.orcid)
      ORDER BY a.position) FILTER (WHERE p.id IS NOT NULL), '[]') AS authors
  FROM work w LEFT JOIN venue v ON v.id = w.venue_id
  LEFT JOIN authorship a ON a.work_id = w.id LEFT JOIN person p ON p.id = a.person_id`;

const rowToWork = (row: WorkRow): Work => ({
  version: row.version,
  publicationType: row.source_metadata?.publicationType ?? 'article-journal', editors: row.source_metadata?.editors ?? [],
  edition: row.source_metadata?.edition ?? '', isbn: row.source_metadata?.isbn ?? '', issn: row.source_metadata?.issn ?? '',
  url: row.source_metadata?.url ?? '', language: row.source_metadata?.language ?? '', articleNumber: row.source_metadata?.articleNumber ?? '',
  onlineDate: row.source_metadata?.onlineDate ?? '', printDate: row.source_metadata?.printDate ?? '',
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
  publicationType?: string; editors?: Array<{given:string;family:string}>; edition?:string; isbn?:string; issn?:string; url?:string; language?:string; articleNumber?:string; onlineDate?:string; printDate?:string;
  title: string; abstract?: string; year?: number | null; venue?: string; doi?: string | null;
  authors?: Array<{ given?: string; family: string; orcid?: string | null }>;
  verificationStatus?: Work['verificationStatus']; manifestationType?: string; accessClass?: string;
  publisher?: string; publicationPlace?: string; publicationDate?: string; volume?: string; issue?: string; pages?: string;
  affiliations?: Array<{ name: string; place?: string }>; salientContribution?: string; recordKind?: 'scholarly_record' | 'demo_fixture';
  connector?: string; externalId?: string; sourcePayload?: unknown; deduplicateByTitle?: boolean;
}

export class Repository {
  async health() { const result = await query<{ now: Date }>('SELECT now()'); return result.rows[0]!.now; }

  async listWorks({ q = '', collectionId, limit = 100, offset = 0 }: { q?: string; collectionId?: string; limit?: number; offset?: number } = {}) {
    const values: unknown[] = [];
    const where = ['w.deleted_at IS NULL','w.merged_into IS NULL'];
    const join = '';
    if(collectionId){const scope=await libraryWhere(LibraryRule.parse({}),collectionId);values.push(...scope.values);where.push(...scope.where);}
    if (q) { values.push(q); where.push(`(w.search_vector @@ websearch_to_tsquery('english', $${values.length}) OR w.normalized_title % lower($${values.length}))`); }
    values.push(Math.min(limit, 500));
    values.push(Math.max(0,offset));
    const result = await query<WorkRow>(`${workSelect} ${join} WHERE ${where.join(' AND ')} GROUP BY w.id, v.id ORDER BY w.updated_at DESC,w.id LIMIT $${values.length-1} OFFSET $${values.length}`, values);
    return result.rows.map(rowToWork);
  }

  async getWork(id: string, client?: PoolClient) {
    const result = await (client ?? pool).query<WorkRow>(`${workSelect} WHERE w.id = canonical_work($1) AND w.deleted_at IS NULL GROUP BY w.id, v.id`, [id]);
    return result.rows[0] ? rowToWork(result.rows[0]) : null;
  }

  async createWork(input: WorkInput, client?: PoolClient) {
    const connection = client ?? pool;
    const doi = cleanDoi(input.doi);
    if (input.connector && input.externalId) {
      const match = await connection.query<{id:string}>('SELECT s.work_id AS id FROM source_record s JOIN work w ON w.id=s.work_id WHERE s.connector=$1 AND s.external_id=$2 AND w.deleted_at IS NULL LIMIT 1', [input.connector,input.externalId]);
      if (match.rows[0]) return (await this.getWork(match.rows[0].id, client))!;
    }
    if (doi) {
      const existing = await connection.query<{ id: string }>('SELECT id FROM work WHERE lower(doi) = $1 AND deleted_at IS NULL', [doi]);
      if (existing.rows[0]) return (await this.getWork(existing.rows[0].id, client))!;
    }
    // Identifier-less connector results must not accumulate on every daily run.
    if (input.connector && !doi && input.deduplicateByTitle !== false) {
      const match = await connection.query<{id:string}>('SELECT id FROM work WHERE normalized_title=$1 AND year IS NOT DISTINCT FROM $2 AND deleted_at IS NULL LIMIT 1', [normalizeTitle(input.title),input.year ?? null]);
      if (match.rows[0]) return (await this.getWork(match.rows[0].id, client))!;
    }
    const family = input.authors?.[0]?.family ?? 'anon';
    const year = input.year ?? new Date().getUTCFullYear();
    const venue = input.venue?.trim() || 'Unknown venue';
    const run = client ? <T>(fn: (client: PoolClient) => Promise<T>) => fn(client) : transaction;
    return run(async (client) => {
      let venueRow = await client.query<{ id: string; abbreviation: string }>('SELECT id, abbreviation FROM venue WHERE lower(canonical_name) = lower($1) LIMIT 1', [venue]);
      if (!venueRow.rows[0]) {
        const id = uuidv7();
        venueRow = await client.query('INSERT INTO venue(id, canonical_name, abbreviation) VALUES($1,$2,$3) RETURNING id, abbreviation', [id, venue, venueAbbreviation(venue)]);
      }
      let key = makeCitationKey(family, venue, year);
      for (let suffix = 0; ; suffix++) {
        const candidate = suffix ? makeCitationKey(family, venue, year, citationSuffix(suffix)) : key;
        const collision = await client.query('SELECT 1 FROM work WHERE citation_key = $1', [candidate]);
        if (!collision.rowCount) { key = candidate; break; }
      }
      const id = uuidv7();
      await client.query(`INSERT INTO work(id,title,normalized_title,abstract,year,venue_id,doi,citation_key,manifestation_type,verification_status,access_class,source_metadata)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [id, input.title.trim(), normalizeTitle(input.title), input.abstract ?? '', input.year ?? null,
        venueRow.rows[0]!.id, doi, key, input.manifestationType ?? 'version_of_record', input.verificationStatus ?? 'unverified', input.accessClass ?? 'metadata_only', JSON.stringify({
          publicationType: input.publicationType ?? 'article-journal', editors: input.editors ?? [], edition: input.edition ?? '', isbn: input.isbn ?? '', issn: input.issn ?? '', url: input.url ?? '', language: input.language ?? '', articleNumber: input.articleNumber ?? '', onlineDate: input.onlineDate ?? '', printDate: input.printDate ?? '',
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
    }).then((id) => this.getWork(id, client) as Promise<Work>);
  }

  async listCollections(): Promise<Collection[]> {
    const result = await query<any>(`SELECT c.*, count(cm.work_id)::int AS member_count,
      count(cm.work_id) FILTER (WHERE cm.seen_at IS NULL)::int AS new_count FROM collection c
      LEFT JOIN collection_membership cm ON cm.collection_id=c.id AND EXISTS(SELECT 1 FROM work w WHERE w.id=cm.work_id AND w.merged_into IS NULL AND w.deleted_at IS NULL) WHERE c.deleted_at IS NULL GROUP BY c.id ORDER BY c.created_at`);
    for(const row of result.rows)if(row.collection_type==='saved_search'){
      const scope=await libraryWhere(LibraryRule.parse({}),row.id);
      row.member_count=(await query<any>(`SELECT count(*)::int AS count FROM work w WHERE ${scope.where.join(' AND ')}`,scope.values)).rows[0]!.count;row.new_count=0;
    }
    return result.rows.map((row) => ({ id: row.id, name: row.name, description: row.description, parentId: row.parent_id, collectionType: row.collection_type,
      memberCount: row.member_count, newCount: row.new_count, discovery: row.discovery,
      nextDiscoveryAt: row.next_discovery_at?.toISOString() ?? null, lastDiscoveryAt: row.last_discovery_at?.toISOString() ?? null,
      discoveryError: row.discovery_error, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() }));
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
    const ranked=await query<any>(`SELECT w.id,ts_rank_cd(w.search_vector,websearch_to_tsquery('english',$1)) AS rank FROM work w WHERE w.deleted_at IS NULL AND w.merged_into IS NULL AND w.search_vector @@ websearch_to_tsquery('english',$1) AND ($2::uuid IS NULL OR EXISTS(SELECT 1 FROM collection_membership cm WHERE cm.work_id=w.id AND cm.collection_id=$2)) ORDER BY rank DESC,w.id LIMIT 50`,[q,collectionId??null]);
    return Promise.all(ranked.rows.map(async(row,index)=>({work:(await this.getWork(row.id))!,rank:index+1,score:row.rank,features:{lexical:row.rank,semantic:0,citation:0,userProfile:0},whyShown:['PostgreSQL full-text match in title/abstract; use Evidence search for passages and configured semantic retrieval.']})));
  }

  async graph(collectionId?: string, workId?: string, limit = 200): Promise<GraphProjection> {
    const scope=await libraryWhere(LibraryRule.parse({}),collectionId);
    const values=scope.values,filters=scope.where;
    if(workId){values.push(workId);const ref='$'+values.length;filters.push(`(w.id=canonical_work(${ref}) OR EXISTS(SELECT 1 FROM typed_relationship rr WHERE (canonical_work(rr.source_work_id)=canonical_work(${ref}) AND canonical_work(rr.target_work_id)=w.id) OR (canonical_work(rr.target_work_id)=canonical_work(${ref}) AND canonical_work(rr.source_work_id)=w.id)))`);}
    let membershipStatus='NULL::text AS status';
    if(collectionId){values.push(collectionId);membershipStatus=`(SELECT cm.status FROM collection_membership cm WHERE cm.work_id=w.id AND cm.collection_id=$${values.length} LIMIT 1) AS status`;}
    values.push(limit+1);
    const rows=await query<any>(`SELECT w.id,w.title,w.year,w.abstract,v.abbreviation AS venue,COALESCE(NULLIF(w.source_metadata->>'salientContribution',''),w.abstract) AS gist,${membershipStatus} FROM work w LEFT JOIN venue v ON v.id=w.venue_id WHERE ${filters.join(' AND ')} ORDER BY w.year DESC NULLS LAST,w.id LIMIT $${values.length}`,values);
    const selected=rows.rows.slice(0,limit),ids=selected.map(row=>row.id);
    const edgeRows=ids.length?await query<any>('SELECT *,canonical_work(source_work_id) AS canonical_source,canonical_work(target_work_id) AS canonical_target FROM typed_relationship WHERE canonical_work(source_work_id)=ANY($1::uuid[]) AND canonical_work(target_work_id)=ANY($1::uuid[]) ORDER BY id',[ids]):{rows:[]};
    const edges=new Map<string,Relationship>();
    for(const row of edgeRows.rows){if(row.canonical_source===row.canonical_target)continue;const key=[row.canonical_source,row.canonical_target,row.predicate].join(':');const prior=edges.get(key);
      if(prior)prior.evidence=[...new Map([...(prior.evidence??[]),...row.evidence].map(value=>[JSON.stringify(value),value])).values()] as Relationship['evidence'];
      else edges.set(key,{id:row.id,sourceId:row.canonical_source,targetId:row.canonical_target,predicate:row.predicate,confidence:row.confidence,verificationStatus:row.verification_status,evidence:row.evidence});
    }
    return {nodes:selected.map(row=>({id:row.id,label:row.title,year:row.year,venue:row.venue??'',gist:row.gist??'',status:row.status??undefined})),edges:[...edges.values()],truncated:rows.rows.length>limit};
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
    if (workId) { values.push(workId); clauses.push(`canonical_work(work_id)=canonical_work($${values.length})`); }
    return (await query<any>(`SELECT * FROM note WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC`, values)).rows;
  }

  async close() { await pool.end(); }
}
