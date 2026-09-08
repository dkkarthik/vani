import { BrowserCaptureInput } from "@vani/shared";
import { readSettings, localAddress, request } from "./client";
import { busy, runCapture, type CaptureJob } from "./jobs";

let running: Promise<void> | null = null;
let gate = Promise.resolve();
const settings = readSettings;
const persist = async (job: CaptureJob) => {
  await chrome.storage.local.set({ job });
  await chrome.action.setBadgeBackgroundColor({
    color:
      job.state === "complete"
        ? "#287362"
        : job.state === "partial" || job.state === "error"
          ? "#a66a20"
          : "#365b51",
  });
  await chrome.action.setBadgeText({
    text:
      job.state === "complete"
        ? "✓"
        : job.state === "partial" || job.state === "error"
          ? "!"
          : "…",
  });
};

async function handle(message: any) {
  if (message.type === "status") {
    const { job } = (await chrome.storage.local.get("job")) as {
      job?: CaptureJob;
    };
    if (busy(job) && !running) {
      job!.state = job!.result ? "partial" : "error";
      job!.message =
        "Chrome interrupted the previous save. Retry to finish; already saved records will be reused.";
      await persist(job!);
    }
    return { job };
  }
  if (message.type === "collections")
    return request(await settings(), "/capture/collections");
  if (message.type === "resolve")
    return request(await settings(), "/capture/resolve", {
      method: "POST",
      body: JSON.stringify({ doi: message.doi }),
    });
  if (message.type === "createCollection")
    return request(await settings(), "/capture/collections", {
      method: "POST",
      body: JSON.stringify({ name: String(message.name).trim() }),
    });
  if (message.type === "start" || message.type === "retry") {
    // Queue just the transition, not the network job, to prevent double-click races.
    let job!: CaptureJob;
    const start = gate.then(async () => {
      if (running)
        throw new Error("A save is already running. Wait for it to finish.");
      const connection = await settings();
      localAddress(connection.baseUrl);
      if (message.type === "retry") {
        const previous = (await chrome.storage.local.get("job")).job as
          CaptureJob | undefined;
        if (!previous)
          throw new Error("There is no previous capture to retry.");
        job = { ...previous, pdfAllowed: Boolean(message.pdfAllowed) };
      } else {
        const input = BrowserCaptureInput.parse(message.input);
        const downloadUrl = input.savePdf ? String(message.downloadUrl) : null;
        if (downloadUrl) {
          const url = new URL(downloadUrl);
          if (
            url.protocol !== "https:" ||
            url.username ||
            url.password ||
            downloadUrl.length > 4096
          )
            throw new Error("Choose an HTTPS PDF download.");
        }
        job = {
          input,
          downloadUrl,
          pdfAllowed: Boolean(message.pdfAllowed),
          baseUrl: connection.baseUrl,
          state: "saving",
          message: "Saving paper…",
          updatedAt: Date.now(),
        };
      }
      await chrome.storage.local.set({
        settings: { ...connection, lastCollectionId: job.input.collectionId },
      });
      // Assign before the first async persistence so another start cannot race.
      running = runCapture(job, connection, persist).finally(() => {
        running = null;
      });
    });
    gate = start.catch(() => undefined);
    await start;
    return { job };
  }
  throw new Error("Unknown extension action.");
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    sender.id !== chrome.runtime.id ||
    !sender.url ||
    !["popup.html", "options.html"].some(
      (path) => sender.url === chrome.runtime.getURL(path),
    )
  )
    return false;
  void handle(message).then(
    (data) => sendResponse({ ok: true, data }),
    (error) =>
      sendResponse({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "VANI could not complete this action.",
      }),
  );
  return true;
});
