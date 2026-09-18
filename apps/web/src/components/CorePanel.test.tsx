import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CorePanel } from "./CorePanel";
import { request, api } from "../api";
vi.mock("../api", () => ({ request: vi.fn(), api: { works: vi.fn() } }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("saves edited queries from the adjacent control and confirms success", async () => {
  const profile = {
    question: "Robot navigation",
    objective: "closest",
    budgets: { d0: 20000, d1: 2000, d2: 200, d3: 50 },
    mode: "review",
    anchors: [],
    publicQueries: [],
    facets: [],
    exclusions: [],
    audits: { timezone: "UTC", enabled: false },
  };
  vi.mocked(request).mockResolvedValue({
    focus: { version: 3, profile },
    runs: [],
    counts: [],
    candidates: [],
    audits: [],
    policies: [],
  });
  vi.mocked(api.works).mockResolvedValue({ items: [] });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <CorePanel id="collection" />
    </QueryClientProvider>,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Edit focus and anchors" }),
  );
  const queries = screen.getByLabelText("Public search queries (one per line)");
  fireEvent.change(queries, {
    target: { value: "terrain navigation\nrisk aware locomotion" },
  });
  fireEvent.change(screen.getByLabelText("Targeted comparisons (D2)"), {
    target: { value: "500" },
  });
  fireEvent.change(screen.getByLabelText("Deep readings (D3)"), {
    target: { value: "100" },
  });
  const adjacentSave = queries
    .closest("label")!
    .nextElementSibling!.querySelector("button")!;
  expect(adjacentSave).toHaveTextContent("Save focus changes");
  fireEvent.click(adjacentSave);
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith("/collections/collection/core/focus", {
      method: "PUT",
      body: JSON.stringify({
        version: 3,
        profile: {
          ...profile,
          budgets: { ...profile.budgets, d2: 500, d3: 100 },
          publicQueries: ["terrain navigation", "risk aware locomotion"],
        },
      }),
    }),
  );
  expect(await screen.findByText(/Focus changes saved/)).toBeVisible();
  expect(
    screen.queryByLabelText("Public search queries (one per line)"),
  ).not.toBeInTheDocument();
  client.clear();
});
