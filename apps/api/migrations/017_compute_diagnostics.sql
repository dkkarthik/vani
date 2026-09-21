ALTER TABLE core_run ADD COLUMN compute_control jsonb NOT NULL DEFAULT '{}';
CREATE TABLE core_read_attempt (
 id uuid PRIMARY KEY,
 candidate_id uuid NOT NULL REFERENCES core_candidate(id) ON DELETE CASCADE,
 run_id uuid NOT NULL REFERENCES core_run(id) ON DELETE CASCADE,
 collection_id uuid NOT NULL REFERENCES collection(id) ON DELETE CASCADE,
 stage text NOT NULL, input_hash text NOT NULL, packet jsonb NOT NULL,
 status text NOT NULL DEFAULT 'started', issues jsonb NOT NULL DEFAULT '[]',
 raw_output text, output_truncated boolean NOT NULL DEFAULT false,
 result jsonb, invocation jsonb, duration_ms integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
);
CREATE INDEX core_attempt_fingerprint ON core_read_attempt(candidate_id,input_hash,created_at DESC);
CREATE INDEX core_attempt_run ON core_read_attempt(run_id,created_at DESC);
-- Preserve existing operator holds and quarantine exhausted legacy failures.
UPDATE core_run SET compute_control='{"held":true,"reason":"Existing pause retained during compute-control upgrade"}' WHERE status='paused';

CREATE TABLE core_read_fingerprint (
 candidate_id uuid NOT NULL REFERENCES core_candidate(id) ON DELETE CASCADE,
 input_hash text NOT NULL, calls integer NOT NULL DEFAULT 0,
 terminal boolean NOT NULL DEFAULT false,
 PRIMARY KEY(candidate_id,input_hash)
);
