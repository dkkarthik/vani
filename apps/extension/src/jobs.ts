import { BrowserCaptureInput, type CaptureResult } from "@vani/shared";
import { downloadPdf, request, type Settings } from "./client";

export interface CaptureJob {
  input: BrowserCaptureInput;
  downloadUrl: string | null;
  pdfAllowed: boolean;
  baseUrl: string;
  state:
    "saving" | "downloading" | "uploading" | "complete" | "error" | "partial";
  message: string;
  updatedAt: number;
  result?: CaptureResult;
}
export const busy = (job?: CaptureJob | null) =>
  Boolean(job && ["saving", "downloading", "uploading"].includes(job.state));

export async function runCapture(
  job: CaptureJob,
  settings: Settings,
  persist: (job: CaptureJob) => Promise<void>,
  dependencies = { request, downloadPdf },
) {
  const update = async (patch: Partial<CaptureJob>) => {
    Object.assign(job, patch, { updatedAt: Date.now() });
    await persist({ ...job });
  };
  try {
    if (settings.baseUrl !== job.baseUrl)
      throw new Error(
        "The VANI address changed. Reconnect to the original service to retry this save.",
      );
    await update({ state: "saving", message: "Saving paper and collection…" });
    const result = await dependencies.request<CaptureResult>(
      settings,
      "/captures",
      { method: "POST", body: JSON.stringify(job.input) },
    );
    await update({ result });
    if (job.input.savePdf && result.pdfStatus !== "saved") {
      try {
        if (!job.pdfAllowed)
          throw new Error(
            "PDF access was not granted. Allow access to the download site when retrying, or attach the PDF in VANI.",
          );
        await update({
          state: "downloading",
          message: "Paper saved. Downloading PDF…",
        });
        const pdf = await dependencies.downloadPdf(job.downloadUrl!);
        await update({
          state: "uploading",
          message: "Paper saved. Attaching PDF…",
        });
        const form = new FormData();
        form.append("file", pdf, `${result.citationKey}.pdf`);
        const attached = await dependencies.request<CaptureResult>(
          settings,
          `/captures/${result.id}/pdf`,
          { method: "POST", body: form },
        );
        await update({ result: attached });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "PDF download failed. Attach the PDF in VANI or retry.";
        const recorded = await dependencies
          .request<CaptureResult>(settings, `/captures/${result.id}`, {
            method: "PATCH",
            body: JSON.stringify({ message }),
          })
          .catch(() => undefined);
        // A lost upload response can still have committed a PDF. Honor the API's final state.
        if (recorded?.pdfStatus === "saved") {
          await update({ result: recorded });
        } else {
          await update({
            state: "partial",
            message: `Paper saved; PDF not attached. ${message}`,
            result: recorded ?? result,
          });
          return;
        }
      }
    }
    await update({
      state: "complete",
      message:
        job.result?.pdfStatus === "saved"
          ? "Paper and PDF saved to your collection."
          : "Paper saved to your collection.",
    });
  } catch (error) {
    await update({
      state: "error",
      message:
        error instanceof Error
          ? error.message
          : "Save interrupted. Retry to finish saving this paper.",
    });
  }
}
