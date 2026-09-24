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

it("defaults to a ready shortlist, explains filtered papers, and saves local focus controls", async () => {
  const profile = {
    enabled: true,
    daily: false,
    sources: ["arxiv"],
    publicQueries: ["mesh"],
    arxivCategories: [],
    pagesPerQuery: 1,
    maxRecommendations: 500,
    shortlist: {
      enabled: true,
      focus: "adaptive mesh",
      requiredTerms: ["mesh"],
      limit: 30,
    },
  };
  vi.mocked(request).mockImplementation(async (path, init) =>
    init
      ? {}
      : {
          settings: { version: 3, profile },
          total: 1,
          shortlistReady: true,
          model: {
            updated_at: "2026-09-24T00:00:00Z",
            metadata: {
              positive: 1,
              negative: 0,
              corpusSize: 100,
              background: 99,
              shortlist: {
                candidates: 100,
                selected: 1,
                positive: 1,
                status: "ready",
              },
            },
          },
          items: [
            {
              paper_id: "paper",
              paper: {
                title: path.includes("view=filtered")
                  ? "Unrelated graph application"
                  : "Adaptive mesh maps",
                authors: [],
              },
              sources: [],
              score: 0.4,
              explanation: {
                sanity: {
                  selected: !path.includes("view=filtered"),
                  reason: path.includes("view=filtered")
                    ? "context_mismatch"
                    : "shortlisted",
                  score: 0.2,
                  overlap: 0.3,
                  matchedFocus: ["mesh"],
                  matchedContext: ["mesh"],
                  terms: [],
                },
              },
            },
          ],
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
  await waitFor(() =>
    expect(
      screen.getByRole("combobox", { name: "Recommendation view" }),
    ).toHaveValue("shortlist"),
  );
  expect(
    await screen.findByText(
      "100 broad candidates → 1 shortlisted. Local text model; relevance still needs your review.",
    ),
  ).toBeVisible();
  fireEvent.change(
    screen.getByRole("combobox", { name: "Recommendation view" }),
    { target: { value: "filtered" } },
  );
  expect(await screen.findByText("Unrelated graph application")).toBeVisible();
  fireEvent.click(
    screen.getByText("Filtered by Sanity", { selector: "summary" }),
  );
  expect(
    await screen.findByText(
      "No required context term or phrase occurs in the available title and abstract.",
    ),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Refine with Sanity" }));
  fireEvent.change(screen.getByLabelText("Local relevance focus"), {
    target: { value: "Adaptive spatial meshes" },
  });
  fireEvent.change(
    screen.getByLabelText("Required context (one term or phrase per line)"),
    { target: { value: "mesh\noccupancy" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Save and refine locally" }),
  );
  await waitFor(() => {
    const call = vi
      .mocked(request)
      .mock.calls.find(
        ([path]) => path === "/collections/collection/recommendations/refine",
      );
    expect(call?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      version: 3,
      shortlist: {
        enabled: true,
        limit: 30,
        focus: "Adaptive spatial meshes",
        requiredTerms: ["mesh", "occupancy"],
      },
    });
  });
  client.clear();
});
