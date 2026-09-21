import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { request } from "../api";
import { RefreshReview } from "./RefreshReview";
vi.mock("../api", () => ({ request: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("saves quick feedback and explanation, and applies edited queries with the original focus version", async () => {
  vi.mocked(request).mockImplementation(async (path) => {
    if (path.includes("/runs?"))
      return {
        items: [{ id: "run", created_at: "2026-09-21", status: "completed" }],
      };
    if (path.includes("/runs/run?"))
      return {
        run: { status: "completed" },
        summary: [],
        stages: [],
        total: 1,
        items: [
          {
            candidate_id: "paper",
            snapshot: {
              title: "Adaptive mesh refinement",
              stage: "D1b",
              assessment: {},
            },
            outcome: "not_related",
            current_feedback: {},
          },
        ],
      };
    if (path === "/collections/c/core")
      return {
        focus: {
          version: 4,
          profile: { question: "Sparse maps", publicQueries: ["old query"] },
        },
      };
    return {};
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <RefreshReview id="c" />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByText("Deep refresh history and feedback"));
  fireEvent.click(await screen.findByRole("button", { name: "Good match" }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith("/core/candidates/paper/feedback", {
      method: "POST",
      body: JSON.stringify({ label: "related", reason: "", runId: "run" }),
    }),
  );
  fireEvent.change(screen.getByLabelText(/Why this paper/), {
    target: { value: "The sparse representation is exactly relevant." },
  });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Save explanation" }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save explanation" }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith("/core/candidates/paper/feedback", {
      method: "POST",
      body: JSON.stringify({
        label: "related",
        reason: "The sparse representation is exactly relevant.",
        runId: "run",
      }),
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit saved queries" }));
  fireEvent.change(
    await screen.findByLabelText("Public queries, one per line"),
    { target: { value: "adaptive mesh refinement\nsparse representations" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Apply public queries" }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith("/collections/c/core/focus", {
      method: "PUT",
      body: JSON.stringify({
        version: 4,
        profile: {
          question: "Sparse maps",
          publicQueries: ["adaptive mesh refinement", "sparse representations"],
        },
      }),
    }),
  );
  client.clear();
});
