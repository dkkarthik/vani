ALTER TABLE collection ADD COLUMN keywords text[];
ALTER TABLE collection ADD COLUMN keyword_version integer NOT NULL DEFAULT 1;
ALTER TABLE collection_membership ADD COLUMN inclusion_reason jsonb;
ALTER TABLE collection_membership ALTER COLUMN inclusion_reason SET DEFAULT '{"kind":"manual","text":"You added this paper to the collection."}'::jsonb;
