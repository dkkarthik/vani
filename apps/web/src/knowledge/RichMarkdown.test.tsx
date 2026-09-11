import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { RichMarkdown } from "./RichMarkdown";
it("renders equations and tables while blocking raw HTML and remote images", () => {
  const { container } = render(
    <RichMarkdown
      text={
        "Meaning $x^2$\n\n| Method | Result |\n| --- | --- |\n| A | B |\n\n<script>alert(1)</script>\n\n![remote](https://example.com/tracker.png)\n\n[bad](javascript:alert(1))"
      }
    />,
  );
  expect(container.querySelector(".katex")).not.toBeNull();
  expect(screen.getByRole("table")).toBeInTheDocument();
  expect(container.querySelector("script")).toBeNull();
  expect(container.querySelector("img")).toBeNull();
  expect(screen.getByText("bad").getAttribute("href")).not.toMatch(
    /^javascript:/,
  );
});
