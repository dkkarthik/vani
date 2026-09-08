ALTER TABLE work ADD COLUMN metadata_locks jsonb NOT NULL DEFAULT '[]';
CREATE TABLE metadata_assertion (
 id uuid PRIMARY KEY, work_id uuid NOT NULL REFERENCES work(id) ON DELETE CASCADE,
 source text NOT NULL, external_id text NOT NULL, source_url text NOT NULL DEFAULT '',
 metadata jsonb NOT NULL, raw jsonb NOT NULL, authoritative boolean NOT NULL DEFAULT false,
 payload_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(work_id,source,external_id,payload_hash)
);
CREATE TABLE metadata_decision (
 id uuid PRIMARY KEY, work_id uuid NOT NULL REFERENCES work(id) ON DELETE CASCADE,
 field text NOT NULL, before_value jsonb, after_value jsonb, origin text NOT NULL,
 assertion_id uuid REFERENCES metadata_assertion(id), reason text NOT NULL DEFAULT '',
 revision integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX metadata_decision_work ON metadata_decision(work_id,revision DESC);
CREATE TABLE import_session (
 id uuid PRIMARY KEY, collection_id uuid NOT NULL REFERENCES collection(id),
 state text NOT NULL DEFAULT 'preview', revision integer NOT NULL DEFAULT 1,
 files jsonb NOT NULL DEFAULT '[]', warnings jsonb NOT NULL DEFAULT '[]',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE import_item (
 id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES import_session(id) ON DELETE CASCADE,
 ordinal integer NOT NULL, data jsonb NOT NULL, included boolean NOT NULL DEFAULT true,
 status text NOT NULL DEFAULT 'pending', error text NOT NULL DEFAULT '',
 work_id uuid REFERENCES work(id), UNIQUE(session_id,ordinal)
);
CREATE INDEX import_item_session ON import_item(session_id,ordinal);
CREATE TABLE import_identity (
 fingerprint text PRIMARY KEY, work_id uuid NOT NULL REFERENCES work(id) ON DELETE CASCADE
);
CREATE TABLE imported_note (
 work_id uuid NOT NULL REFERENCES work(id) ON DELETE CASCADE,
 content_hash text NOT NULL, note_id uuid NOT NULL REFERENCES note(id) ON DELETE CASCADE,
 PRIMARY KEY(work_id,content_hash)
);
