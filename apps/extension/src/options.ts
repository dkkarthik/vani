import { readSettings, localAddress, request } from "./client";
const field = (id: string) => document.getElementById(id) as HTMLInputElement;
const status = (text: string) => {
  const element = document.getElementById("status")!;
  element.textContent = text;
  element.hidden = false;
};
const settings = await readSettings();
field("token").value = settings.token;
field("base-url").value = settings.baseUrl;
field("app-url").value = settings.appUrl;
(document.getElementById("open-settings") as HTMLAnchorElement).href =
  `${localAddress(settings.appUrl)}/settings`;
document
  .getElementById("connection")!
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const connection = {
        ...settings,
        token: field("token").value.trim(),
        baseUrl: localAddress(field("base-url").value),
        appUrl: localAddress(field("app-url").value),
      };
      status("Connecting to VANI…");
      await request(connection, "/capture/collections");
      await chrome.storage.local.set({ settings: connection });
      Object.assign(settings, connection);
      status("Connected. Open a paper and click VANI in the Chrome toolbar.");
    } catch (error) {
      status(error instanceof Error ? error.message : "Could not connect.");
    }
  });
document.getElementById("forget-sites")!.addEventListener("click", async () => {
  const permissions = await chrome.permissions.getAll();
  const origins =
    permissions.origins?.filter((origin) => origin.startsWith("https://")) ??
    [];
  if (origins.length) await chrome.permissions.remove({ origins });
  status("PDF site permissions removed. The next PDF save will ask again.");
});
document.getElementById("disconnect")!.addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "status" });
  if (
    response.data?.job &&
    ["saving", "downloading", "uploading"].includes(response.data.job.state)
  ) {
    status("Wait for the current save to finish before disconnecting.");
    return;
  }
  await chrome.storage.local.remove("job");
  await chrome.storage.local.set({ settings: { ...settings, token: "" } });
  await chrome.action.setBadgeText({ text: "" });
  field("token").value = "";
  settings.token = "";
  status(
    "Disconnected. Papers already saved in VANI are still available there.",
  );
});
