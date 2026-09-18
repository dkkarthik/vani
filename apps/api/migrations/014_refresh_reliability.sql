ALTER TABLE document_index ADD COLUMN extractor_version integer NOT NULL DEFAULT 1;
ALTER TABLE core_candidate ADD COLUMN last_error text;
CREATE INDEX core_candidate_retry ON core_candidate(run_id,next_attempt_at) WHERE state='pending';

-- Retained completed judgments are re-evaluated on the next explicit/daily run.
-- Their immutable core_assessment history and researcher feedback remain intact.
UPDATE core_candidate SET stage='D0',state='stale',proximity='unassessed',assessment='{}',attempts=0
WHERE run_id IN (SELECT id FROM core_run WHERE status NOT IN ('queued','running','paused','awaiting_evidence'));

-- Old ranked queues can contain seed copies. Preserve assessment history, then
-- rerank active queues under the corrected eligibility/selection rules.
UPDATE core_candidate SET stage='D0',state='pending',proximity='unassessed',assessment='{}',attempts=0
WHERE run_id IN (SELECT id FROM core_run WHERE status IN ('queued','running','paused','awaiting_evidence'));
UPDATE core_run SET phase='ranking',status='queued',error=NULL,counters=counters-'d2'-'d3'
WHERE status IN ('queued','running','paused','awaiting_evidence') AND phase<>'discovery';
