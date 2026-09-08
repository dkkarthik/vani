// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { BrowserCaptureInput, type CaptureResult } from "@vani/shared";
import { downloadPdf, localAddress, request } from "./client";
import { runCapture, type CaptureJob } from "./jobs";
const settings = {
  baseUrl: "http://127.0.0.1:8080",
  appUrl: "http://127.0.0.1:5173",
  token: "a".repeat(64),
};
const makeJob = (savePdf = true): CaptureJob => ({
  input: BrowserCaptureInput.parse({
    id: crypto.randomUUID(),
    collectionId: crypto.randomUUID(),
    sourceUrl: "https://example.test/paper",
    canonicalUrl: "https://example.test/paper",
    metadata: { title: "A paper" },
    savePdf,
    pdfUrl: savePdf ? "https://example.test/paper.pdf" : null,
  }),
  downloadUrl: "https://example.test/paper.pdf",
  pdfAllowed: true,
  baseUrl: settings.baseUrl,
  state: "saving",
  message: "",
  updatedAt: Date.now(),
});
const result = (
  job: CaptureJob,
  pdfStatus: CaptureResult["pdfStatus"] = "pending",
): CaptureResult => ({
  id: job.input.id,
  collectionId: job.input.collectionId,
  workId: crypto.randomUUID(),
  title: "A paper",
  citationKey: "anon2026",
  sourceUrl: job.input.sourceUrl,
  canonicalUrl: job.input.canonicalUrl,
  pdfUrl: job.input.pdfUrl,
  pdfStatus,
  pdfMessage: "",
  attachmentId: null,
  duplicate: false,
  createdAt: new Date().toISOString(),
});
afterEach(() => vi.unstubAllGlobals());
it("persists metadata before downloading and completes after attaching the PDF", async () => {
  const job = makeJob();
  const states: string[] = [];
  const api = vi
    .fn()
    .mockResolvedValueOnce(result(job))
    .mockResolvedValueOnce(result(job, "saved"));
  const download = vi.fn(async () => {
    expect(api).toHaveBeenCalledTimes(1);
    return new Blob(["%PDF-1.7"]);
  });
  await runCapture(
    job,
    settings,
    async (current) => {
      states.push(current.state);
    },
    { request: api as typeof request, downloadPdf: download },
  );
  expect(job.state).toBe("complete");
  expect(states).toContain("uploading");
  expect(job.result?.pdfStatus).toBe("saved");
});
it.each(["denied", "download fails"])(
  "keeps metadata when PDF access %s",
  async (reason) => {
    const job = makeJob();
    job.pdfAllowed = reason !== "denied";
    const api = vi
      .fn()
      .mockResolvedValueOnce(result(job))
      .mockResolvedValueOnce(result(job, "failed"));
    const download = vi
      .fn()
      .mockRejectedValue(new Error("Publisher requires login"));
    await runCapture(job, settings, async () => {}, {
      request: api as typeof request,
      downloadPdf: download,
    });
    expect(job.state).toBe("partial");
    expect(job.result?.workId).toBeTruthy();
    if (reason === "denied") expect(download).not.toHaveBeenCalled();
    expect(api.mock.calls[1]?.[2].method).toBe("PATCH");
  },
);
it("reuses the capture ID on retry and avoids downloading a PDF already attached", async () => {
  const job = makeJob();
  const api = vi.fn().mockResolvedValue(result(job, "saved"));
  const download = vi.fn();
  await runCapture(job, settings, async () => {}, {
    request: api as typeof request,
    downloadPdf: download,
  });
  expect(JSON.parse(api.mock.calls[0]?.[2].body).id).toBe(job.input.id);
  expect(download).not.toHaveBeenCalled();
  expect(job.state).toBe("complete");
});
it("recovers a PDF upload whose successful response was lost", async () => {
  const job = makeJob();
  const api = vi
    .fn()
    .mockResolvedValueOnce(result(job))
    .mockRejectedValueOnce(new Error("Disconnected"))
    .mockResolvedValueOnce(result(job, "saved"));
  await runCapture(job, settings, async () => {}, {
    request: api as typeof request,
    downloadPdf: vi.fn().mockResolvedValue(new Blob(["%PDF-"])),
  });
  expect(job.state).toBe("complete");
});
it("does not download after a failed metadata save or retry against a different service", async () => {
  const job = makeJob();
  const api = vi.fn().mockRejectedValue(new Error("Service offline"));
  const download = vi.fn();
  await runCapture(job, settings, async () => {}, {
    request: api as typeof request,
    downloadPdf: download,
  });
  expect(job.state).toBe("error");
  expect(download).not.toHaveBeenCalled();
  api.mockClear();
  await runCapture(
    job,
    { ...settings, baseUrl: "http://localhost:8080" },
    async () => {},
    { request: api as typeof request, downloadPdf: download },
  );
  expect(api).not.toHaveBeenCalled();
});
it("rejects login HTML, oversized downloads, insecure URLs, and remote API addresses", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response("<html>Login</html>"));
  vi.stubGlobal("fetch", fetch);
  await expect(downloadPdf("https://publisher.test/paper.pdf")).rejects.toThrow(
    "not a PDF",
  );
  fetch.mockResolvedValue(
    new Response("pdf", { headers: { "content-length": "60000000" } }),
  );
  await expect(downloadPdf("https://publisher.test/paper.pdf")).rejects.toThrow(
    "50 MB",
  );
  await expect(downloadPdf("http://publisher.test/paper.pdf")).rejects.toThrow(
    "HTTPS",
  );
  expect(() => localAddress("https://remote.test")).toThrow("local VANI");
  fetch.mockResolvedValue(new Response("%PDF-1.7\nfixture"));
  expect(
    (await downloadPdf("https://publisher.test/paper.pdf")).size,
  ).toBeGreaterThan(0);
});
