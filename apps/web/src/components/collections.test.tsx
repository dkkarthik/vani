import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Work } from "@vani/shared";
import { CollectionPage } from "../pages/CollectionPage";
import { api } from "../api";
vi.mock("../context", () => ({
  useWorkspace: () => ({
    collectionId: "c",
    setCollectionId: vi.fn(),
    selected: [],
    toggle: vi.fn(),
  }),
}));
vi.mock("../api", () => ({
  api: {
    collections: vi.fn(),
    collectionMembers: vi.fn(),
    seen: vi.fn(),
    works: vi.fn(),
  },
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("keeps NEW visible during a visit, but not on a subsequent visit with cached data", async () => {
  const work = Work.parse({
    id: "w",
    title: "Active mapping",
    year: 2026,
    doi: null,
    citationKey: "a-26",
    authors: [],
    verificationStatus: "partial",
    createdAt: "2026-09-01",
    updatedAt: "2026-09-01",
  });
  let seen = false;
  vi.mocked(api.collections).mockResolvedValue({
    items: [
      {
        id: "c",
        name: "Mapping",
        description: "",
        parentId: null,
        memberCount: 1,
        createdAt: "2026-09-01",
        updatedAt: "2026-09-01",
      },
    ],
  });
  vi.mocked(api.collectionMembers).mockImplementation(async () => ({
    items: [{ ...work, status: "inbox", isNew: !seen }],
  }));
  vi.mocked(api.seen).mockImplementation(async () => {
    seen = true;
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const show = () =>
    render(
      <QueryClientProvider client={client}>
        <CollectionPage />
      </QueryClientProvider>,
    );
  const first = show();
  await screen.findByText("NEW");
  await waitFor(() => expect(api.seen).toHaveBeenCalledWith("c", ["w"]));
  expect(screen.getByText("NEW")).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("New since last visit"));
  expect(screen.getByText("Active mapping")).toBeInTheDocument();
  first.unmount();
  show();
  await waitFor(() => expect(api.collectionMembers).toHaveBeenCalledTimes(2));
  await screen.findByText("Active mapping");
  expect(screen.queryByText("NEW")).not.toBeInTheDocument();
  client.clear();
});
