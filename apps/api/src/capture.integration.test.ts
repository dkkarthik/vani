import { afterAll, beforeAll, expect, it } from "vitest";
import { BrowserCaptureInput } from "@vani/shared";
import { migrate } from "./cli/migrate.js";
import { pool, query } from "./db.js";
import { CaptureRepository } from "./capture.js";
import { Repository } from "./repository.js";
// Opt-in: DATABASE_URL and VANI_DATA_DIR must point at disposable test storage.
const enabled = process.env.VANI_INTEGRATION_TEST === "true";
beforeAll(async () => {
  if (enabled) await migrate();
});
afterAll(async () => {
  if (enabled) await pool.end();
});
it.skipIf(!enabled)(
  "captures atomically, deduplicates concurrent retries and PDFs, and preserves source provenance",
  async () => {
    const repository = new Repository();
    const captures = new CaptureRepository(repository);
    const collection = await repository.createCollection({
      name: "Capture integration",
    });
    const other = await repository.createCollection({
      name: "Capture integration second collection",
    });
    const doi = `10.1234/${crypto.randomUUID()}`;
    const input = BrowserCaptureInput.parse({
      id: crypto.randomUUID(),
      collectionId: collection.id,
      sourceUrl: "https://publisher.test/article?ref=email",
      canonicalUrl: `https://publisher.test/${doi}`,
      metadata: {
        title: "Browser capture integration paper",
        doi,
        authors: [{ given: "Ada", family: "Lovelace" }],
        year: 2026,
      },
      pdfUrl: "https://publisher.test/full.pdf",
      savePdf: true,
    });
    const [first, retried] = await Promise.all([
      captures.save(input),
      captures.save(input),
    ]);
    expect(first.workId).toBe(retried.workId);
    expect(first.pdfStatus).toBe("pending");
    expect(first.duplicate).toBe(false);
    await expect(
      captures.save({
        ...input,
        metadata: { ...input.metadata, title: "Changed" },
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    const second = await captures.save({
      ...input,
      id: crypto.randomUUID(),
      collectionId: other.id,
      canonicalUrl: `https://other.test/${doi}`,
      sourceUrl: `https://other.test/${doi}`,
      metadata: { ...input.metadata, title: "Publisher alternate title" },
    });
    expect(second.workId).toBe(first.workId);
    expect(second.duplicate).toBe(true);
    expect((await repository.getWork(first.workId))?.title).toBe(
      input.metadata.title,
    );
    expect(
      (await captures.forWork(first.workId)).map((item) => item.sourceUrl),
    ).toContain(input.sourceUrl);
    expect(
      (
        await query("SELECT * FROM collection_membership WHERE work_id=$1", [
          first.workId,
        ])
      ).rowCount,
    ).toBe(2);
    await expect(
      captures.pdf(
        first.id,
        Buffer.from("<html>Login required</html>"),
        "paper.pdf",
      ),
    ).rejects.toMatchObject({ statusCode: 415 });
    await captures.pdfFailed(first.id, "Publisher login required");
    expect((await captures.get(first.id))?.pdfStatus).toBe("failed");
    const pdf = Buffer.from("%PDF-1.7\nfixture content\n%%EOF");
    const [attached, repeated] = await Promise.all([
      captures.pdf(first.id, pdf, "../../paper.pdf"),
      captures.pdf(second.id, pdf, "paper.pdf"),
    ]);
    expect(attached.attachmentId).toBe(repeated.attachmentId);
    expect(attached.pdfStatus).toBe("saved");
    expect(
      (await query("SELECT * FROM attachment WHERE work_id=$1", [first.workId]))
        .rowCount,
    ).toBe(1);
    expect(
      (await captures.pdfFailed(first.id, "Lost upload response")).pdfStatus,
    ).toBe("saved");
    const absent = {
      ...input,
      id: crypto.randomUUID(),
      collectionId: crypto.randomUUID(),
      canonicalUrl: "https://publisher.test/missing",
      metadata: { ...input.metadata, doi: "10.1234/missingcollection" },
    };
    await expect(captures.save(absent)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(
      (await query("SELECT * FROM work WHERE doi=$1", [absent.metadata.doi]))
        .rowCount,
    ).toBe(0);
    const generic = {
      ...input,
      id: crypto.randomUUID(),
      canonicalUrl: `https://first.test/${crypto.randomUUID()}`,
      metadata: { ...input.metadata, doi: null, title: "An introduction" },
      savePdf: false,
    };
    const firstGeneric = await captures.save(generic);
    const otherGeneric = await captures.save({
      ...generic,
      id: crypto.randomUUID(),
      canonicalUrl: `https://second.test/${crypto.randomUUID()}`,
    });
    expect(otherGeneric.workId).not.toBe(firstGeneric.workId);
    const repeatGeneric = await captures.save({
      ...generic,
      id: crypto.randomUUID(),
    });
    expect(repeatGeneric.workId).toBe(firstGeneric.workId);
  },
);
