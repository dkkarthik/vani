CREATE TEMP TABLE expanded_reading_focus ON COMMIT DROP AS
SELECT collection_id FROM core_focus
WHERE profile#>'{budgets,d2}'='40'::jsonb OR profile#>'{budgets,d3}'='10'::jsonb;

UPDATE core_focus SET
 history=history||jsonb_build_array(jsonb_build_object('version',version,'profile',profile,'at',now(),'reason','Expanded local reading budgets')),
 profile=jsonb_set(profile,'{budgets}',(profile->'budgets')||
   CASE WHEN profile#>'{budgets,d2}'='40'::jsonb THEN '{"d2":200}'::jsonb ELSE '{}'::jsonb END||
   CASE WHEN profile#>'{budgets,d3}'='10'::jsonb THEN '{"d3":50}'::jsonb ELSE '{}'::jsonb END),
 version=version+1,updated_at=now()
WHERE collection_id IN (SELECT collection_id FROM expanded_reading_focus);

UPDATE core_run SET status='superseded',error='Reading budgets expanded; start a new refresh.',updated_at=now()
WHERE collection_id IN (SELECT collection_id FROM expanded_reading_focus)
AND status IN ('queued','running','paused','awaiting_evidence');
UPDATE core_candidate SET state='stale'
WHERE collection_id IN (SELECT collection_id FROM expanded_reading_focus);
UPDATE core_policy SET status=CASE WHEN status='active' THEN 'rolled_back' ELSE 'rejected' END
WHERE collection_id IN (SELECT collection_id FROM expanded_reading_focus)
AND status IN ('active','shadow','canary');
