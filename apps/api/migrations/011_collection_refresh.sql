CREATE TABLE collection_refresh (
 id uuid PRIMARY KEY, collection_id uuid NOT NULL REFERENCES collection(id),
 status text NOT NULL DEFAULT 'queued', phase text NOT NULL DEFAULT 'queued',
 snapshot jsonb NOT NULL, scanned integer NOT NULL DEFAULT 0, added integer NOT NULL DEFAULT 0,
 warnings jsonb NOT NULL DEFAULT '[]', error text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX collection_refresh_active ON collection_refresh(collection_id) WHERE status IN ('queued','running');
