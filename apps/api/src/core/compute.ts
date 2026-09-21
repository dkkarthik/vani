import { v7 as uuid } from "uuid";
import { pool } from "../db.js";
import { hash, Focus, type ValidationIssue } from "./algorithm.js";
import {
  type Invocation,
  type ModelTask,
  taskLimits,
} from "../models/router.js";
export const READER_VERSION = "evidence-reader-v2";
export type ReadPacket = {
  version: string;
  instruction: string;
  input: any;
  schema: any;
  model: string;
  digest: string;
  task: ModelTask;
  limits: typeof taskLimits.d2;
};
export function fingerprint(packet: ReadPacket) {
  return hash(packet);
}
export function pauseReason(statuses: string[], calls: number, limit: number) {
  const failed = (s: string) => ["rejected", "error", "started"].includes(s);
  if (statuses.length >= 5 && statuses.slice(0, 5).every(failed))
    return "Five consecutive model attempts failed evidence or output validation.";
  if (statuses.length >= 10 && statuses.slice(0, 10).filter(failed).length >= 8)
    return "At least eight of the last ten model attempts failed.";
  if (calls >= limit)
    return `This stage used its ${limit}-call wave budget. Review results before another wave.`;
  return null;
}
export async function holdRun(id: string, reason: string) {
  await pool.query(
    "UPDATE core_run SET status='paused',error=$2,compute_control=compute_control||jsonb_build_object('held',true,'reason',$2::text),updated_at=now() WHERE id=$1 AND status IN ('queued','running','paused')",
    [id, reason],
  );
}
export async function checkWave(run: any, stage: string) {
  const task = stage.startsWith("D1") ? "d1" : stage.toLowerCase();
  const limit = (Focus.parse(run.snapshot).compute as any)[task] ?? 10;
  const rows = (
    await pool.query(
      "SELECT status,stage FROM core_read_attempt WHERE run_id=$1 AND created_at>=COALESCE(($2::jsonb->>'waveStartedAt')::timestamptz,'-infinity') ORDER BY created_at DESC",
      [run.id, JSON.stringify(run.compute_control ?? {})],
    )
  ).rows;
  const statuses = rows
    .filter(
      (r) => (r.stage.startsWith("D1") ? "d1" : r.stage.toLowerCase()) === task,
    )
    .map((r) => r.status);
  const reason = pauseReason(statuses, statuses.length, limit);
  if (reason) await holdRun(run.id, reason);
  return !reason;
}
export async function beginAttempt(
  run: any,
  candidate: any,
  packet: ReadPacket,
) {
  const inputHash = fingerprint(packet);
  const previous = (
    await pool.query(
      "SELECT * FROM core_read_fingerprint WHERE candidate_id=$1 AND input_hash=$2",
      [candidate.id, inputHash],
    )
  ).rows[0];
  const known = (
    await pool.query(
      "SELECT 1 FROM core_read_fingerprint WHERE candidate_id=$1 LIMIT 1",
      [candidate.id],
    )
  ).rowCount;
  const override = candidate.assessment?.explicitReadingOverride === true;
  if (
    !override &&
    (previous?.terminal ||
      previous?.calls >= 2 ||
      (!known && candidate.attempts >= 3))
  ) {
    await pool.query(
      "UPDATE core_candidate SET state='blocked',last_error=COALESCE(last_error,'Unchanged evidence packet already processed; use an explicit targeted re-read to override.') WHERE id=$1",
      [candidate.id],
    );
    return null;
  }
  if (!(await checkWave(run, candidate.stage))) return null;
  candidate.attempts = previous?.calls ?? 0;
  const id = uuid();
  await pool.query(
    "INSERT INTO core_read_fingerprint(candidate_id,input_hash,calls) VALUES($1,$2,1) ON CONFLICT(candidate_id,input_hash) DO UPDATE SET calls=core_read_fingerprint.calls+1",
    [candidate.id, inputHash],
  );
  await pool.query(
    "INSERT INTO core_read_attempt(id,candidate_id,run_id,collection_id,stage,input_hash,packet) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      id,
      candidate.id,
      run.id,
      run.collection_id,
      candidate.stage,
      inputHash,
      JSON.stringify(packet),
    ],
  );
  await pool.query(
    "UPDATE core_candidate SET assessment=assessment-'explicitReadingOverride' WHERE id=$1",
    [candidate.id],
  );
  await pool.query(
    "UPDATE core_read_attempt SET packet=packet-'input'-'instruction'-'schema',raw_output=NULL,result=NULL WHERE candidate_id=$1 AND id NOT IN (SELECT id FROM core_read_attempt WHERE candidate_id=$1 ORDER BY created_at DESC LIMIT 20)",
    [candidate.id],
  );
  return id;
}
export async function finishAttempt(
  id: string,
  status: string,
  issues: ValidationIssue[],
  raw: string | undefined,
  result: any,
  invocation: Invocation | undefined,
  duration: number,
) {
  if (["accepted", "rejected"].includes(status))
    await pool.query(
      "UPDATE core_read_fingerprint SET terminal=true WHERE (candidate_id,input_hash) IN (SELECT candidate_id,input_hash FROM core_read_attempt WHERE id=$1)",
      [id],
    );
  await pool.query(
    "UPDATE core_read_attempt SET status=$2,issues=$3,raw_output=$4,output_truncated=$5,result=$6,invocation=$7,duration_ms=$8,finished_at=now() WHERE id=$1",
    [
      id,
      status,
      JSON.stringify(issues),
      raw?.slice(0, 65536) ?? null,
      (raw?.length ?? 0) > 65536,
      result ? JSON.stringify(result) : null,
      invocation ? JSON.stringify(invocation) : null,
      Math.min(2147483647, duration),
    ],
  );
}
export async function computeSummary(collectionId: string) {
  const stages = (
    await pool.query(
      `SELECT stage,count(*)::int attempts,count(*) FILTER(WHERE status='accepted')::int accepted,
  count(*) FILTER(WHERE status='rejected')::int rejected,count(*) FILTER(WHERE status='error')::int errors,
  COALESCE(sum(COALESCE((invocation->>'durationMs')::int,duration_ms)),0)::float duration_ms,COALESCE(sum((invocation->>'outputTokens')::int),0)::float output_tokens
  FROM core_read_attempt WHERE collection_id=$1 GROUP BY stage ORDER BY stage`,
      [collectionId],
    )
  ).rows;
  const issues = (
    await pool.query(
      "SELECT issue->>'code' code,count(*)::int count FROM core_read_attempt,jsonb_array_elements(issues) issue WHERE collection_id=$1 GROUP BY issue->>'code' ORDER BY count(*) DESC",
      [collectionId],
    )
  ).rows;
  return {
    stages,
    issues,
    scope:
      "All attempt metadata; full packets retained for the latest 20 per candidate. JSON completion is not evidence acceptance.",
  };
}
