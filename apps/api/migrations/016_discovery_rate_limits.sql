ALTER TABLE core_run ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE core_source_cooldown (
 source text PRIMARY KEY,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 failures integer NOT NULL DEFAULT 0
);
