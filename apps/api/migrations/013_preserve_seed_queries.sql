-- Seed/topic changes must not erase explicitly configured search phrases.
CREATE OR REPLACE FUNCTION core_sync_collection_focus() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.keywords IS DISTINCT FROM OLD.keywords OR NEW.discovery->>'topic' IS DISTINCT FROM OLD.discovery->>'topic' OR NEW.discovery->'workIds' IS DISTINCT FROM OLD.discovery->'workIds' THEN
  UPDATE core_focus SET history=history||jsonb_build_array(jsonb_build_object('version',version,'profile',profile,'at',now())),
   profile=profile||
    CASE WHEN NEW.keywords IS DISTINCT FROM OLD.keywords THEN jsonb_build_object('publicQueries',to_jsonb(COALESCE(NEW.keywords,ARRAY[]::text[]))) ELSE '{}'::jsonb END||
    CASE WHEN NEW.discovery->>'topic' IS DISTINCT FROM OLD.discovery->>'topic' AND length(NEW.discovery->>'topic')>=2 THEN jsonb_build_object('question',NEW.discovery->>'topic') ELSE '{}'::jsonb END||
    CASE WHEN NEW.discovery->'workIds' IS DISTINCT FROM OLD.discovery->'workIds' THEN jsonb_build_object('anchors',COALESCE((SELECT jsonb_agg(jsonb_build_object('workId',x,'weight',1)) FROM jsonb_array_elements_text(COALESCE(NEW.discovery->'workIds','[]')) x),'[]'::jsonb)) ELSE '{}'::jsonb END,
   version=version+1,updated_at=now() WHERE collection_id=NEW.id;
  UPDATE core_run SET status='superseded',error='Collection focus changed' WHERE collection_id=NEW.id AND status IN ('queued','running','paused');
  UPDATE core_candidate SET state='stale' WHERE collection_id=NEW.id;
  UPDATE core_policy SET status=CASE WHEN status='active' THEN 'rolled_back' ELSE 'rejected' END WHERE collection_id=NEW.id AND status IN ('active','shadow','canary');
 END IF;
 RETURN NEW;
END $$;
