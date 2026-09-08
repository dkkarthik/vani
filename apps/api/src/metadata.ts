import { createHash } from "node:crypto";
import { v7 as uuid } from "uuid";
import type { PoolClient } from "pg";
import {
  MetadataFields,
  metadataKeys,
  metadataEquivalent,
  metadataEmpty,
  metadataWarnings,
  type MetadataAssertion,
  type MetadataDocument,
} from "@vani/shared";
import { Repository } from "./repository.js";
import { transaction } from "./db.js";
import { normalizeTitle, venueAbbreviation } from "./lib/citations.js";
import { resolveMetadata, type SourceAssertion } from "./metadata-sources.js";
export function fail(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}
export const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const assertionOf = (row: any): MetadataAssertion => ({
  id: row.id,
  source: row.source,
  externalId: row.external_id,
  sourceUrl: row.source_url,
  metadata: row.metadata,
  raw: row.raw,
  authoritative: row.authoritative,
  createdAt: row.created_at.toISOString(),
});
export async function recordAssertion(
  client: PoolClient,
  workId: string,
  source: Omit<SourceAssertion, "metadata"> & {
    metadata: Partial<MetadataFields>;
  },
) {
  const fingerprint = hash({ metadata: source.metadata, raw: source.raw });
  const result = await client.query(
    `INSERT INTO metadata_assertion(id,work_id,source,external_id,source_url,metadata,raw,authoritative,payload_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(work_id,source,external_id,payload_hash) DO UPDATE SET source_url=EXCLUDED.source_url,created_at=now() RETURNING *`,
    [
      uuid(),
      workId,
      source.source,
      source.externalId,
      source.sourceUrl,
      JSON.stringify(source.metadata),
      JSON.stringify(source.raw),
      source.authoritative,
      fingerprint,
    ],
  );
  return assertionOf(result.rows[0]);
}
export function verification(
  fields: MetadataFields,
  assertion?: MetadataAssertion,
  reviewed = false,
  keep = false,
) {
  if (!assertion?.authoritative) return "unverified";
  const differences = metadataKeys.filter(
    (key) =>
      key in assertion.metadata &&
      !metadataEmpty(assertion.metadata[key]) &&
      !metadataEmpty(fields[key]) &&
      !metadataEquivalent(key, fields[key], assertion.metadata[key]),
  );
  if (differences.length) return keep ? "partial" : "conflict";
  const core: Array<keyof MetadataFields> = [
    "title",
    "authors",
    "year",
    "publicationType",
  ];
  const identity = fields.doi
    ? metadataEquivalent("doi", fields.doi, assertion.metadata.doi)
    : assertion.source === "arxiv" && fields.url === assertion.sourceUrl;
  const enough =
    core.every(
      (key) =>
        !metadataEmpty(fields[key]) &&
        !metadataEmpty(assertion.metadata[key]) &&
        metadataEquivalent(key, fields[key], assertion.metadata[key]),
    ) &&
    ((Boolean(fields.venue) &&
      metadataEquivalent("venue", fields.venue, assertion.metadata.venue)) ||
      (Boolean(fields.publisher) &&
        metadataEquivalent(
          "publisher",
          fields.publisher,
          assertion.metadata.publisher,
        )));
  return reviewed && identity && enough ? "verified" : "partial";
}
function canonical(work: any): MetadataFields {
  const input = {
    ...work,
    venue: work.venue === "Unknown venue" ? "" : work.venue,
  };
  for (const key of ["publicationDate", "onlineDate", "printDate"] as const)
    if (!MetadataFields.shape[key].safeParse(input[key]).success)
      input[key] = "";
  if (!MetadataFields.shape.doi.safeParse(input.doi).success) input.doi = null;
  return MetadataFields.parse(input);
}
export class MetadataRepository {
  constructor(private repository = new Repository()) {}
  async baseline(workId: string, client: PoolClient) {
    const work = await this.repository.getWork(workId, client);
    if (!work) fail(404, "Paper not found.");
    if (
      !(
        await client.query(
          "SELECT 1 FROM metadata_assertion WHERE work_id=$1 LIMIT 1",
          [workId],
        )
      ).rowCount
    ) {
      // Historical records may have an incomplete/non-ISO date; retain raw data and a valid baseline.
      const fields = canonical(work);
      await recordAssertion(client, workId, {
        source: "baseline",
        externalId: workId,
        sourceUrl: "",
        metadata: fields,
        raw: work,
        authoritative: false,
      });
    }
    return work;
  }
  async get(workId: string): Promise<MetadataDocument> {
    return transaction(async (client) => {
      await client.query("SELECT id FROM work WHERE id=$1 FOR UPDATE", [
        workId,
      ]);
      const work = await this.baseline(workId, client);
      const state = await client.query(
        "SELECT version,metadata_locks FROM work WHERE id=$1",
        [workId],
      );
      const assertions = await client.query(
        "SELECT * FROM metadata_assertion WHERE work_id=$1 ORDER BY created_at DESC,id DESC",
        [workId],
      );
      const decisions = await client.query(
        "SELECT * FROM metadata_decision WHERE work_id=$1 ORDER BY revision DESC,created_at DESC",
        [workId],
      );
      const fields = canonical(work);
      return {
        workId,
        citationKey: work.citationKey,
        fields,
        revision: state.rows[0].version,
        locks: state.rows[0].metadata_locks,
        verificationStatus: work.verificationStatus,
        assertions: assertions.rows.map(assertionOf),
        decisions: decisions.rows.map((row) => ({
          id: row.id,
          field: row.field,
          before: row.before_value,
          after: row.after_value,
          origin: row.origin,
          assertionId: row.assertion_id,
          reason: row.reason,
          revision: row.revision,
          createdAt: row.created_at.toISOString(),
        })),
        warnings: metadataWarnings(fields),
      };
    });
  }

  private async lock(client: PoolClient, id: string, revision: number) {
    const result = await client.query(
      "SELECT version,metadata_locks FROM work WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",
      [id],
    );
    if (!result.rows[0]) fail(404, "Paper not found.");
    if (result.rows[0].version !== revision)
      fail(
        409,
        "This paper changed in another session. Reload and review your changes before saving.",
      );
    return result.rows[0].metadata_locks as string[];
  }
  private async write(
    client: PoolClient,
    id: string,
    before: MetadataFields,
    after: MetadataFields,
    locks: string[],
    revision: number,
    status: string,
    origin: string,
    assertionId: string | null,
    reason: string,
    decided: Array<keyof MetadataFields>,
  ) {
    if (after.doi) {
      const duplicate = await client.query(
        "SELECT id FROM work WHERE lower(doi)=$1 AND id<>$2",
        [after.doi, id],
      );
      if (duplicate.rows[0])
        fail(
          409,
          `This DOI belongs to another paper: /read/${duplicate.rows[0].id}. Review the records before changing identity.`,
        );
    }
    let venueId = null;
    if (after.venue) {
      const venue = await client.query(
        "SELECT id FROM venue WHERE canonical_name=$1 LIMIT 1",
        [after.venue],
      );
      venueId = venue.rows[0]?.id ?? uuid();
      if (!venue.rows[0])
        await client.query(
          "INSERT INTO venue(id,canonical_name,abbreviation) VALUES($1,$2,$3)",
          [venueId, after.venue, venueAbbreviation(after.venue)],
        );
    }
    await client.query("DELETE FROM authorship WHERE work_id=$1", [id]);
    for (const [position, author] of after.authors.entries()) {
      const person = uuid();
      await client.query(
        "INSERT INTO person(id,given_names,family_name,display_name,orcid) VALUES($1,$2,$3,$4,$5)",
        [
          person,
          author.given,
          author.family,
          `${author.given} ${author.family}`.trim(),
          author.orcid ?? null,
        ],
      );
      await client.query(
        "INSERT INTO authorship(work_id,person_id,position) VALUES($1,$2,$3)",
        [id, person, position],
      );
    }
    const { title, abstract, year, doi, manifestationType } = after;
    const extra = Object.fromEntries(
      Object.entries(after).filter(
        ([key]) =>
          ![
            "title",
            "abstract",
            "year",
            "doi",
            "authors",
            "venue",
            "manifestationType",
          ].includes(key),
      ),
    );
    await client.query(
      `UPDATE work SET title=$2,normalized_title=$3,abstract=$4,year=$5,doi=$6,venue_id=$7,manifestation_type=$8,source_metadata=source_metadata||$9::jsonb,metadata_locks=$10,version=version+1,verification_status=$11,updated_at=now() WHERE id=$1`,
      [
        id,
        title,
        normalizeTitle(title),
        abstract,
        year,
        doi,
        venueId,
        manifestationType,
        JSON.stringify(extra),
        JSON.stringify(locks),
        status,
      ],
    );
    for (const field of decided)
      await client.query(
        "INSERT INTO metadata_decision(id,work_id,field,before_value,after_value,origin,assertion_id,reason,revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          uuid(),
          id,
          field,
          JSON.stringify(before[field]),
          JSON.stringify(after[field]),
          origin,
          assertionId,
          reason,
          revision + 1,
        ],
      );
    if (before.title !== after.title || before.abstract !== after.abstract)
      await client.query("DELETE FROM paper_first_pass WHERE work_id=$1", [id]);
  }
  async edit(
    id: string,
    revision: number,
    patch: Partial<MetadataFields>,
    reason = "",
  ) {
    await transaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('vani-browser-capture'))",
      );
      const locks = await this.lock(client, id, revision);
      const work = await this.baseline(id, client);
      const before = canonical(work);
      const after = MetadataFields.parse({ ...before, ...patch });
      const changed = metadataKeys.filter(
        (key) =>
          key in patch &&
          JSON.stringify(before[key]) !== JSON.stringify(after[key]),
      );
      if (!changed.length) return;
      const latest = (
        await client.query(
          "SELECT * FROM metadata_assertion WHERE work_id=$1 AND authoritative ORDER BY created_at DESC LIMIT 1",
          [id],
        )
      ).rows[0];
      await this.write(
        client,
        id,
        before,
        after,
        [...new Set([...locks, ...changed])],
        revision,
        verification(
          after,
          latest ? assertionOf(latest) : undefined,
          false,
          true,
        ),
        "user",
        null,
        reason,
        changed,
      );
    });
    return this.get(id);
  }
  async lookup(id: string, revision: number, identifier: string) {
    const source = await resolveMetadata(identifier);
    await transaction(async (client) => {
      await this.lock(client, id, revision);
      const work = await this.baseline(id, client);
      const assertion = await recordAssertion(client, id, source);
      const fields = canonical(work);
      await client.query(
        "UPDATE work SET verification_status=$2,version=version+1,updated_at=now() WHERE id=$1",
        [id, verification(fields, assertion)],
      );
    });
    return this.get(id);
  }
  async reconcile(
    id: string,
    revision: number,
    assertionId: string,
    fields: Array<keyof MetadataFields>,
    overrideLocks: boolean,
    keepCurrent: boolean,
    reason = "",
  ) {
    await transaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('vani-browser-capture'))",
      );
      let locks = await this.lock(client, id, revision);
      const work = await this.baseline(id, client);
      const result = await client.query(
        "SELECT * FROM metadata_assertion WHERE id=$1 AND work_id=$2",
        [assertionId, id],
      );
      if (!result.rows[0])
        fail(404, "Source assertion not found for this paper.");
      const assertion = assertionOf(result.rows[0]);
      if (fields.some((field) => locks.includes(field)) && !overrideLocks)
        fail(
          409,
          "Selected fields contain your corrections. Explicitly allow replacement or deselect those fields.",
        );
      if (fields.some((field) => !(field in assertion.metadata)))
        fail(400, "A selected field is absent from this source.");
      const before = canonical(work);
      const after = MetadataFields.parse({
        ...before,
        ...Object.fromEntries(
          fields.map((field) => [field, assertion.metadata[field]]),
        ),
      });
      locks = locks.filter(
        (field) => !fields.includes(field as keyof MetadataFields),
      );
      const kept = keepCurrent
        ? metadataKeys.filter(
            (field) =>
              field in assertion.metadata &&
              !fields.includes(field) &&
              !metadataEquivalent(
                field,
                before[field],
                assertion.metadata[field],
              ),
          )
        : [];
      await this.write(
        client,
        id,
        before,
        after,
        [...new Set([...locks, ...kept])],
        revision,
        verification(after, assertion, true, keepCurrent),
        "source_review",
        assertionId,
        reason,
        [...new Set([...fields, ...kept])],
      );
    });
    return this.get(id);
  }
}
