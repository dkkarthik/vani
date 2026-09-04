ALTER TABLE collection ADD COLUMN discovery jsonb;
ALTER TABLE collection ADD COLUMN next_discovery_at timestamptz;
ALTER TABLE collection ADD COLUMN last_discovery_at timestamptz;
ALTER TABLE collection ADD COLUMN discovery_error text;
ALTER TABLE collection_membership ADD COLUMN seen_at timestamptz;
-- No historical view timestamps existed. Baseline old memberships rather than calling them new.
UPDATE collection_membership SET seen_at=created_at;
CREATE INDEX collection_discovery_due ON collection(next_discovery_at) WHERE deleted_at IS NULL;
CREATE TABLE paper_first_pass (
  collection_id uuid NOT NULL REFERENCES collection(id) ON DELETE CASCADE,
  work_id uuid NOT NULL REFERENCES work(id) ON DELETE CASCADE,
  report jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(collection_id, work_id)
);
