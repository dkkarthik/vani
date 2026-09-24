import { beforeEach, afterEach, it, expect, vi } from "vitest";
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
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    clear: () => values.clear(),
  });
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
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
                authors: [{ given: "Ada", family: "Researcher" }],
                year: 2026,
                venue: "arXiv",
                url: "https://arxiv.org/abs/2601.12345",
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
  expect(screen.getByLabelText("Bibliographic citation")).toHaveTextContent(
    "Ada Researcher (2026). Sparse adaptive maps. arXiv.",
  );
  expect(
    screen.getByRole("link", { name: "View PDF (source)" }),
  ).toHaveAttribute("href", "https://arxiv.org/pdf/2601.12345");
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

it("sorts by metadata and returns to page one without starting a refresh", async () => {
  vi.mocked(request).mockResolvedValue({
    settings: {
      version: 1,
      profile: {
        enabled: true,
        sources: [],
        publicQueries: [],
        arxivCategories: [],
      },
    },
    items: [],
    total: 60,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <RecommendationInbox id="collection" />
    </QueryClientProvider>,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Next recommendations" }),
  );
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      "/collections/collection/recommendations?view=recommended&offset=25&sort=view",
    ),
  );
  fireEvent.change(
    await screen.findByRole("combobox", { name: "Recommendation sort" }),
    { target: { value: "metadata_desc" } },
  );
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      "/collections/collection/recommendations?view=recommended&offset=0&sort=metadata_desc",
    ),
  );
  expect(
    await screen.findByRole("button", { name: "Previous recommendations" }),
  ).toBeDisabled();
  fireEvent.change(
    screen.getByRole("combobox", { name: "Recommendation sort" }),
    { target: { value: "metadata_asc" } },
  );
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      "/collections/collection/recommendations?view=recommended&offset=0&sort=metadata_asc",
    ),
  );
  expect(vi.mocked(request).mock.calls.every(([, init]) => !init)).toBe(true);
  client.clear();
});

it("keeps cards, notes and scores in place through feedback reranking and save until explicitly applied", async () => {
  const row = (id: string, score: number) => ({
    paper_id: id,
    score,
    paper: { title: id, authors: [] },
    explanation: {
      sanity: {
        selected: true,
        score,
        matchedFocus: [],
        matchedContext: [],
        terms: [],
      },
    },
    sources: [],
  });
  const initial = {
    settings: {
      version: 1,
      profile: { enabled: true, shortlist: { enabled: true } },
    },
    shortlistReady: true,
    model: {
      updated_at: "2026-09-24",
      metadata: { shortlist: { candidates: 2, selected: 2, positive: 1 } },
    },
    total: 2,
    items: [row("Paper A", -0.39), row("Paper B", -0.45)],
  };
  let response: any = initial;
  vi.mocked(request).mockImplementation(async (_path, init) => {
    if (init) {
      response = {
        ...initial,
        shortlistReady: false,
        run: { status: "queued", tasks: [] },
        total: 0,
        items: [],
      };
      return _path.endsWith("/save") ? { workId: "saved-b" } : {};
    }
    return response;
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <RecommendationInbox id="stable" />
    </QueryClientProvider>,
  );
  await screen.findByText("Paper B", { exact: true });
  await waitFor(() =>
    expect(
      screen.getByRole("combobox", { name: "Recommendation view" }),
    ).toHaveValue("shortlist"),
  );
  fireEvent.change(
    screen.getByRole("combobox", { name: "Recommendation sort" }),
    { target: { value: "metadata_desc" } },
  );
  await screen.findByText("Paper B", { exact: true });
  const cards = () => [...document.querySelectorAll("article")];
  const first = cards()[0]!;
  const note = first.querySelector("textarea")!;
  fireEvent.change(note, {
    target: { value: "Important spatial discretization method" },
  });
  const goodMatch = screen.getAllByRole("button", {
    name: "👍 Good match",
  })[0]!;
  goodMatch.focus();
  fireEvent.click(goodMatch);
  await waitFor(() =>
    expect(
      screen.getAllByRole("button", { name: "👍 Good match" })[0],
    ).toHaveAttribute("aria-pressed", "true"),
  );
  await waitFor(() =>
    expect(screen.getByText(/Local reranking: queued/)).toBeVisible(),
  );
  expect(goodMatch).toHaveFocus();
  expect(cards()[0]).toBe(first);
  expect(note.value).toBe("Important spatial discretization method");
  expect(
    screen.getByRole("button", { name: "Show updated ranking" }),
  ).toBeDisabled();
  response = { ...initial, items: [row("Paper B", 0.8), row("Paper A", 0.2)] };
  await client.invalidateQueries({ queryKey: ["recommendations", "stable"] });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Show updated ranking" }),
    ).toBeEnabled(),
  );
  expect(cards()[0]).toBe(first);
  expect(first).toHaveTextContent("Metadata ranking -0.390000");
  fireEvent.click(
    screen.getAllByRole("button", { name: "Save to collection" })[1]!,
  );
  await screen.findByRole("button", { name: "Saved" });
  expect(cards()).toHaveLength(2);
  response = { ...initial, total: 1, items: [row("Paper A", 0.2)] };
  await client.invalidateQueries({ queryKey: ["recommendations", "stable"] });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Show updated ranking" }),
    ).toBeEnabled(),
  );
  const originalScroll = Element.prototype.scrollIntoView;
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  fireEvent.click(screen.getByRole("button", { name: "Show updated ranking" }));
  await waitFor(() => expect(cards()).toHaveLength(1));
  expect(first).toHaveTextContent("Metadata ranking 0.200000");
  expect(scroll).toHaveBeenCalled();
  Element.prototype.scrollIntoView = originalScroll;
  client.clear();
});

it("remembers numeric metadata sort per collection after remount", async () => {
  vi.mocked(request).mockResolvedValue({
    settings: { version: 1, profile: { enabled: true } },
    items: [],
    total: 0,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const renderInbox = () =>
    render(
      <QueryClientProvider client={client}>
        <RecommendationInbox id="persist" />
      </QueryClientProvider>,
    );
  const view = renderInbox();
  fireEvent.change(
    await screen.findByRole("combobox", { name: "Recommendation sort" }),
    { target: { value: "metadata_desc" } },
  );
  await waitFor(() =>
    expect(
      window.localStorage.getItem("vani:recommendation-sort:persist"),
    ).toBe("metadata_desc"),
  );
  view.unmount();
  renderInbox();
  expect(
    await screen.findByRole("combobox", { name: "Recommendation sort" }),
  ).toHaveValue("metadata_desc");
  expect(await screen.findByText(/−0.39 ranks above −0.45/)).toBeVisible();
  client.clear();
});

it("retains the review and focus when saving fails without claiming success", async () => {
  vi.mocked(request).mockImplementation(async (_path, init) => {
    if (init) throw new Error("Save failed");
    return {
      settings: { version: 1, profile: { enabled: true } },
      total: 1,
      items: [
        {
          paper_id: "failed-paper",
          paper: { title: "Unsaved paper", authors: [] },
          score: 0.1,
          explanation: {},
          sources: [],
        },
      ],
    };
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <RecommendationInbox id="failure" />
    </QueryClientProvider>,
  );
  const save = await screen.findByRole("button", {
    name: "Save to collection",
  });
  save.focus();
  fireEvent.click(save);
  await screen.findByText("Save failed");
  expect(screen.getByText("Unsaved paper")).toBeVisible();
  expect(save).toHaveFocus();
  expect(save).toHaveAttribute("aria-disabled", "false");
  expect(
    screen.queryByRole("button", { name: "Saved" }),
  ).toBeNull();
  client.clear();
});
