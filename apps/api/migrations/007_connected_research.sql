ALTER TABLE note ADD COLUMN argument_id uuid REFERENCES argument(id);
CREATE TABLE note_reference (
 note_id uuid REFERENCES note(id), passage_id uuid REFERENCES annotation(id), kind text NOT NULL, label text NOT NULL DEFAULT '',
 PRIMARY KEY(note_id,passage_id)
);
CREATE TABLE note_link (
 source_id uuid REFERENCES note(id), target_id uuid REFERENCES note(id), rationale text NOT NULL DEFAULT '', PRIMARY KEY(source_id,target_id), CHECK(source_id<>target_id)
);
CREATE TABLE note_asset (object_hash text PRIMARY KEY REFERENCES object_store(hash_sha256), filename text NOT NULL);
ALTER TABLE collection_membership ADD COLUMN question text NOT NULL DEFAULT '', ADD COLUMN queued boolean NOT NULL DEFAULT false, ADD COLUMN reading_revision integer NOT NULL DEFAULT 1;
CREATE TABLE knowledge_entity (
 id uuid PRIMARY KEY, name text NOT NULL, entity_type text NOT NULL, aliases text[] NOT NULL DEFAULT '{}', origin jsonb NOT NULL DEFAULT '{}',
 merged_into uuid REFERENCES knowledge_entity(id), version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION canonical_entity(start_id uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
 WITH RECURSIVE chain AS (
 SELECT id,merged_into,ARRAY[id] path FROM knowledge_entity WHERE id=start_id
 UNION ALL SELECT e.id,e.merged_into,c.path||e.id FROM knowledge_entity e JOIN chain c ON e.id=c.merged_into WHERE NOT e.id=ANY(c.path)
 ) SELECT id FROM chain WHERE merged_into IS NULL LIMIT 1
$$;
CREATE TABLE knowledge_edge (
 id uuid PRIMARY KEY, source jsonb NOT NULL, target jsonb NOT NULL, predicate text NOT NULL, rationale text NOT NULL DEFAULT '',
 origin text NOT NULL DEFAULT 'user', provenance jsonb NOT NULL DEFAULT '{}', passage_ids uuid[] NOT NULL DEFAULT '{}',
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE TABLE entity_audit (id uuid PRIMARY KEY, action text NOT NULL, snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE entity_dismissal (fingerprint text PRIMARY KEY);
CREATE TABLE knowledge_suggestion (
 id uuid PRIMARY KEY, fingerprint text NOT NULL UNIQUE, source jsonb NOT NULL, target jsonb NOT NULL, predicate text NOT NULL,
 evidence jsonb NOT NULL, confidence real NOT NULL, state text NOT NULL DEFAULT 'pending', edge_id uuid REFERENCES knowledge_edge(id), created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE argument ADD COLUMN outline jsonb NOT NULL DEFAULT '[]', ADD COLUMN version integer NOT NULL DEFAULT 1;
CREATE TABLE comparison (
 id uuid PRIMARY KEY, title text NOT NULL, work_ids uuid[] NOT NULL, version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE comparison_cell (
 comparison_id uuid REFERENCES comparison(id), work_id uuid REFERENCES work(id), column_name text NOT NULL, text text NOT NULL DEFAULT '',
 source jsonb, history jsonb NOT NULL DEFAULT '[]', version integer NOT NULL DEFAULT 1, PRIMARY KEY(comparison_id,work_id,column_name)
);
CREATE TABLE discovery_run (
 id uuid PRIMARY KEY, input jsonb NOT NULL, results jsonb NOT NULL, coverage jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
-- Keep planner revisions valid when legacy/F05 status controls update a membership.
CREATE FUNCTION reading_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.status,NEW.priority,NEW.rationale,NEW.question,NEW.queued,NEW.ordinal) IS DISTINCT FROM (OLD.status,OLD.priority,OLD.rationale,OLD.question,OLD.queued,OLD.ordinal) AND NEW.reading_revision=OLD.reading_revision THEN
  NEW.reading_revision=OLD.reading_revision+1;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reading_revision_guard BEFORE UPDATE ON collection_membership FOR EACH ROW EXECUTE FUNCTION reading_revision_guard();
