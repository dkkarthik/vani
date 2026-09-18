import { it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { extractPdfMetadata } from "./pdf-metadata.js";
it("extracts a real two-column PDF without contaminating abstract with the other column or template date", async () => {
  const r = await extractPdfMetadata(
    await readFile(
      new URL("../research/fixtures/two-column.pdf", import.meta.url),
    ),
  );
  expect(r.title).toBe("Terrain Response for Reliable Robot Control");
  expect(r.abstract).toContain("combines robot sensing");
  expect(r.abstract).not.toContain("RIGHT COLUMN");
  expect(r.abstract).not.toContain("Introduction");
  expect(r).not.toHaveProperty("year");
});
