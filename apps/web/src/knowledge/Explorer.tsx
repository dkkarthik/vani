import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Choice, Feedback, Field, Json, send, useAction, useK } from "./common";
import { PageHeader } from "../components/ui";
export function ExplorerPage() {
  const [query, setQuery] = useState(""),
    [seeds, setSeeds] = useState(""),
    [localSeeds, setLocalSeeds] = useState<string[]>([]),
    [direction, setDirection] = useState("both"),
    [sources, setSources] = useState(["openalex", "crossref"]),
    [excludeTerms, setTerms] = useState(""),
    [excludeIds, setIds] = useState(""),
    [collectionId, setCollection] = useState(""),
    [result, setResult] = useState<any>(null),
    [selected, setSelected] = useState<string[]>([]),
    [imported, setImported] = useState<Record<string, string>>({}),
    a = useAction(),
    options = useK("/options"),
    collections = useQuery({
      queryKey: ["collections"],
      queryFn: api.collections,
    });
  const lines = (s: string) =>
    s
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
  return (
    <div className="page knowledge-page">
      <PageHeader
        eyebrow="Question and seed discovery"
        title="Follow a research question"
        description="Explore topics, outgoing references and papers that cite your seeds."
      />
      <Link to="/discover">Simple discovery</Link>
      <Feedback action={a} />
      <form
        className="review-panel stack-form"
        onSubmit={(e) => {
          e.preventDefault();
          void a.run(async () => {
            setResult(
              await send("/discovery", {
                query,
                seeds: [...lines(seeds), ...localSeeds],
                direction,
                sources,
                excludeTerms: lines(excludeTerms),
                excludeIds: lines(excludeIds),
              }),
            );
            setSelected([]);
            setImported({});
          }, "Discovery finished. Review provider coverage and results.");
        }}
      >
        <Field label="Research question or topic">
          <input value={query} onChange={(e) => setQuery(e.target.value)} />
        </Field>
        <div className="research-columns">
          <Field label="DOI or OpenAlex seeds (one per line)">
            <textarea
              value={seeds}
              onChange={(e) => setSeeds(e.target.value)}
            />
          </Field>
          <Choice
            label="Saved paper seeds"
            value={localSeeds}
            onChange={setLocalSeeds}
            items={options.data?.works ?? []}
            multiple
          />
        </div>
        <p>
          Up to five seeds combined. Each seed must resolve to a DOI or OpenAlex
          record.
        </p>
        <div className="research-filters">
          <Choice
            label="Discovery direction"
            value={direction}
            onChange={setDirection}
            items={["seed", "references", "citing", "both"]}
          />
          {["openalex", "crossref"].map((s) => (
            <label className="check-line" key={s}>
              <input
                type="checkbox"
                checked={sources.includes(s)}
                onChange={(e) =>
                  setSources(
                    e.target.checked
                      ? [...sources, s]
                      : sources.filter((x) => x !== s),
                  )
                }
              />
              {s}
            </label>
          ))}
        </div>
        <div className="research-columns">
          <Field label="Exclude terms (one per line)">
            <textarea
              value={excludeTerms}
              onChange={(e) => setTerms(e.target.value)}
            />
          </Field>
          <Field label="Exclude identifiers (one per line)">
            <textarea
              value={excludeIds}
              onChange={(e) => setIds(e.target.value)}
            />
          </Field>
        </div>
        <button
          className="button primary"
          disabled={
            a.busy ||
            !sources.length ||
            (!query && !seeds && !localSeeds.length)
          }
        >
          Explore literature
        </button>
      </form>
      {result && (
        <>
          <section className="review-panel">
            <h2>Source coverage</h2>
            <p>
              {result.limits} · {result.excluded} excluded results
            </p>
            {result.coverage.map((c: any, i: number) => (
              <p key={i}>
                <strong>
                  {c.source}: {c.state}
                </strong>{" "}
                {c.message ?? `${c.returned} returned`}
              </p>
            ))}
            <Choice
              label="Import destination"
              value={collectionId}
              onChange={setCollection}
              items={
                collections.data?.items.filter(
                  (c) => c.collectionType !== "saved_search",
                ) ?? []
              }
              empty="Library only"
            />
            <button
              className="button primary"
              disabled={!selected.length || selected.length > 100 || a.busy}
              onClick={() =>
                void a.run(async () => {
                  const r = await send(`/discovery/${result.id}/import`, {
                    resultIds: selected,
                    ...(collectionId ? { collectionId } : {}),
                  });
                  setImported((v) => ({
                    ...v,
                    ...Object.fromEntries(
                      r.items.map((i: any) => [i.resultId, i.work.id]),
                    ),
                  }));
                  setSelected([]);
                }, "Selected papers imported; indexed citations connected where both papers exist locally.")
              }
            >
              Import selected ({selected.length})
            </button>
          </section>
          {result.items.map((c: any) => (
            <article className="review-panel" key={c.resultId}>
              <label className="check-line">
                <input
                  type="checkbox"
                  checked={selected.includes(c.resultId)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, c.resultId]
                        : selected.filter((x) => x !== c.resultId),
                    )
                  }
                />
                <strong>{c.title}</strong>
              </label>
              <p>
                {c.year ?? "Undated"} · {c.doi ?? c.externalId}
              </p>
              {(imported[c.resultId] || c.existingWorkId) && (
                <Link
                  to={"/read/" + (imported[c.resultId] || c.existingWorkId)}
                >
                  Open in library
                </Link>
              )}
              <p>{c.abstract || "Abstract unavailable"}</p>
              <details>
                <summary>Why this result appeared</summary>
                <Json value={c.paths} />
              </details>
            </article>
          ))}
        </>
      )}
    </div>
  );
}
