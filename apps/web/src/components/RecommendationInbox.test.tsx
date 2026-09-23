import { afterEach, it, expect, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RecommendationInbox } from "./RecommendationInbox";
import { request } from "../api";
vi.mock("../api", () => ({ request: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("shows metadata immediately and exposes refresh, feedback, save and public settings", async () => {
  const profile = {
    enabled: true,
    daily: false,
    sources: ["openalex", "crossref", "arxiv"],
    publicQueries: ["mesh refinement"],
    arxivCategories: ["cs.RO"],
    pagesPerQuery: 2,
    maxRecommendations: 500,
  };
  vi.mocked(request).mockImplementation(async (_path, init) =>
    init
      ? {}
      : {
          settings: { version: 1, profile },
          items: [
            {
              paper_id: "paper",
              paper: {
                title: "Sparse adaptive maps",
                abstract: "We refine the map adaptively.",
                authors: [],
                year: 2026,
              },
              explanation: {
                algorithm: "tfidf-linear-svm-v1",
                terms: [{ term: "sparse maps", contribution: 0.3 }],
              },
              score: 0.4,
              sources: [{ source: "arxiv", query: "mesh refinement" }],
            },
          ],
          total: 1,
        },
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <RecommendationInbox id="collection" />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("Sparse adaptive maps")).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh recommendations" }),
  );
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      "/collections/collection/recommendations/refresh",
      { method: "POST", body: JSON.stringify({ mode: "refresh" }) },
    ),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "👍 Good match" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "👍 Good match" }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      "/collections/collection/recommendations/paper/feedback",
      { method: "POST", body: JSON.stringify({ label: "up", reason: "" }) },
    ),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Save to collection" }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save to collection" }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      "/collections/collection/recommendations/paper/save",
      { method: "POST", body: "{}" },
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Discovery settings" }));
  fireEvent.change(
    screen.getByLabelText("Public discovery queries (one per line)"),
    { target: { value: "adaptive mesh refinement\nsparse maps" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Save discovery settings" }),
  );
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      "/collections/collection/recommendations/settings",
      {
        method: "PUT",
        body: JSON.stringify({
          version: 1,
          profile: {
            ...profile,
            publicQueries: ["adaptive mesh refinement", "sparse maps"],
          },
        }),
      },
    ),
  );
  client.clear();
});
