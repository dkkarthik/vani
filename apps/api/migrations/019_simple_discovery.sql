-- An isolated experiment; no changes to core reasoning tables or policies.
CREATE TABLE simple_discovery_settings (
 collection_id uuid PRIMARY KEY REFERENCES collection(id) ON DELETE CASCADE,
 version int NOT NULL DEFAULT 1, label_version int NOT NULL DEFAULT 0,
 profile jsonb NOT NULL,
 next_refresh_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE simple_paper (
 id uuid PRIMARY KEY, paper jsonb NOT NULL, sources jsonb NOT NULL DEFAULT '[]',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE simple_paper_alias (
 identity text PRIMARY KEY, paper_id uuid NOT NULL REFERENCES simple_paper(id) ON DELETE CASCADE
);
CREATE INDEX simple_paper_alias_paper ON simple_paper_alias(paper_id);
CREATE TABLE simple_run (
 id uuid PRIMARY KEY, collection_id uuid NOT NULL REFERENCES collection(id) ON DELETE CASCADE,
 settings_version int NOT NULL, snapshot jsonb NOT NULL, status text NOT NULL DEFAULT 'queued',
 tasks jsonb NOT NULL DEFAULT '[]', counters jsonb NOT NULL DEFAULT '{}', error text,
 rerank boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX simple_run_active ON simple_run(collection_id) WHERE status IN ('queued','running');
CREATE TABLE simple_recommendation (
 collection_id uuid NOT NULL REFERENCES collection(id) ON DELETE CASCADE,
 paper_id uuid NOT NULL REFERENCES simple_paper(id) ON DELETE CASCADE,
 run_id uuid REFERENCES simple_run(id) ON DELETE SET NULL,
 score double precision, explanation jsonb NOT NULL DEFAULT '{}',
 feedback text CHECK(feedback IN ('up','down')), reason text NOT NULL DEFAULT '',
 work_id uuid REFERENCES work(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(collection_id,paper_id)
);
CREATE INDEX simple_recommendation_rank ON simple_recommendation(collection_id,score DESC);
CREATE TABLE simple_feedback (
 id uuid PRIMARY KEY, collection_id uuid NOT NULL REFERENCES collection(id) ON DELETE CASCADE,
 paper_id uuid NOT NULL REFERENCES simple_paper(id) ON DELETE CASCADE,
 judgment jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE simple_model (
 collection_id uuid PRIMARY KEY REFERENCES collection(id) ON DELETE CASCADE,
 run_id uuid NOT NULL REFERENCES simple_run(id) ON DELETE CASCADE,
 metadata jsonb NOT NULL, model jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE simple_source_clock (
 source text PRIMARY KEY, next_at timestamptz NOT NULL DEFAULT now()
);
