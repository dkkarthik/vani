CREATE TABLE core_run_candidate (
 run_id uuid NOT NULL REFERENCES core_run(id) ON DELETE CASCADE,
 candidate_id uuid NOT NULL REFERENCES core_candidate(id) ON DELETE CASCADE,
 snapshot jsonb NOT NULL,
 retrieved boolean NOT NULL DEFAULT false,
 paths jsonb NOT NULL DEFAULT '[]',
 partial_history boolean NOT NULL DEFAULT false,
 first_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(run_id,candidate_id)
);
CREATE TABLE core_run_event (
 id bigserial PRIMARY KEY,
 run_id uuid NOT NULL REFERENCES core_run(id) ON DELETE CASCADE,
 candidate_id uuid NOT NULL REFERENCES core_candidate(id) ON DELETE CASCADE,
 stage text NOT NULL,
 state text NOT NULL,
 detail jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX core_run_event_candidate ON core_run_event(run_id,candidate_id,id);
CREATE INDEX core_run_event_stage ON core_run_event(run_id,stage,candidate_id);
CREATE FUNCTION core_review_snapshot(c core_candidate) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('title',c.paper->>'title','paper',c.paper,'stage',c.stage,'state',c.state,'proximity',c.proximity,'role',c.role,'features',c.features-'embedding','assessment',c.assessment,'feedback',c.feedback,'last_error',c.last_error,'focus_version',c.focus_version);
$$;
INSERT INTO core_run_candidate(run_id,candidate_id,snapshot,partial_history)
 SELECT run_id,id,core_review_snapshot(c),true FROM core_candidate c WHERE run_id IS NOT NULL;
CREATE FUNCTION core_capture_review() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s jsonb;
BEGIN
 IF NEW.run_id IS NULL THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM core_run WHERE id=NEW.run_id AND status IN ('queued','running','paused','awaiting_evidence')) THEN RETURN NEW; END IF;
 s := core_review_snapshot(NEW);
 IF TG_OP='UPDATE' THEN
   IF NEW.run_id IS NOT DISTINCT FROM OLD.run_id AND s-'feedback'=core_review_snapshot(OLD)-'feedback' THEN RETURN NEW; END IF;
 END IF;
 INSERT INTO core_run_candidate(run_id,candidate_id,snapshot) VALUES(NEW.run_id,NEW.id,s)
 ON CONFLICT(run_id,candidate_id) DO UPDATE SET snapshot=excluded.snapshot,updated_at=clock_timestamp();
 INSERT INTO core_run_event(run_id,candidate_id,stage,state,detail)
 VALUES(NEW.run_id,NEW.id,NEW.stage,NEW.state,s-'paper');
 RETURN NEW;
END;
$$;
CREATE TRIGGER core_capture_review AFTER INSERT OR UPDATE ON core_candidate FOR EACH ROW EXECUTE FUNCTION core_capture_review();
