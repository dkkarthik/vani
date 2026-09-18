import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Updates } from "./Updates";
import { request } from "../api";
vi.mock("../api", () => ({ request: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const available = {
  supported: true,
  installed: "a".repeat(40),
  latest: "b".repeat(40),
  available: true,
  installRoot: "/research/vani",
  job: {},
};
function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <Updates />
    </QueryClientProvider>,
  );
  return client;
}
it("installs only after a click and offers reload after restart", async () => {
  vi.mocked(request).mockResolvedValue(available);
  const client = show();
  const button = await screen.findByRole("button", { name: "Update VANI" });
  expect(request).not.toHaveBeenCalledWith(
    expect.stringContaining("/install"),
    expect.anything(),
  );
  vi.mocked(request).mockResolvedValue({
    ...available,
    job: { state: "installing", message: "Restarting" },
  });
  fireEvent.click(button);
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith("/system/updates/install", {
      method: "POST",
      headers: { "X-VANI-Update": "1" },
      body: JSON.stringify({ commit: "b".repeat(40) }),
    }),
  );
  await waitFor(() => expect(button).toBeDisabled());
  client.setQueryData(["system-updates"], {
    ...available,
    installed: available.latest,
    available: false,
    job: { state: "complete", message: "Installed" },
  });
  expect(
    await screen.findByRole("button", { name: "Reload VANI" }),
  ).toBeVisible();
  client.clear();
});
it("keeps recovery instructions visible when services disconnect", async () => {
  vi.mocked(request).mockResolvedValue({
    ...available,
    job: { state: "installing" },
  });
  const client = show();
  await screen.findByRole("button", { name: "Update VANI" });
  vi.mocked(request).mockRejectedValue(new Error("offline"));
  await client.invalidateQueries({ queryKey: ["system-updates"] });
  expect(
    await screen.findByText(/VANI is disconnected during the update/),
  ).toHaveTextContent("/research/vani/logs/update.log");
  client.clear();
});
