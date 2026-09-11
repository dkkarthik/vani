ALTER TABLE work ADD COLUMN merged_into uuid REFERENCES work(id);
ALTER TABLE work ADD COLUMN tags text[] NOT NULL DEFAULT '{}';
CREATE INDEX work_tags ON work USING gin(tags);
ALTER TABLE collection ADD COLUMN search_rule jsonb;
CREATE TABLE identity_review(id uuid PRIMARY KEY,source_id uuid NOT NULL REFERENCES work(id),target_id uuid NOT NULL REFERENCES work(id),action text NOT NULL,snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(source_id,target_id,action));
CREATE TABLE version_link(id uuid PRIMARY KEY,source_id uuid NOT NULL REFERENCES work(id),target_id uuid NOT NULL REFERENCES work(id),relation text NOT NULL,reason text NOT NULL,source_url text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(source_id,target_id,relation));
CREATE TABLE cleanup_batch(id uuid PRIMARY KEY,state text NOT NULL DEFAULT 'preview',operation jsonb NOT NULL,items jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE document_index(object_hash text PRIMARY KEY REFERENCES object_store(hash_sha256),state text NOT NULL,error text NOT NULL DEFAULT '',pages jsonb NOT NULL DEFAULT '[]',page_count integer NOT NULL DEFAULT 0,indexed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE reading_position(attachment_id uuid PRIMARY KEY REFERENCES attachment(id),page integer NOT NULL,zoom real NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE annotation ADD COLUMN version integer NOT NULL DEFAULT 1;
CREATE TABLE argument(id uuid PRIMARY KEY,title text NOT NULL,description text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE argument_evidence(argument_id uuid NOT NULL REFERENCES argument(id) ON DELETE CASCADE,annotation_id uuid NOT NULL REFERENCES annotation(id),rationale text NOT NULL DEFAULT '',PRIMARY KEY(argument_id,annotation_id));
CREATE TABLE semantic_chunk(cache_key text PRIMARY KEY,model text NOT NULL,embedding jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
-- A logical merge retains immutable original records and prevents alias cycles.
CREATE FUNCTION canonical_work(input_id uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
WITH RECURSIVE chain AS (
 SELECT id,merged_into,ARRAY[id] AS path FROM work WHERE id=input_id
 UNION ALL SELECT w.id,w.merged_into,c.path||w.id FROM chain c JOIN work w ON w.id=c.merged_into WHERE NOT w.id=ANY(c.path)
) SELECT id FROM chain WHERE merged_into IS NULL LIMIT 1
$$;
