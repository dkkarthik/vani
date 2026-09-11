import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "../api";
import { ErrorNotice, PageHeader } from "../components/ui";
export function SearchPage() {
  const client = useQueryClient();
  const [query, setQuery] = useState(""),
    [mode, setMode] = useState("lexical"),
    [kind, setKind] = useState(""),
    [collection, setCollection] = useState(""),
    [tag, setTag] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [results, setResults] = useState<any>(),
    [report, setReport] = useState<any>();
  const collections = useQuery({
    queryKey: ["organization-collections"],
    queryFn: () => request<any>("/organization/collections"),
  });
  const coverage = useQuery({
    queryKey: ["coverage"],
    queryFn: () => request<any>("/search-coverage"),
  });
  const mutation = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) =>
      request<any>(path, { method: "POST", body: JSON.stringify(body) }).then(
        (data) => ({ data, path }),
      ),
    onSuccess: ({ data, path }) => {
      if (path === "/evidence-search") setResults(data);
      else setReport(data);
      client.invalidateQueries({ queryKey: ["coverage"] });
    },
  });
  return (
    <div className="page">
      <PageHeader
        eyebrow="F10 · Evidence search"
        title="Find the passage behind the idea"
        description="Search metadata, full text, notes and annotations with visible indexing coverage."
      />
      {(mutation.error || coverage.error) && (
        <ErrorNotice error={mutation.error || coverage.error} />
      )}
      <section className="review-panel">
        <form
          className="stack-form"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate({
              path: "/evidence-search",
              body: {
                query,
                mode,
                kind: kind || undefined,
                collectionId: collection || undefined,
                rule: {
                  tag,
                  ...(from ? { yearFrom: Number(from) } : {}),
                  ...(to ? { yearTo: Number(to) } : {}),
                },
              },
            });
          }}
        >
          <label>
            Search query
            <input
              required
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="An exact quotation or a research question"
            />
          </label>
          <div className="research-filters">
            <label>
              Search mode
              <select
                aria-label="Search mode"
                value={mode}
                onChange={(e) => setMode(e.target.value)}
              >
                <option value="lexical">Lexical terms</option>
                <option value="exact">Exact phrase</option>
                <option value="hybrid">Hybrid: lexical + meaning</option>
              </select>
            </label>
            <label>
              Source type
              <select
                aria-label="Source type"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                <option value="">All sources</option>
                {["metadata", "page", "note", "annotation"].map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <label>
              Collection
              <select
                aria-label="Collection"
                value={collection}
                onChange={(e) => setCollection(e.target.value)}
              >
                <option value="">All library</option>
                {collections.data?.items.map((c: any) => (
                  <option value={c.id} key={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Paper tag
              <input value={tag} onChange={(e) => setTag(e.target.value)} />
            </label>
            <label>
              From year
              <input
                type="number"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label>
              To year
              <input
                type="number"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          </div>
          <button className="button primary" disabled={mutation.isPending}>
            {mutation.isPending ? "Working…" : "Search evidence"}
          </button>
        </form>
      </section>
      {results && (
        <section className="review-panel">
          <h2>
            {results.total} matching chunks · {results.mode}
          </h2>
          {results.warning && (
            <p className="review-warnings">{results.warning}</p>
          )}
          <p>
            {results.coverage.chunks} chunks searched ·{" "}
            {results.coverage.semanticChunks} semantic chunks available{" "}
            {results.coverage.truncated &&
              "· Bounded corpus reached; narrow filters to inspect more."}{" "}
            · Showing at most 100 results
          </p>
          {results.items.map((item: any) => (
            <article className="evidence-card" key={item.id}>
              <Link to={item.url}>
                <strong>{item.title}</strong>
              </Link>
              <p>
                {item.key} · {item.kind}
                {item.page && ` · Page ${item.page}`}
              </p>
              <blockquote>{item.text}</blockquote>
              <small>
                Lexical score {item.lexical.toFixed(4)} ·{" "}
                {item.semantic === null
                  ? "No semantic score"
                  : `Cosine similarity ${item.semantic.toFixed(4)}`}{" "}
                · Combined rank score {item.score.toFixed(4)}
              </small>
              <p>
                <Link className="button secondary" to={item.url}>
                  Open matched source
                </Link>
              </p>
            </article>
          ))}
        </section>
      )}
      <section className="review-panel">
        <h2>Indexing coverage</h2>
        <p>
          {coverage.data?.totalDocuments ?? 0} attached documents · Showing{" "}
          {coverage.data?.displayedDocuments ?? 0}. Metadata, notes and
          annotations are searched live.
        </p>
        <p>
          Embedding model:{" "}
          {coverage.data?.embeddingModel ??
            "Not configured — hybrid will report lexical fallback"}
        </p>
        <div className="toolbar">
          <button
            className="button secondary"
            disabled={
              mutation.isPending ||
              !coverage.data?.documents.some(
                (d: any) => !d.state || d.state === "error",
              )
            }
            onClick={() =>
              mutation.mutate({
                path: "/search-index",
                body: {
                  attachmentIds: coverage.data.documents
                    .filter((d: any) => !d.state || d.state === "error")
                    .slice(0, 10)
                    .map((d: any) => d.id),
                },
              })
            }
          >
            Index next 10 documents
          </button>
          <button
            className="button secondary"
            disabled={mutation.isPending || !coverage.data?.embeddingModel}
            onClick={() =>
              mutation.mutate({ path: "/semantic-index", body: {} })
            }
          >
            Index next 100 semantic chunks
          </button>
        </div>
        {report && <pre>{JSON.stringify(report, null, 2)}</pre>}
        {coverage.data?.documents.map((doc: any) => (
          <article className="decision-row" key={doc.id}>
            <strong>
              {doc.title} — {doc.filename}
            </strong>
            <span>
              {doc.state ?? "Not indexed"} · {doc.page_count ?? 0} pages ·{" "}
              {doc.indexed_at
                ? new Date(doc.indexed_at).toLocaleString()
                : "Never indexed"}
            </span>
            {doc.error && <p className="review-warnings">{doc.error}</p>}
            <button
              className="button secondary"
              disabled={mutation.isPending}
              onClick={() =>
                mutation.mutate({
                  path: "/search-index",
                  body: { attachmentIds: [doc.id] },
                })
              }
            >
              Reindex document
            </button>
          </article>
        ))}
      </section>
    </div>
  );
}
