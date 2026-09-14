CREATE TABLE core_focus (
 collection_id uuid PRIMARY KEY REFERENCES collection(id) ON DELETE CASCADE,
 version integer NOT NULL DEFAULT 1, profile jsonb NOT NULL, history jsonb NOT NULL DEFAULT '[]',
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE core_policy (
 id uuid PRIMARY KEY, collection_id uuid NOT NULL REFERENCES collection(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'shadow' CHECK(status IN ('shadow','active','rejected','rolled_back')),
 parent_id uuid REFERENCES core_policy(id), settings jsonb NOT NULL, evaluation jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX core_policy_active ON core_policy(collection_id) WHERE status='active';
CREATE TABLE core_run (
 id uuid PRIMARY KEY, collection_id uuid NOT NULL REFERENCES collection(id) ON DELETE CASCADE,
 focus_version integer NOT NULL, snapshot jsonb NOT NULL, policy_id uuid REFERENCES core_policy(id),
 status text NOT NULL DEFAULT 'queued', phase text NOT NULL DEFAULT 'discovery',
 frontier jsonb NOT NULL DEFAULT '[]', coverage jsonb NOT NULL DEFAULT '[]', counters jsonb NOT NULL DEFAULT '{}',
 error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX core_run_active ON core_run(collection_id) WHERE status IN ('queued','running','paused');
CREATE TABLE core_candidate (
 id uuid PRIMARY KEY, collection_id uuid NOT NULL REFERENCES collection(id) ON DELETE CASCADE,
 identity text NOT NULL, work_id uuid REFERENCES work(id) ON DELETE SET NULL,
 paper jsonb NOT NULL, source_hash text NOT NULL, paths jsonb NOT NULL DEFAULT '[]',
 focus_version integer NOT NULL, run_id uuid NOT NULL REFERENCES core_run(id),
 stage text NOT NULL DEFAULT 'D0', state text NOT NULL DEFAULT 'pending',
 proximity text NOT NULL DEFAULT 'unassessed', role text NOT NULL DEFAULT 'unknown',
 features jsonb NOT NULL DEFAULT '{}', assessment jsonb NOT NULL DEFAULT '{}',
 feedback jsonb, expansion_eligible boolean NOT NULL DEFAULT false,
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(collection_id,identity)
);
CREATE INDEX core_candidate_frontier ON core_candidate(run_id,state,stage);
CREATE TABLE core_assessment (
 id uuid PRIMARY KEY, candidate_id uuid NOT NULL REFERENCES core_candidate(id) ON DELETE CASCADE,
 focus_version integer NOT NULL, source_hash text NOT NULL, stage text NOT NULL,
 result jsonb NOT NULL, sources jsonb NOT NULL DEFAULT '[]', provenance jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE core_embedding (
 source_hash text NOT NULL, model text NOT NULL, digest text NOT NULL, embedding jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(source_hash,model,digest)
);
CREATE TABLE core_artifact (
 id uuid PRIMARY KEY, candidate_id uuid NOT NULL REFERENCES core_candidate(id) ON DELETE CASCADE,
 kind text NOT NULL, identity text NOT NULL, predicate text NOT NULL, source jsonb NOT NULL,
 evidence_family text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(candidate_id,kind,identity,predicate)
);
CREATE TABLE core_audit (
 id uuid PRIMARY KEY, collection_id uuid NOT NULL REFERENCES collection(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('early','deep')), status text NOT NULL DEFAULT 'queued',
 snapshot jsonb NOT NULL, counters jsonb NOT NULL DEFAULT '{}', report jsonb NOT NULL DEFAULT '{}',
 policy_id uuid REFERENCES core_policy(id), next_attempt_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX core_audit_active ON core_audit(collection_id,kind) WHERE status IN ('queued','running','paused');
CREATE TABLE core_audit_item (
 audit_id uuid NOT NULL REFERENCES core_audit(id) ON DELETE CASCADE,
 candidate_id uuid NOT NULL REFERENCES core_candidate(id) ON DELETE CASCADE,
 snapshot jsonb NOT NULL, diagnostic jsonb NOT NULL DEFAULT '{}', judgment jsonb,
 sampling_probability double precision, state text NOT NULL DEFAULT 'pending',
 PRIMARY KEY(audit_id,candidate_id)
);
CREATE TABLE model_invocation (
 id uuid PRIMARY KEY, task text NOT NULL, collection_id uuid, provider text NOT NULL,
 model text NOT NULL, digest text, status text NOT NULL, reason text NOT NULL,
 input_tokens integer NOT NULL DEFAULT 0, output_tokens integer NOT NULL DEFAULT 0,
 duration_ms integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE model_approval (
 id uuid PRIMARY KEY, task text NOT NULL, collection_id uuid NOT NULL REFERENCES collection(id),
 candidate_id uuid REFERENCES core_candidate(id), reason text NOT NULL,
 max_tokens integer NOT NULL CHECK(max_tokens>0 AND max_tokens<=8192),
 consumed_at timestamptz, expires_at timestamptz NOT NULL DEFAULT now()+interval '1 hour'
);
ALTER TABLE answer ADD COLUMN request_key text;
CREATE UNIQUE INDEX answer_request_key ON answer(conversation_id,request_key) WHERE request_key IS NOT NULL;
CREATE TABLE conversation_request (
 conversation_id uuid NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
 request_key text NOT NULL, question text NOT NULL, status text NOT NULL DEFAULT 'queued',
 scope jsonb NOT NULL, answer_id uuid REFERENCES answer(id), error text,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(conversation_id,request_key)
);
ALTER TABLE core_policy DROP CONSTRAINT core_policy_status_check;
ALTER TABLE core_policy ADD CHECK(status IN ('shadow','canary','active','rejected','rolled_back'));
CREATE TABLE core_holdout (
 id uuid PRIMARY KEY, policy_id uuid NOT NULL REFERENCES core_policy(id),
 question text NOT NULL, phase text NOT NULL, snapshot jsonb NOT NULL,
 labels jsonb, exposed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(policy_id,question,phase)
);
CREATE TABLE core_feedback_history (
 id uuid PRIMARY KEY, candidate_id uuid NOT NULL REFERENCES core_candidate(id) ON DELETE CASCADE,
 judgment jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION core_sync_collection_focus() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.keywords IS DISTINCT FROM OLD.keywords OR NEW.discovery->>'topic' IS DISTINCT FROM OLD.discovery->>'topic' OR NEW.discovery->'workIds' IS DISTINCT FROM OLD.discovery->'workIds' THEN
  UPDATE core_focus SET history=history||jsonb_build_array(jsonb_build_object('version',version,'profile',profile,'at',now())),
   profile=profile||jsonb_build_object('publicQueries',to_jsonb(COALESCE(NEW.keywords,ARRAY[]::text[])))||
    CASE WHEN NEW.discovery->>'topic' IS DISTINCT FROM OLD.discovery->>'topic' AND length(NEW.discovery->>'topic')>=2 THEN jsonb_build_object('question',NEW.discovery->>'topic') ELSE '{}'::jsonb END||
    CASE WHEN NEW.discovery->'workIds' IS DISTINCT FROM OLD.discovery->'workIds' THEN jsonb_build_object('anchors',COALESCE((SELECT jsonb_agg(jsonb_build_object('workId',x,'weight',1)) FROM jsonb_array_elements_text(COALESCE(NEW.discovery->'workIds','[]')) x),'[]'::jsonb)) ELSE '{}'::jsonb END,
   version=version+1,updated_at=now() WHERE collection_id=NEW.id;
  UPDATE core_run SET status='superseded',error='Collection focus changed' WHERE collection_id=NEW.id AND status IN ('queued','running','paused');
  UPDATE core_candidate SET state='stale' WHERE collection_id=NEW.id;
  UPDATE core_policy SET status=CASE WHEN status='active' THEN 'rolled_back' ELSE 'rejected' END WHERE collection_id=NEW.id AND status IN ('active','shadow','canary');
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER core_collection_focus AFTER UPDATE OF keywords,discovery ON collection FOR EACH ROW EXECUTE FUNCTION core_sync_collection_focus();
ALTER TABLE model_approval DROP CONSTRAINT model_approval_max_tokens_check;
ALTER TABLE model_approval ADD CHECK(max_tokens>0 AND max_tokens<=65536);
ALTER TABLE model_approval ADD COLUMN packet_hash text NOT NULL;
