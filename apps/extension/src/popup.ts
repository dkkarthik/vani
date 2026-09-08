import { BrowserCaptureInput, type Collection } from "@vani/shared";
import { defaults, localAddress, readSettings, type Settings } from "./client";
import {
  extractMetadata,
  normalizeDoi,
  parseAuthors,
  readPage,
  safeUrl,
  type ExtractedPage,
} from "./extract";
import { busy, type CaptureJob } from "./jobs";

const element = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const input = (id: string) => element<HTMLInputElement>(id);
const select = (id: string) => element<HTMLSelectElement>(id);
const message = (text: string) => {
  element("notice").textContent = text;
  element("notice").hidden = !text;
};
const send = async <T>(value: unknown): Promise<T> => {
  const response = await chrome.runtime.sendMessage(value);
  if (!response?.ok)
    throw new Error(
      response?.error ||
        "The extension could not respond. Reopen it and retry.",
    );
  return response.data;
};
let page: ExtractedPage | undefined;
let job: CaptureJob | undefined;
let settings: Settings = defaults;
let submitting = false;
const enableSave = () => {
  element<HTMLButtonElement>("save").disabled =
    !page || !select("collection").value || busy(job) || submitting;
};
const report = (error: unknown) =>
  message(
    error instanceof Error ? error.message : "Capture failed. Please retry.",
  );
function renderJob(value?: CaptureJob) {
  job = value;
  element("job").hidden = !job;
  if (job) {
    element("job").dataset.state = job.state;
    element("job-title").textContent =
      `${job.result?.duplicate ? "Existing paper · " : ""}${job.input.metadata.title}`;
    element("job-message").textContent = job.message;
    element("retry").hidden = !["error", "partial"].includes(job.state);
    const link = element<HTMLAnchorElement>("open-work");
    link.hidden = !job.result;
    if (job.result)
      link.href = `${localAddress(settings.appUrl)}/read/${job.result.workId}`;
  }
  enableSave();
}
async function pdfPermission(url: string | null): Promise<boolean> {
  if (!url) return false;
  return chrome.permissions
    .request({ origins: [`${new URL(url).origin}/*`] })
    .catch(() => false);
}
function addCollection(collection: Collection) {
  select("collection").append(new Option(collection.name, collection.id));
}

element("settings").addEventListener("click", () =>
  chrome.runtime.openOptionsPage(),
);
element("new-collection").addEventListener("click", () => {
  element("collection-editor").hidden = !element("collection-editor").hidden;
  input("collection-name").focus();
});
element("create-collection").addEventListener("click", async () => {
  const name = input("collection-name").value.trim();
  if (!name) {
    message("Enter a collection name.");
    return;
  }
  const button = element<HTMLButtonElement>("create-collection");
  button.disabled = true;
  try {
    const collection = await send<Collection>({
      type: "createCollection",
      name,
    });
    addCollection(collection);
    select("collection").value = collection.id;
    element("collection-editor").hidden = true;
    message("");
    enableSave();
  } catch (error) {
    report(error);
  } finally {
    button.disabled = false;
  }
});
select("collection").addEventListener("change", enableSave);
input("save-pdf").addEventListener("change", () => {
  select("pdf-url").hidden = !input("save-pdf").checked;
});
element("capture").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!page || submitting || busy(job)) return;
  try {
    const rawDoi = input("doi").value.trim();
    const doi = rawDoi ? normalizeDoi(rawDoi) : null;
    if (rawDoi && !doi)
      throw new Error(
        "Enter a valid DOI, such as 10.1234/example, or leave it blank.",
      );
    const downloadUrl = input("save-pdf").checked
      ? select("pdf-url").value
      : null;
    const metadata = {
      ...page.metadata,
      title: input("title").value.trim(),
      authors: parseAuthors(input("authors").value.split("\n")),
      doi,
      year: input("year").value ? Number(input("year").value) : null,
      venue: input("venue").value,
      abstract: input("abstract").value,
    };
    const capture = BrowserCaptureInput.safeParse({
      id: crypto.randomUUID(),
      collectionId: select("collection").value,
      sourceUrl: page.sourceUrl,
      canonicalUrl: page.canonicalUrl,
      metadata,
      pdfUrl: downloadUrl ? safeUrl(downloadUrl) : null,
      savePdf: Boolean(downloadUrl),
    });
    if (!capture.success)
      throw new Error(
        "Check the title, year, authors, and collection before saving.",
      );
    submitting = true;
    enableSave();
    message("");
    // Request only the chosen PDF origin, directly within this user gesture.
    const pdfAllowed = downloadUrl ? await pdfPermission(downloadUrl) : false;
    renderJob(
      (
        await send<{ job: CaptureJob }>({
          type: "start",
          input: capture.data,
          downloadUrl,
          pdfAllowed,
        })
      ).job,
    );
  } catch (error) {
    report(error);
  } finally {
    submitting = false;
    enableSave();
  }
});
element("retry").addEventListener("click", async () => {
  if (!job || submitting) return;
  submitting = true;
  enableSave();
  try {
    const pdfAllowed = job.input.savePdf
      ? await pdfPermission(job.downloadUrl)
      : false;
    renderJob(
      (await send<{ job: CaptureJob }>({ type: "retry", pdfAllowed })).job,
    );
    message("");
  } catch (error) {
    report(error);
  } finally {
    submitting = false;
    enableSave();
  }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.job)
    renderJob(changes.job.newValue as CaptureJob | undefined);
});

function renderPage(value: ExtractedPage) {
  page = value;
  select("pdf-url").replaceChildren();
  input("title").value = page.metadata.title;
  input("authors").value = page.metadata.authors
    .map((author) =>
      author.given ? `${author.family}, ${author.given}` : author.family,
    )
    .join("\n");
  input("year").value = page.metadata.year?.toString() ?? "";
  input("doi").value = page.metadata.doi ?? "";
  input("venue").value = page.metadata.venue;
  input("abstract").value = page.metadata.abstract;
  element("source").textContent = new URL(page.sourceUrl).hostname;
  element("source").title = page.sourceUrl;
  element("method").textContent =
    page.metadata.extractionMethod === "page_fallback"
      ? "Review details"
      : "Metadata found";
  message(page.warnings.join(" "));
  const urls = page.pdfUrls.filter((url) => url.startsWith("https://"));
  urls.forEach((url) => select("pdf-url").append(new Option(url, url)));
  input("save-pdf").checked = Boolean(urls.length);
  input("save-pdf").disabled = !urls.length;
  select("pdf-url").hidden = !urls.length;
  element("pdf-help").textContent = urls.length
    ? "You may be asked to allow this download site. Up to 50 MB."
    : "No HTTPS PDF link found. You can attach a PDF in VANI later.";
  enableSave();
}

element("identifier-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const doi = normalizeDoi(input("identifier").value);
  if (!doi) {
    message("Enter a valid DOI or doi.org link.");
    return;
  }
  const button = element<HTMLButtonElement>("resolve");
  button.disabled = true;
  message("Looking up the DOI in Crossref…");
  try {
    renderPage(await send<ExtractedPage>({ type: "resolve", doi }));
  } catch (error) {
    report(error);
  } finally {
    button.disabled = false;
  }
});

async function initialize() {
  settings = await readSettings();
  renderJob((await send<{ job?: CaptureJob }>({ type: "status" })).job);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !safeUrl(tab.url)) {
    message("Open an academic article, or look up a DOI above.");
  } else {
    let snapshot;
    try {
      snapshot = (
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: readPage,
        })
      )[0]?.result;
    } catch {
      /* Chrome PDF viewer and restricted pages may not allow injection. */
    }
    page = extractMetadata(
      snapshot ?? {
        url: tab.url,
        title: tab.title || "",
        heading: "",
        canonical: "",
        meta: {},
        jsonLd: [],
        links: [],
      },
    );
    if (page) renderPage(page);
  }
  try {
    const collections = await send<{ items: Collection[] }>({
      type: "collections",
    });
    select("collection").replaceChildren(new Option("Choose a collection", ""));
    collections.items.forEach(addCollection);
    if (
      collections.items.some(
        (collection) => collection.id === settings.lastCollectionId,
      )
    )
      select("collection").value = settings.lastCollectionId!;
    else if (collections.items.length === 1)
      select("collection").value = collections.items[0]!.id;
    if (!collections.items.length) {
      element("collection-editor").hidden = false;
      message("Create your first collection to save this paper.");
    }
  } catch (error) {
    select("collection").replaceChildren(new Option("Connect in Settings", ""));
    report(error);
  }
  enableSave();
}
void initialize().catch(report);
