import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { paperReference } from "@vani/shared";
import { PaperCitation } from "./PaperCitation";
afterEach(cleanup);

it("renders a full citation with identifier links and prefers the local PDF", () => {
  const paper = {
    title: "Adaptive maps",
    year: 2025,
    venue: "ICRA",
    authors: [{ given: "Ada", family: "Researcher" }],
    doi: "10.1234/maps",
    pdfUrl: "https://example.org/paper.pdf",
  };
  const reference = paperReference(paper);
  const local =
    "/api/v1/attachments/00000000-0000-0000-0000-000000000001/content";
  reference.pdfLinks.push({ url: local, kind: "local" });
  render(<PaperCitation paper={paper} reference={reference} />);
  expect(screen.getByLabelText("Bibliographic citation")).toHaveTextContent(
    "Ada Researcher (2025). Adaptive maps. ICRA.",
  );
  expect(
    screen.getByRole("link", { name: "doi:10.1234/maps" }),
  ).toHaveAttribute("href", "https://doi.org/10.1234/maps");
  expect(
    screen.getByRole("link", { name: "View PDF (local copy)" }),
  ).toHaveAttribute("href", local);
  expect(
    screen.queryByRole("link", { name: "View PDF (source)" }),
  ).not.toBeInTheDocument();
});

it("shows source PDFs and an honest missing-PDF state instead of linking a DOI as PDF", () => {
  const view = render(
    <PaperCitation
      paper={{ title: "Maps", url: "https://arxiv.org/abs/2401.12345" }}
    />,
  );
  expect(
    screen.getByRole("link", { name: "View PDF (source)" }),
  ).toHaveAttribute("href", "https://arxiv.org/pdf/2401.12345");
  view.rerender(
    <PaperCitation paper={{ title: "Maps", doi: "10.1234/maps" }} />,
  );
  expect(screen.getByText("PDF link unavailable")).toBeVisible();
  expect(
    screen.getByText("Metadata incomplete: authors, year, venue unavailable."),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "Paper record" })).toHaveAttribute(
    "href",
    "https://doi.org/10.1234/maps",
  );
});
