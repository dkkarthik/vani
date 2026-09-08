import { describe, expect, it } from "vitest";
import { parseBibliography, attachmentNames } from "./parse.js";
import {
  MetadataFields,
  MetadataPatch,
  metadataEquivalent,
} from "@vani/shared";
import { verification } from "../metadata.js";
describe("bibliography fidelity and diagnostics", () => {
  it("retains nested BibLaTeX titles, corporate names, book fields, notes and unmapped fields", () => {
    const [row] = parseBibliography(
      "library.bib",
      "@book{book,title={A {Nested} Title},author={{World Health Organization} and García, Ana},editor={Smith, Bob},year={2020},publisher={Press},edition={2},isbn={123},note={Hi},annote={Other},keywords={medicine},file={:/old/paper.pdf:application/pdf}}",
    );
    expect(row!.error).toBe("");
    expect(row!.metadata).toMatchObject({
      title: "A Nested Title",
      publicationType: "book",
      edition: "2",
      isbn: "123",
      editors: [{ given: "Bob", family: "Smith" }],
    });
    expect(row!.metadata!.authors).toEqual([
      { given: "", family: "World Health Organization" },
      { given: "Ana", family: "García" },
    ]);
    expect(row!.notes).toEqual(["Hi", "Other"]);
    expect(row!.references).toEqual(["paper.pdf"]);
    expect(row!.warnings.join(" ")).toContain("keywords");
    expect(row!.raw).toHaveProperty("properties.file");
  });
  it("keeps repeated RIS notes, multiline abstract, thesis type and Unicode names", () => {
    const [row] = parseBibliography(
      "a.ris",
      "TY  - THES\nTI  - Research\nAU  - García, Ana\nPY  - 2021\nAB  - First line\ncontinued line\nN1  - First note\nN1  - Second note\nKW  - knowledge\nER  -\n",
    );
    expect(row!.error).toBe("");
    expect(row!.metadata).toMatchObject({
      publicationType: "thesis",
      year: 2021,
    });
    expect(row!.metadata!.abstract).toContain("continued line");
    expect(row!.notes).toEqual(["First note", "Second note"]);
    expect(row!.warnings.join(" ")).toContain("KW");
  });
  it("reports invalid records without dropping their siblings", () => {
    const rows = parseBibliography(
      "a.json",
      JSON.stringify([
        {
          title: "Chapter",
          type: "chapter",
          "container-title": "Book",
          editor: [{ literal: "Institute" }],
          issued: { "date-parts": [[2024, 2, 29]] },
          tags: ["tag"],
        },
        { type: "book" },
      ]),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!.metadata?.publicationDate).toBe("2024-02-29");
    expect(rows[0]!.warnings.join(" ")).toContain("tags");
    expect(rows[1]!.included).toBe(false);
    expect(rows[1]!.error).toBeTruthy();
  });
  it("blocks malformed whole bibliographies and reports unsupported identifier lines", () => {
    expect(() =>
      parseBibliography(
        "a.bib",
        "@article{a,title={Ok}}\n@article{b,title={Unclosed}",
      ),
    ).toThrow();
    expect(() =>
      parseBibliography("a.ris", "TY  - JOUR\nTI  - Missing terminator"),
    ).toThrow();
    const rows = parseBibliography(
      "ids.txt",
      "https://doi.org/10.1234/ABC\narXiv:2401.01234v2\nPMID:123",
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]!.externalId).toBe("10.1234/abc");
    expect(rows[1]!.externalId).toBe("2401.01234v2");
    expect(rows[2]!.included).toBe(false);
    expect(
      attachmentNames(
        ":/unread/path/a.pdf:application/pdf;:/other/b.pdf:application/pdf",
      ),
    ).toEqual(["a.pdf", "b.pdf"]);
  });
});
describe("metadata validation and verification", () => {
  const fields = MetadataFields.parse({
    title: "A study: results",
    authors: [{ given: "John", family: "Smith" }],
    year: 2024,
    doi: "https://doi.org/10.1234/ABC",
    venue: "Journal",
  });
  const source = {
    id: "test",
    source: "crossref",
    externalId: fields.doi!,
    sourceUrl: "https://doi.org/10.1234/abc",
    metadata: fields,
    raw: {},
    authoritative: true,
    createdAt: "",
  };
  it("normalizes identifiers and meaningful equivalence without confusing different works", () => {
    expect(fields.doi).toBe("10.1234/abc");
    expect(metadataEquivalent("title", fields.title, "A study — results")).toBe(
      true,
    );
    expect(
      metadataEquivalent("authors", fields.authors, [
        { given: "J.", family: "Smith" },
      ]),
    ).toBe(true);
    expect(
      metadataEquivalent("authors", fields.authors, [
        { given: "James", family: "Smith" },
      ]),
    ).toBe(false);
    expect(metadataEquivalent("authors", fields.authors, [])).toBe(false);
    expect(
      MetadataFields.safeParse({ ...fields, publicationDate: "2023-02-29" })
        .success,
    ).toBe(false);
    expect(
      MetadataFields.safeParse({ ...fields, url: "javascript:alert(1)" })
        .success,
    ).toBe(false);
  });
  it("requires an explicit review, complete identity and authoritative agreement", () => {
    expect(verification(fields, source)).toBe("partial");
    expect(verification(fields, source, true)).toBe("verified");
    expect(verification({ ...fields, authors: [] }, source, true)).toBe(
      "partial",
    );
    expect(
      verification({ ...fields, title: "Different work" }, source, true),
    ).toBe("conflict");
    expect(
      verification({ ...fields, title: "Different work" }, source, true, true),
    ).toBe("partial");
    expect(
      verification(fields, { ...source, authoritative: false }, true),
    ).toBe("unverified");
  });
});

it("validates only supplied patch fields and rejects unknown fields", () => {
  expect(MetadataPatch.parse({ title: "Corrected" })).toEqual({
    title: "Corrected",
  });
  expect(MetadataPatch.parse({ doi: "https://doi.org/10.1234/ABC" })).toEqual({
    doi: "10.1234/abc",
  });
  expect(MetadataPatch.safeParse({ unexpected: "value" }).success).toBe(false);
  expect(MetadataPatch.safeParse({ year: 999 }).success).toBe(false);
});
