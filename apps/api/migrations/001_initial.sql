CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS schema_migration (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS venue (
  id uuid PRIMARY KEY,
  canonical_name text NOT NULL,
  abbreviation text NOT NULL DEFAULT 'misc',
  aliases text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS work (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  normalized_title text NOT NULL,
  abstract text NOT NULL DEFAULT '',
  year integer,
  venue_id uuid REFERENCES venue(id),
  doi text,
  citation_key text NOT NULL UNIQUE,
  manifestation_type text NOT NULL DEFAULT 'version_of_record',
  verification_status text NOT NULL DEFAULT 'unverified',
  access_class text NOT NULL DEFAULT 'metadata_only',
  source_metadata jsonb NOT NULL DEFAULT '{}',
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(abstract, '')), 'B')
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS work_doi_unique ON work(lower(doi)) WHERE doi IS NOT NULL;
CREATE INDEX IF NOT EXISTS work_search_idx ON work USING gin(search_vector);
CREATE INDEX IF NOT EXISTS work_title_trgm_idx ON work USING gin(normalized_title gin_trgm_ops);

CREATE TABLE IF NOT EXISTS person (
  id uuid PRIMARY KEY, given_names text NOT NULL DEFAULT '', family_name text NOT NULL,
  display_name text NOT NULL, orcid text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS authorship (
  work_id uuid NOT NULL REFERENCES work(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES person(id), position integer NOT NULL,
  PRIMARY KEY(work_id, person_id, position)
);

CREATE TABLE IF NOT EXISTS source_record (
  id uuid PRIMARY KEY, work_id uuid REFERENCES work(id) ON DELETE SET NULL,
  connector text NOT NULL, external_id text NOT NULL, retrieved_at timestamptz NOT NULL DEFAULT now(),
  access_class text NOT NULL DEFAULT 'metadata_only', payload jsonb NOT NULL,
  payload_hash text NOT NULL, UNIQUE(connector, external_id, payload_hash)
);

CREATE TABLE IF NOT EXISTS collection (
  id uuid PRIMARY KEY, parent_id uuid REFERENCES collection(id) ON DELETE SET NULL,
  name text NOT NULL, description text NOT NULL DEFAULT '', collection_type text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1, deleted_at timestamptz
);
CREATE TABLE IF NOT EXISTS collection_membership (
  collection_id uuid NOT NULL REFERENCES collection(id) ON DELETE CASCADE,
  work_id uuid NOT NULL REFERENCES work(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'inbox', priority integer NOT NULL DEFAULT 0,
  rationale text NOT NULL DEFAULT '', ordinal integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(collection_id, work_id)
);

CREATE TABLE IF NOT EXISTS object_store (
  hash_sha256 text PRIMARY KEY, byte_size bigint NOT NULL, mime_type text NOT NULL,
  storage_path text NOT NULL, integrity_status text NOT NULL DEFAULT 'verified',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS attachment (
  id uuid PRIMARY KEY, work_id uuid NOT NULL REFERENCES work(id) ON DELETE CASCADE,
  object_hash text NOT NULL REFERENCES object_store(hash_sha256), filename text NOT NULL,
  attachment_type text NOT NULL DEFAULT 'paper', access_class text NOT NULL DEFAULT 'user_uploaded',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS annotation (
  id uuid PRIMARY KEY, attachment_id uuid NOT NULL REFERENCES attachment(id) ON DELETE CASCADE,
  annotation_type text NOT NULL, body_markdown text NOT NULL DEFAULT '', color text NOT NULL DEFAULT '#f5c451',
  tags jsonb NOT NULL DEFAULT '[]', page_start integer, page_end integer, selector jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE TABLE IF NOT EXISTS note (
  id uuid PRIMARY KEY, note_type text NOT NULL DEFAULT 'source', title text NOT NULL,
  markdown text NOT NULL DEFAULT '', collection_id uuid REFERENCES collection(id) ON DELETE SET NULL,
  work_id uuid REFERENCES work(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1, deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS typed_relationship (
  id uuid PRIMARY KEY, source_work_id uuid NOT NULL REFERENCES work(id) ON DELETE CASCADE,
  target_work_id uuid NOT NULL REFERENCES work(id) ON DELETE CASCADE, predicate text NOT NULL,
  confidence real NOT NULL DEFAULT 0, verification_status text NOT NULL DEFAULT 'inferred',
  evidence jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_work_id, target_work_id, predicate)
);
CREATE INDEX IF NOT EXISTS relationship_source_idx ON typed_relationship(source_work_id, predicate);
CREATE INDEX IF NOT EXISTS relationship_target_idx ON typed_relationship(target_work_id, predicate);

CREATE TABLE IF NOT EXISTS discovery_profile (
  id uuid PRIMARY KEY, collection_id uuid REFERENCES collection(id) ON DELETE CASCADE,
  name text NOT NULL, seed jsonb NOT NULL, sources jsonb NOT NULL DEFAULT '[]', schedule text,
  enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS recommendation (
  id uuid PRIMARY KEY, profile_id uuid REFERENCES discovery_profile(id) ON DELETE CASCADE,
  work_id uuid NOT NULL REFERENCES work(id), rank integer NOT NULL, score real NOT NULL,
  features jsonb NOT NULL, explanation jsonb NOT NULL, status text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversation (
  id uuid PRIMARY KEY, collection_id uuid REFERENCES collection(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT 'New conversation', scope jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS answer (
  id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  question text NOT NULL, markdown text NOT NULL, status text NOT NULL,
  claims jsonb NOT NULL DEFAULT '[]', limitations jsonb NOT NULL DEFAULT '[]',
  model_provenance jsonb NOT NULL DEFAULT '{}', scope_snapshot jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS job (
  id uuid PRIMARY KEY, type text NOT NULL, idempotency_key text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'queued', progress real NOT NULL DEFAULT 0,
  input jsonb NOT NULL DEFAULT '{}', result jsonb, error text, attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3, scheduled_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz, heartbeat_at timestamptz, completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
