import { MAX_CAPTURE_PDF_BYTES } from "@vani/shared";

export interface Settings {
  baseUrl: string;
  appUrl: string;
  token: string;
  lastCollectionId?: string;
}
export const defaults: Settings = {
  baseUrl: "http://127.0.0.1:8080",
  appUrl: "http://127.0.0.1:5173",
  token: "",
};
export async function readSettings(): Promise<Settings> {
  const stored = (await chrome.storage.local.get("settings")).settings as
    Partial<Settings> | undefined;
  return { ...defaults, ...stored };
}

export function localAddress(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error("Use a local VANI address such as http://127.0.0.1:8080.");
  }
  return url.origin;
}

export async function request<T>(
  settings: Settings,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const baseUrl = localAddress(settings.baseUrl);
  if (!/^[a-f0-9]{64}$/.test(settings.token))
    throw new Error("Connect VANI in extension settings first.");
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/v1${path}`, {
      ...init,
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.timeout(25000),
      headers: {
        ...(init?.body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        Authorization: `Bearer ${settings.token}`,
      },
    });
  } catch {
    throw new Error(
      "Cannot reach VANI. Start its API and check the local address in extension settings, then retry.",
    );
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(
      body?.error?.message ||
        `VANI returned HTTP ${response.status}. Try again.`,
    );
  }
  return response.json();
}

export async function downloadPdf(url: string): Promise<Blob> {
  const target = new URL(url);
  if (target.protocol !== "https:" || target.username || target.password)
    throw new Error(
      "Automatic PDF capture requires an HTTPS download link. You can attach a downloaded PDF in VANI.",
    );
  const response = await fetch(target.href, {
    credentials: "include",
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok)
    throw new Error(
      `The publisher returned HTTP ${response.status}. Open the PDF in Chrome to check access, then retry.`,
    );
  if (Number(response.headers.get("content-length")) > MAX_CAPTURE_PDF_BYTES)
    throw new Error(
      "This PDF exceeds the 50 MB capture limit. Attach it directly in VANI.",
    );
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The publisher returned an empty download.");
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_CAPTURE_PDF_BYTES)
        throw new Error(
          "This PDF exceeds the 50 MB capture limit. Attach it directly in VANI.",
        );
      chunks.push(new Uint8Array(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  const blob = new Blob(chunks, { type: "application/pdf" });
  const prefix = new TextDecoder("latin1").decode(
    await blob.slice(0, 1024).arrayBuffer(),
  );
  if (!prefix.includes("%PDF-"))
    throw new Error(
      "The download is a webpage or login screen, not a PDF. Open the PDF in Chrome, then retry.",
    );
  return blob;
}
