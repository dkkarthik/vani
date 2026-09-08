CREATE TABLE browser_capture (
  id uuid PRIMARY KEY,
  work_id uuid NOT NULL REFERENCES work(id) ON DELETE CASCADE,
  collection_id uuid NOT NULL REFERENCES collection(id) ON DELETE CASCADE,
  source_url text NOT NULL,
  canonical_url text NOT NULL,
  metadata jsonb NOT NULL,
  input_hash text NOT NULL,
  duplicate boolean NOT NULL DEFAULT false,
  pdf_url text,
  pdf_status text NOT NULL CHECK (pdf_status IN ('not_requested','pending','saved','failed')),
  pdf_message text NOT NULL DEFAULT '',
  attachment_id uuid REFERENCES attachment(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX browser_capture_work_idx ON browser_capture(work_id, created_at DESC);
