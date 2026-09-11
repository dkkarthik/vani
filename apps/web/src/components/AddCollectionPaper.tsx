import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { request } from "../api";
import { ErrorNotice } from "./ui";
export function AddCollectionPaper({
  collectionId,
  onSeed,
}: {
  collectionId: string;
  onSeed: () => void;
}) {
  const [mode, setMode] = useState("pdf"),
    [file, setFile] = useState<File>(),
    [link, setLink] = useState(""),
    [title, setTitle] = useState(""),
    [seed, setSeed] = useState(true);
  const qc = useQueryClient();
  const add = useMutation({
    mutationFn: async () => {
      let body: FormData | string;
      if (mode === "pdf") {
        if (!file) throw Error("Choose a PDF.");
        body = new FormData();
        body.append("title", title);
        body.append("seed", String(seed));
        body.append("file", file);
      } else body = JSON.stringify({ link, title, seed });
      return request<any>(`/collections/${collectionId}/ingest`, {
        method: "POST",
        body,
      });
    },
    onSuccess: async (result) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["collections"] }),
        qc.invalidateQueries({ queryKey: ["collection-members"] }),
        qc.invalidateQueries({ queryKey: ["seed-library"] }),
      ]);
      if (result.seed) onSeed();
    },
  });
  return (
    <section className="review-panel">
      <h2>Add a paper to this collection</h2>
      <form
        className="stack-form"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <label>
          Add from
          <select
            aria-label="Add paper from"
            value={mode}
            onChange={(e) => {
              setMode(e.target.value);
              add.reset();
            }}
          >
            <option value="pdf">Upload PDF</option>
            <option value="link">Paper link or DOI</option>
          </select>
        </label>
        {mode === "pdf" ? (
          <label>
            PDF file
            <input
              aria-label="Collection PDF"
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => setFile(e.target.files?.[0])}
            />
          </label>
        ) : (
          <label>
            Paper link or DOI
            <input
              aria-label="Paper link or DOI"
              required
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="Publisher page, arXiv, DOI or direct PDF URL"
            />
          </label>
        )}
        <label>
          Paper title (optional)
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={2000}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={seed}
            onChange={(e) => setSeed(e.target.checked)}
          />
          Use as a discovery seed and review collection focus
        </label>
        <p>
          Existing papers stay in the collection. Public PDFs are downloaded
          when available; uploads stay local. Contribution summaries run in the
          background.
        </p>
        {add.error && <ErrorNotice error={add.error} />}{" "}
        {add.isSuccess && (
          <p role="status">
            Paper added.{" "}
            {add.data.localPdf
              ? "PDF saved locally."
              : "PDF acquisition queued."}{" "}
            Contribution summary queued. {add.data.seedWarning}
          </p>
        )}
        <button
          className="button primary"
          disabled={add.isPending || (mode === "pdf" && !file)}
        >
          {add.isPending ? "Ingesting paper…" : "Add paper"}
        </button>
      </form>
    </section>
  );
}
