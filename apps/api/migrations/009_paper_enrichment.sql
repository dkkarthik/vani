CREATE TABLE paper_enrichment (
  work_id uuid PRIMARY KEY REFERENCES work(id),
  pdf_status text NOT NULL DEFAULT 'queued',
  pdf_error text NOT NULL DEFAULT '',
  summary jsonb,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX paper_enrichment_due ON paper_enrichment(next_attempt_at) WHERE status='queued';
