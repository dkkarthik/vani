import { buildApp } from "../app.js";
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { MetadataFields, BrowserCaptureInput } from "@vani/shared";
import { migrate } from "../cli/migrate.js";
import { pool, query, transaction } from "../db.js";
import { ImportRepository } from "./service.js";
import { MetadataRepository, recordAssertion } from "../metadata.js";
import { Repository } from "../repository.js";
import { CaptureRepository } from "../capture.js";
const enabled = process.env.VANI_INTEGRATION_TEST === "true";
beforeAll(async () => {
  if (enabled) await migrate();
});
afterAll(async () => {
  if (enabled) await pool.end();
});
afterEach(() => vi.unstubAllGlobals());
it.skipIf(!enabled)(
  "previews, corrects, commits and repeats imports while preserving originals, keys and research objects",
  async () => {
    const repo = new Repository(),
      imports = new ImportRepository(repo),
      metadata = new MetadataRepository(repo);
    const collection = await repo.createCollection({ name: "F02 integration" });
    const doi = `10.1234/${crypto.randomUUID()}`;
    const bib = Buffer.from(
      `@book{book,title={Imported book},author={{Research Institute}},year={2024},publisher={Press},doi={${doi}},note={Keep this note},file={:/old/paper.pdf:application/pdf},keywords={topic}}`,
    );
    const pdf = Buffer.concat([
      await readFile(new URL("./fixtures/paper.pdf", import.meta.url)),
      Buffer.from(`\n% ${doi}\n`),
    ]);
    let preview = await imports.prepare(
      collection.id,
      [
        { name: "library.bib", bytes: bib },
        { name: "paper.pdf", bytes: pdf },
        { name: "bad.ris", bytes: Buffer.from("TY  - JOUR\nTI  - broken") },
      ],
      "",
      false,
    );
    expect(preview.state).toBe("preview");
    expect(preview.items).toHaveLength(2);
    expect(preview.items[1]!.error).toBeTruthy();
    expect(
      (await query("SELECT id FROM work WHERE doi=$1", [doi])).rowCount,
    ).toBe(0);
    expect(preview.items[0]!.attachments).toHaveLength(1);
    const original = (
      await query(
        "SELECT storage_path FROM object_store WHERE hash_sha256=$1",
        [preview.files[1]!.hash],
      )
    ).rows[0]!;
    expect(await readFile(original.storage_path as string)).toEqual(pdf);
    const oldRevision = preview.revision;
    preview = await imports.edit(preview.id, preview.revision, [
      { id: preview.items[0]!.id, metadata: { title: "Corrected in preview" } },
    ]);
    await expect(imports.commit(preview.id, oldRevision)).rejects.toMatchObject(
      { statusCode: 409 },
    );
    const committed = await imports.commit(preview.id, preview.revision);
    expect(committed.state).toBe("complete");
    expect(committed.items[0]!.status).toBe("created");
    expect(committed.items[1]!.status).toBe("skipped");
    const workId = committed.items[0]!.workId!;
    let doc = await metadata.get(workId);
    const key = doc.citationKey;
    expect(doc.fields.title).toBe("Corrected in preview");
    expect(doc.locks).toContain("title");
    expect(doc.assertions[0]!.metadata.title).toBe("Imported book");
    doc = await metadata.edit(workId, doc.revision, {
      title: "My corrected title",
      authors: [{ given: "Ana", family: "García" }],
      edition: "Third",
    });
    expect(doc.locks).toContain("title");
    expect(doc.fields.edition).toBe("Third");
    await expect(
      metadata.edit(workId, doc.revision - 1, { title: "Stale" }),
    ).rejects.toMatchObject({ statusCode: 409 });
    const repeated = await imports.prepare(
      collection.id,
      [
        { name: "library.bib", bytes: bib },
        { name: "paper.pdf", bytes: pdf },
      ],
      "",
      false,
    );
    const [one, two] = await Promise.all([
      imports.commit(repeated.id, repeated.revision),
      imports.commit(repeated.id, repeated.revision),
    ]);
    expect([one.state, two.state]).toContain("complete");
    expect((await imports.get(repeated.id)).items[0]!.workId).toBe(workId);
    expect((await metadata.get(workId)).fields.title).toBe(
      "My corrected title",
    );
    expect((await metadata.get(workId)).citationKey).toBe(key);
    expect(
      (await query("SELECT id FROM attachment WHERE work_id=$1", [workId]))
        .rowCount,
    ).toBe(1);
    expect(
      (await query("SELECT id FROM note WHERE work_id=$1", [workId])).rowCount,
    ).toBe(1);
    expect(
      (
        await query("SELECT * FROM collection_membership WHERE work_id=$1", [
          workId,
        ])
      ).rowCount,
    ).toBe(1);
    const capture = await new CaptureRepository(repo).save(
      BrowserCaptureInput.parse({
        id: crypto.randomUUID(),
        collectionId: collection.id,
        sourceUrl: `https://example.org/paper/${doi}`,
        canonicalUrl: `https://example.org/paper/${doi}`,
        metadata: { title: "New browser title", doi },
        savePdf: false,
      }),
    );
    expect(capture.workId).toBe(workId);
    expect((await metadata.get(workId)).fields.title).toBe(
      "My corrected title",
    );
  },
);
it.skipIf(!enabled)(
  "records source review, rejects implicit lock replacement and wrong-work DOI, and preserves failed lookup state",
  async () => {
    const repo = new Repository(),
      metadata = new MetadataRepository(repo);
    const doi = `10.1234/${crypto.randomUUID()}`;
    const work = await repo.createWork({
      title: "Original",
      doi,
      authors: [{ given: "John", family: "Smith" }],
      year: 2024,
      venue: "Journal",
    });
    let doc = await metadata.get(work.id);
    doc = await metadata.edit(work.id, doc.revision, {
      title: "User correction",
    });
    const source = MetadataFields.parse({
      ...doc.fields,
      title: "Provider title",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            message: {
              DOI: doi,
              title: [source.title],
              author: source.authors,
              issued: { "date-parts": [[2024]] },
              "container-title": ["Journal"],
              type: "journal-article",
            },
          }),
        ),
      ),
    );
    doc = await metadata.lookup(work.id, doc.revision, doi);
    expect(doc.fields.title).toBe("User correction");
    expect(doc.verificationStatus).toBe("conflict");
    const assertion = doc.assertions.find(
      (item) => item.source === "crossref",
    )!;
    await expect(
      metadata.reconcile(
        work.id,
        doc.revision,
        assertion.id,
        ["title"],
        false,
        false,
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    doc = await metadata.reconcile(
      work.id,
      doc.revision,
      assertion.id,
      ["title"],
      true,
      false,
    );
    expect(doc.fields.title).toBe("Provider title");
    expect(doc.locks).not.toContain("title");
    expect(doc.verificationStatus).toBe("verified");
    expect(
      doc.decisions.some((decision) => decision.assertionId === assertion.id),
    ).toBe(true);
    const other = await repo.createWork({
      title: "Other work",
      doi: `10.1234/${crypto.randomUUID()}`,
    });
    await expect(
      metadata.edit(work.id, doc.revision, { doi: other.doi }),
    ).rejects.toMatchObject({ statusCode: 409 });
    const revision = doc.revision;
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));
    await expect(metadata.lookup(work.id, revision, doi)).rejects.toThrow(
      "Offline",
    );
    expect((await metadata.get(work.id)).revision).toBe(revision);
    const imported = await transaction((client) =>
      recordAssertion(client, work.id, {
        source: "import_csl",
        externalId: "local",
        sourceUrl: "",
        metadata: source,
        raw: {},
        authoritative: false,
      }),
    );
    doc = await metadata.reconcile(
      work.id,
      revision,
      imported.id,
      [],
      false,
      true,
    );
    expect(doc.verificationStatus).toBe("unverified");
    expect(doc.citationKey).toBe(work.citationKey);
  },
);
it.skipIf(!enabled)(
  "keeps successful rows across partial failure and retries without duplicating them",
  async () => {
    const repo = new Repository(),
      imports = new ImportRepository(repo);
    const collection = await repo.createCollection({ name: "Partial retry" });
    const seed = crypto.randomUUID();
    const preview = await imports.prepare(
      collection.id,
      [
        {
          name: "a.json",
          bytes: Buffer.from(
            JSON.stringify([
              { title: `One ${seed}` },
              { title: `Two ${seed}` },
            ]),
          ),
        },
      ],
      "",
      false,
    );
    const original = repo.createWork.bind(repo);
    let reject = true;
    vi.spyOn(repo, "createWork").mockImplementation(async (input, client) => {
      if (reject && input.title.startsWith("Two"))
        throw new Error("Simulated row failure");
      return original(input, client);
    });
    const partial = await imports.commit(preview.id, preview.revision);
    expect(partial.state).toBe("partial");
    expect(partial.items.map((item) => item.status)).toEqual([
      "created",
      "failed",
    ]);
    reject = false;
    const completed = await imports.commit(preview.id, partial.revision);
    expect(completed.state).toBe("complete");
    expect(completed.items[0]!.workId).toBe(partial.items[0]!.workId);
    expect(
      (
        await query(
          "SELECT * FROM collection_membership WHERE collection_id=$1",
          [collection.id],
        )
      ).rowCount,
    ).toBe(2);
  },
);
it.skipIf(!enabled)(
  "reuses an original DOI-less source even after preview and canonical corrections",
  async () => {
    const repo = new Repository(),
      imports = new ImportRepository(repo),
      metadata = new MetadataRepository(repo);
    const collection = await repo.createCollection({ name: "Source identity" });
    const upload = {
      name: "a.json",
      bytes: Buffer.from(
        JSON.stringify([
          {
            title: `DOI-less ${crypto.randomUUID()}`,
            author: [{ literal: "Institute" }],
          },
        ]),
      ),
    };
    let preview = await imports.prepare(collection.id, [upload], "", false);
    preview = await imports.edit(preview.id, preview.revision, [
      { id: preview.items[0]!.id, metadata: { title: "Preview correction" } },
    ]);
    const first = await imports.commit(preview.id, preview.revision);
    const id = first.items[0]!.workId!;
    const doc = await metadata.get(id);
    await metadata.edit(id, doc.revision, { title: "Later correction" });
    const repeated = await imports.prepare(collection.id, [upload], "", false);
    expect(repeated.items[0]!.matchId).toBe(id);
    expect(
      (await imports.commit(repeated.id, repeated.revision)).items[0]!.workId,
    ).toBe(id);
  },
);

it.skipIf(!enabled)(
  "does not save a slow lookup over a concurrent correction",
  async () => {
    const repo = new Repository(),
      metadata = new MetadataRepository(repo);
    const doi = `10.1234/${crypto.randomUUID()}`;
    const work = await repo.createWork({ title: "Before lookup", doi });
    const initial = await metadata.get(work.id);
    let finish!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => response),
    );
    const lookup = metadata.lookup(work.id, initial.revision, doi);
    const rejected = expect(lookup).rejects.toMatchObject({ statusCode: 409 });
    const changed = await metadata.edit(work.id, initial.revision, {
      title: "While offline",
    });
    finish(
      new Response(
        JSON.stringify({ message: { DOI: doi, title: ["Provider response"] } }),
      ),
    );
    await rejected;
    const final = await metadata.get(work.id);
    expect(final.fields.title).toBe("While offline");
    expect(final.revision).toBe(changed.revision);
    expect(final.assertions).toHaveLength(initial.assertions.length);
  },
);

it.skipIf(!enabled)(
  "HTTP partial metadata and preview edits preserve all omitted fields",
  async () => {
    const repo = new Repository(),
      imports = new ImportRepository(repo);
    const app = await buildApp(repo);
    try {
      const fields = {
        title: `Partial patch ${crypto.randomUUID()}`,
        authors: [{ given: "Ana", family: "García" }],
        year: 2024,
        publisher: "Press",
        edition: "2",
      };
      const work = await repo.createWork(fields);
      const response = await app.inject({
        method: "PATCH",
        url: `/api/v1/works/${work.id}/metadata`,
        payload: { revision: 1, patch: { title: "Title only" } },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().fields).toMatchObject({
        ...fields,
        title: "Title only",
      });
      expect(response.json().locks).toEqual(["title"]);
      const collection = await repo.createCollection({
        name: "HTTP preview patch",
      });
      const preview = await imports.prepare(
        collection.id,
        [
          {
            name: "a.json",
            bytes: Buffer.from(
              JSON.stringify([
                {
                  title: fields.title,
                  author: fields.authors,
                  issued: { "date-parts": [[2024]] },
                  publisher: "Press",
                },
              ]),
            ),
          },
        ],
        "",
        false,
      );
      const edited = await app.inject({
        method: "PATCH",
        url: `/api/v1/imports/${preview.id}`,
        payload: {
          revision: preview.revision,
          items: [
            {
              id: preview.items[0]!.id,
              metadata: { title: "Preview title only" },
            },
          ],
        },
      });
      expect(edited.statusCode).toBe(200);
      expect(edited.json().items[0].metadata).toMatchObject({
        title: "Preview title only",
        authors: fields.authors,
        year: 2024,
        publisher: "Press",
      });
      expect(edited.json().items[0].sourceMetadata.title).toBe(fields.title);
    } finally {
      await app.close();
    }
  },
);
