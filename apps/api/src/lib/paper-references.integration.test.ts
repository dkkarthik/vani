import { beforeAll, afterAll, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { v7 as uuid } from "uuid";
import { pool } from "../db.js";
import { migrate } from "../cli/migrate.js";
import { Repository } from "../repository.js";
import { collectionMembers } from "../collection-discovery.js";
import { registerSimpleDiscovery } from "../simple-discovery/routes.js";
import { storePaper } from "../simple-discovery/corpus.js";
import { savePaper } from "../simple-discovery/service.js";
import { paperReferences } from "./paper-references.js";
const enabled = process.env.VANI_INTEGRATION_TEST === "true";
beforeAll(async () => {
  if (enabled) await migrate();
});
afterAll(async () => {
  vi.unstubAllGlobals();
  if (enabled) await pool.end();
});

it.skipIf(!enabled)(
  "lists citations and PDFs for members and saved recommendations without network or enrichment, following merged works",
  async () => {
    const network = vi.fn(() => {
      throw Error("Listing papers must not call the network");
    });
    vi.stubGlobal("fetch", network);
    const repo = new Repository(),
      collectionId = uuid(),
      attachmentId = uuid();
    const paper = {
      title: `Bibliographic fixture ${uuid()}`,
      year: 2025,
      venue: "ICRA",
      doi: `10.9999/${uuid()}`,
      authors: [{ given: "Ada", family: "Researcher" }],
      pdfUrls: ["https://example.org/retained.pdf"],
      connector: "crossref",
      externalId: uuid(),
      sourcePayload: {
        link: [
          {
            "content-type": "application/pdf",
            URL: "https://example.org/fixture.pdf",
          },
        ],
      },
    };
    const work = await repo.createWork(paper),
      alias = await repo.createWork({ title: `Merged ${uuid()}` });
    await pool.query(
      "INSERT INTO collection(id,name) VALUES($1,'Citation fixture')",
      [collectionId],
    );
    await pool.query(
      "INSERT INTO collection_membership(collection_id,work_id) VALUES($1,$2)",
      [collectionId, work.id],
    );
    await pool.query("UPDATE work SET merged_into=$1 WHERE id=$2", [
      work.id,
      alias.id,
    ]);
    const hash = uuid();
    await pool.query(
      "INSERT INTO object_store(hash_sha256,byte_size,mime_type,storage_path) VALUES($1,100,'application/pdf','/tmp/reference-fixture.pdf')",
      [hash],
    );
    await pool.query(
      "INSERT INTO attachment(id,work_id,object_hash,filename) VALUES($1,$2,$3,'paper.pdf')",
      [attachmentId, alias.id, hash],
    );
    await pool.query(
      "INSERT INTO attachment(id,work_id,object_hash,filename,attachment_type) VALUES($1,$2,$3,'supplement.pdf','supplement')",
      [uuid(), work.id, hash],
    );
    const paperId = await storePaper(paper, {});
    await pool.query(
      "INSERT INTO simple_recommendation(collection_id,paper_id,score,explanation) VALUES($1,$2,1,'{}')",
      [collectionId, paperId],
    );
    expect((await savePaper(collectionId, paperId!)).workId).toBe(work.id);
    await pool.query(
      "UPDATE simple_recommendation SET work_id=$1 WHERE collection_id=$2 AND paper_id=$3",
      [alias.id, collectionId, paperId],
    );
    const local = {
      url: `/api/v1/attachments/${attachmentId}/content`,
      kind: "local",
    };
    const members = await collectionMembers(repo, collectionId);
    expect(members.items[0]!.reference!.text).toContain(
      "Ada Researcher (2025).",
    );
    expect(members.items[0]!.reference!.pdfLinks).toEqual([
      local,
      { url: "https://example.org/retained.pdf", kind: "source" },
      { url: "https://example.org/fixture.pdf", kind: "source" },
    ]);
    const app = Fastify();
    await registerSimpleDiscovery(app);
    const response = await app.inject(
      `/api/v1/collections/${collectionId}/recommendations?view=saved`,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().items[0].reference.pdfLinks[0]).toEqual(local);
    const external = await paperReferences([{ paper }]);
    expect(external[0]!.pdfLinks).toEqual([
      { url: "https://example.org/retained.pdf", kind: "source" },
      { url: "https://example.org/fixture.pdf", kind: "source" },
    ]);
    expect(network).not.toHaveBeenCalled();
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM paper_enrichment WHERE work_id=$1",
          [work.id],
        )
      ).rows[0].n,
    ).toBe(0);
    await app.close();
  },
);
