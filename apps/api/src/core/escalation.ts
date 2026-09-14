import { createHash } from "node:crypto";
import { v7 as uuid } from "uuid";
import { pool, transaction } from "../db.js";
import { config } from "../config.js";
import { generate, taskLimits } from "../models/router.js";
import { Assessment, validateAssessment } from "./algorithm.js";
const instruction =
  "Reassess this unresolved academic comparison. Return JSON matching this schema: " +
  JSON.stringify(Assessment.toJSONSchema()) +
  " Cite exact supplied quotes from both works for closest proximity. Experimental compatibility is separate. Missing details remain unknown. This is a bounded evidence packet, not a full paper read.";
export async function escalationPacket(id: string) {
  if (process.env.VANI_CLOUD_MODE !== "approved" || !config.openAiKey)
    throw Object.assign(
      Error(
        "Cloud escalation is disabled. Configure explicit approval mode and daily/monthly token caps first.",
      ),
      { statusCode: 409 },
    );
  const c = (
    await pool.query(
      "SELECT c.*,f.profile,f.version FROM core_candidate c JOIN core_focus f ON f.collection_id=c.collection_id WHERE c.id=$1",
      [id],
    )
  ).rows[0];
  if (!c || c.focus_version !== c.version)
    throw Object.assign(Error("Current candidate assessment required."), {
      statusCode: 409,
    });
  const a = (
    await pool.query(
      "SELECT * FROM core_assessment WHERE candidate_id=$1 AND focus_version=$2 AND stage IN ('D2','D3') ORDER BY created_at DESC LIMIT 1",
      [id, c.version],
    )
  ).rows[0];
  if (!a)
    throw Object.assign(
      Error("Complete local targeted reading before requesting escalation."),
      { statusCode: 409 },
    );
  const ids = [
    c.work_id,
    ...c.profile.anchors.map((x: any) => x.workId),
  ].filter(Boolean);
  const works = (
    await pool.query(
      "SELECT id,access_class FROM work WHERE id=ANY($1::uuid[])",
      [ids],
    )
  ).rows;
  if (
    works.length !== new Set(ids).size ||
    works.some((w) => w.access_class !== "open_access")
  )
    throw Object.assign(
      Error(
        "Only verified open-access works are eligible; private, uploaded or unknown-access evidence remains local.",
      ),
      { statusCode: 403 },
    );
  // Private collection focus, notes and unpublished facet descriptions never enter the cloud packet.
  const evidence = {
    candidateId: c.id,
    anchors: c.profile.anchors.map((x: any) => x.workId),
    sources: a.sources,
  };
  const packetHash = createHash("sha256")
    .update(instruction + "\n" + JSON.stringify(evidence))
    .digest("hex");
  const reservedTokens =
    Buffer.byteLength(instruction + JSON.stringify(evidence)) +
    taskLimits.d3.output +
    512;
  if (reservedTokens > 65536)
    throw Object.assign(
      Error("Escalation packet exceeds the token reservation limit."),
      { statusCode: 413 },
    );
  return { candidate: c, evidence, packetHash, reservedTokens };
}
export async function escalate(
  id: string,
  expectedHash: string,
  reason: string,
) {
  const packet = await escalationPacket(id);
  if (packet.packetHash !== expectedHash)
    throw Object.assign(
      Error("Evidence changed; review a new escalation preview."),
      { statusCode: 409 },
    );
  const approvalId = uuid();
  await pool.query(
    "INSERT INTO model_approval(id,task,collection_id,candidate_id,reason,max_tokens,packet_hash) VALUES($1,'d3',$2,$3,$4,$5,$6)",
    [
      approvalId,
      packet.candidate.collection_id,
      id,
      reason,
      packet.reservedTokens,
      packet.packetHash,
    ],
  );
  const result = await generate(instruction, packet.evidence, Assessment, {
    task: "d3",
    collectionId: packet.candidate.collection_id,
    privateEvidence: false,
    approvalId,
  });
  if (
    !validateAssessment(
      result.value,
      packet.evidence.sources,
      id,
      packet.evidence.anchors,
      "D3",
      packet.candidate.profile.facets.map((f: any) => f.id),
    )
  )
    throw Object.assign(
      Error(
        "Cloud result failed source validation; reservation remains consumed.",
      ),
      { statusCode: 422 },
    );
  await transaction(async (db) => {
    const f = (
      await db.query(
        "SELECT version FROM core_focus WHERE collection_id=$1 FOR SHARE",
        [packet.candidate.collection_id],
      )
    ).rows[0];
    if (f.version !== packet.candidate.version)
      throw Object.assign(Error("Focus changed; cloud result is superseded."), {
        statusCode: 409,
      });
    await db.query(
      "INSERT INTO core_assessment(id,candidate_id,focus_version,source_hash,stage,result,sources,provenance) VALUES($1,$2,$3,$4,'D3',$5,$6,$7)",
      [
        uuid(),
        id,
        f.version,
        packet.candidate.source_hash,
        JSON.stringify(result.value),
        JSON.stringify(packet.evidence.sources),
        JSON.stringify({
          ...result.provenance,
          approvalId,
          packetHash: packet.packetHash,
        }),
      ],
    );
    await db.query(
      "UPDATE core_candidate SET assessment=$2,stage='D3',proximity=$3,role=$4,state=CASE WHEN state='accepted' THEN state ELSE 'reviewed' END,updated_at=now() WHERE id=$1",
      [
        id,
        JSON.stringify(result.value),
        result.value.proximity,
        result.value.role,
      ],
    );
  });
  return { assessment: result.value, provenance: result.provenance };
}
