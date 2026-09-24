import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "../api";
import { ErrorNotice } from "./ui";
import { externalPaperUrl, paperReference } from "@vani/shared";
import { PaperCitation } from "./PaperCitation";
const sanityReasons: Record<string, string> = {
  shortlisted: "Selected by the second-pass model and focus checks.",
  outside_limit:
    "Passes the focus checks, but ranks below the shortlist limit.",
  focus_mismatch: "Too little overlap with the selected local focus.",
  context_mismatch:
    "No required context term or phrase occurs in the available title and abstract.",
  no_positive_overlap:
    "No discriminative feature overlap with a positive example.",
  no_features: "Insufficient usable text features in the available metadata.",
  negative_feedback: "Dismissed by your feedback.",
  needs_positive_examples:
    "Add a seed or mark a paper as a good match to train the second pass.",
  insufficient_features:
    "More usable paper metadata is needed to train the second pass.",
  not_converged: "The second-pass solver did not converge within its budget.",
};
function Paper({ row, id, changed, shortlistReady, view, sort }: any) {
  const [note, setNote] = useState(row.reason ?? "");
  const action = useMutation({
    mutationFn: ({ verb, label }: { verb: string; label?: string }) =>
      request(`/collections/${id}/recommendations/${row.paper_id}/${verb}`, {
        method: "POST",
        body: JSON.stringify(
          verb === "feedback" ? { label, reason: note } : {},
        ),
      }),
    onSuccess: changed,
  });
  const useSanityScore =
    sort === "view" &&
    shortlistReady &&
    row.explanation.sanity &&
    ["shortlist", "filtered"].includes(view);
  const p = row.paper,
    reference = row.reference ?? paperReference(p),
    href = externalPaperUrl(p.url) ?? externalPaperUrl(reference.recordUrl);
  return (
    <article
      className="card"
      style={{
        padding: 16,
        margin: "12px 0",
        border: "1px solid var(--border, #d9e1de)",
        borderRadius: 12,
      }}
    >
      <h3>
        {href ? (
          <a href={href} target="_blank" rel="noreferrer">
            {p.title}
          </a>
        ) : (
          p.title
        )}
      </h3>
      <PaperCitation paper={p} reference={reference} />
      <p>
        <strong>
          {row.work_id
            ? "Saved to collection"
            : row.feedback === "down"
              ? "Dismissed"
              : view === "shortlist"
                ? "Sanity shortlist — text match"
                : view === "filtered"
                  ? "Filtered — retained for inspection"
                  : "Recommended — metadata ranking"}
        </strong>{" "}
        · {useSanityScore ? "Sanity score" : "Metadata ranking"}{" "}
        {(useSanityScore ? row.explanation.sanity.score : row.score) == null
          ? "unavailable"
          : Number(
              useSanityScore ? row.explanation.sanity.score : row.score,
            ).toFixed(3)}{" "}
        (not a probability)
      </p>
      {useSanityScore && (
        <p>
          Metadata ranking:{" "}
          {row.score == null ? "unavailable" : Number(row.score).toFixed(3)}
        </p>
      )}
      {shortlistReady && row.explanation.sanity && (
        <details>
          <summary>
            {row.explanation.sanity.selected
              ? "On the Sanity shortlist"
              : "Filtered by Sanity"}
          </summary>
          <p>
            {sanityReasons[row.explanation.sanity.reason] ??
              row.explanation.sanity.reason}
          </p>
          <p>
            Second-pass score: {Number(row.explanation.sanity.score).toFixed(3)}{" "}
            (not a probability).
          </p>
          <p>
            Focus matches:{" "}
            {row.explanation.sanity.matchedFocus.join(", ") || "None"}.
          </p>
          {!!row.explanation.sanity.matchedContext?.length && (
            <p>
              Required context:{" "}
              {row.explanation.sanity.matchedContext.join(", ")}.
            </p>
          )}
          {row.explanation.sanity.nearest && (
            <p>
              Closest positive example: {row.explanation.sanity.nearest.title}.
              Weighted text overlap:{" "}
              {Number(row.explanation.sanity.overlap).toFixed(3)}.
            </p>
          )}
          <ul>
            {row.explanation.sanity.terms.map((t: any) => (
              <li key={t.term}>
                {t.term}: {t.contribution >= 0 ? "+" : ""}
                {t.contribution.toFixed(3)}
              </li>
            ))}
          </ul>
        </details>
      )}
      <details>
        <summary>Abstract</summary>
        <p>{p.abstract || "This source did not supply an abstract."}</p>
      </details>
      <details>
        <summary>Why it ranked here</summary>
        <p>
          {row.explanation.algorithm === "tfidf-linear-svm-v1"
            ? "A local text classifier learned from seeds, saved papers, and feedback."
            : "Text similarity to the collection focus; no labeled training examples yet."}{" "}
          This is not a verified scientific comparison.
        </p>
        <ul>
          {(row.explanation.terms ?? []).map((t: any) => (
            <li key={t.term}>
              {t.term}: {t.contribution >= 0 ? "+" : ""}
              {t.contribution.toFixed(3)}
            </li>
          ))}
        </ul>
        <p>Cosine baseline: {Number(row.explanation.cosine ?? 0).toFixed(3)}</p>
        <ul>
          {(row.sources ?? []).map((s: any, i: number) => (
            <li key={i}>
              {s.source} · {s.kind} {s.query ? `· ${s.query}` : ""}
            </li>
          ))}
        </ul>
      </details>
      <div
        style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0" }}
      >
        <button
          className="button primary"
          disabled={action.isPending || !!row.work_id}
          onClick={() => action.mutate({ verb: "save" })}
        >
          {row.work_id ? "Saved" : "Save to collection"}
        </button>
        <button
          className="button secondary"
          aria-pressed={row.feedback === "up"}
          disabled={action.isPending}
          onClick={() => action.mutate({ verb: "feedback", label: "up" })}
        >
          👍 Good match
        </button>
        <button
          className="button secondary"
          aria-pressed={row.feedback === "down"}
          disabled={action.isPending}
          onClick={() => action.mutate({ verb: "feedback", label: "down" })}
        >
          👎 Poor match
        </button>
        <button
          className="button secondary"
          disabled={action.isPending || !row.feedback}
          onClick={() => action.mutate({ verb: "feedback", label: "clear" })}
        >
          Clear feedback
        </button>
      </div>
      <details>
        <summary>Explain your judgment</summary>
        <label>
          Feedback note
          <textarea
            value={note}
            maxLength={2000}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <button
          className="button secondary"
          disabled={action.isPending || !row.feedback}
          onClick={() =>
            action.mutate({ verb: "feedback", label: row.feedback })
          }
        >
          Save note
        </button>
        <p>
          Notes are retained locally for review. This classifier learns from the
          thumbs judgment, not the note text.
        </p>
      </details>
      {action.error && <ErrorNotice error={action.error} />}
    </article>
  );
}
export function RecommendationInbox({
  id,
  onMode,
}: {
  id: string;
  onMode?: (mode: { id: string; enabled: boolean }) => void;
}) {
  const client = useQueryClient(),
    [view, setView] = useState("recommended"),
    [sort, setSort] = useState("view"),
    [offset, setOffset] = useState(0),
    [draft, setDraft] = useState<any>(),
    [refineDraft, setRefineDraft] = useState<any>(),
    [saved, setSaved] = useState("");
  const data = useQuery({
    queryKey: ["recommendations", id, view, sort, offset],
    queryFn: () =>
      request<any>(
        `/collections/${id}/recommendations?view=${view}&offset=${offset}&sort=${sort}`,
      ),
    refetchInterval: 5000,
  });
  const changed = () => {
    void client.invalidateQueries({ queryKey: ["recommendations", id] });
    void client.invalidateQueries({ queryKey: ["collection-members", id] });
    void client.invalidateQueries({ queryKey: ["collections"] });
    void client.invalidateQueries({ queryKey: ["works"] });
  };
  const action = useMutation({
    mutationFn: ({
      path,
      body = {},
      method = "POST",
    }: {
      path: string;
      body?: unknown;
      method?: string;
    }) =>
      request<any>(`/collections/${id}/recommendations${path}`, {
        method,
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      changed();
    },
  });
  const d = data.data;
  const enabled = d?.settings?.profile.enabled;
  useEffect(() => {
    if (typeof enabled === "boolean") onMode?.({ id, enabled });
  }, [id, enabled, onMode]);
  const shortlistEnabled = d?.settings?.profile.shortlist?.enabled;
  const previousShortlistMode = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (
      typeof shortlistEnabled === "boolean" &&
      previousShortlistMode.current !== shortlistEnabled
    ) {
      previousShortlistMode.current = shortlistEnabled;
      setView(shortlistEnabled ? "shortlist" : "recommended");
      setOffset(0);
    }
  }, [shortlistEnabled]);
  if (data.error) return <ErrorNotice error={data.error} />;
  if (!d?.settings) return null;
  const cfg = d.settings,
    sourceRun = d.sourceRun ?? (d.run?.tasks.length ? d.run : null),
    active = ["queued", "running"].includes(d.run?.status);
  const launch = (mode: string) => {
    setSaved("");
    action.mutate(
      { path: "/refresh", body: { mode } },
      {
        onSuccess: () =>
          setSaved(
            mode === "refresh"
              ? "Refresh queued. Papers will appear as sources finish."
              : "Local reranking queued.",
          ),
      },
    );
  };
  return (
    <section
      className="card"
      style={{
        padding: 20,
        margin: "20px 0",
        border: "1px solid var(--border, #d9e1de)",
        borderRadius: 16,
      }}
    >
      <h2>
        Recommended papers <small>· discovery experiment</small>
      </h2>
      <p>
        Find and rank papers with OpenAlex, Crossref, and arXiv. No PDF or model
        server is required. Recommendations appear here; Save adds them to the
        collection.
      </p>
      {d.simpleOnly && (
        <p role="status">
          Discovery-only test mode: deeper reasoning and enrichment workers are
          idle.
        </p>
      )}
      {action.error && <ErrorNotice error={action.error} />}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          className="button primary"
          disabled={!cfg.profile.enabled || action.isPending || active}
          onClick={() => launch("refresh")}
        >
          {active ? "Refreshing…" : "Refresh recommendations"}
        </button>
        <button
          className="button secondary"
          disabled={!cfg.profile.enabled || action.isPending}
          onClick={() => launch("rerank")}
        >
          Rerank retained papers
        </button>
        <button
          className="button secondary"
          disabled={!cfg.profile.enabled || action.isPending || active}
          onClick={() =>
            setRefineDraft(
              refineDraft
                ? undefined
                : {
                    version: cfg.version,
                    shortlist: {
                      limit: 30,
                      focus: "",
                      requiredTerms: [],
                      ...cfg.profile.shortlist,
                      enabled: true,
                    },
                  },
            )
          }
        >
          Refine with Sanity
        </button>
        <button
          className="button secondary"
          onClick={() =>
            setDraft(
              draft
                ? undefined
                : {
                    version: cfg.version,
                    profile: structuredClone(cfg.profile),
                  },
            )
          }
        >
          Discovery settings
        </button>
        <button
          className="button secondary"
          disabled={!cfg.profile.enabled || action.isPending}
          onClick={() =>
            action.mutate(
              { path: "/import-retained" },
              {
                onSuccess: (r) => {
                  setSaved(
                    `Imported ${r.imported} public candidate records. Rerank to review them.`,
                  );
                  changed();
                },
              },
            )
          }
        >
          Import earlier public candidates (up to 2,000)
        </button>
      </div>
      {!cfg.profile.enabled && (
        <p>
          Enable this experiment in Discovery settings to begin. Existing saved
          papers and core reasoning are preserved.
        </p>
      )}
      {saved && <p role="status">{saved}</p>}
      {refineDraft && (
        <div style={{ padding: "16px 0" }}>
          <h3>Second-pass relevance filter</h3>
          <label>
            <input
              type="checkbox"
              checked={refineDraft.shortlist.enabled}
              onChange={(e) =>
                setRefineDraft({
                  ...refineDraft,
                  shortlist: {
                    ...refineDraft.shortlist,
                    enabled: e.target.checked,
                  },
                })
              }
            />{" "}
            Enable Sanity shortlist
          </label>
          <label>
            Local relevance focus
            <textarea
              maxLength={1600}
              value={refineDraft.shortlist.focus}
              onChange={(e) =>
                setRefineDraft({
                  ...refineDraft,
                  shortlist: {
                    ...refineDraft.shortlist,
                    focus: e.target.value,
                  },
                })
              }
            />
          </label>
          <label>
            Required context (one term or phrase per line)
            <textarea
              value={refineDraft.shortlist.requiredTerms.join("\n")}
              onChange={(e) =>
                setRefineDraft({
                  ...refineDraft,
                  shortlist: {
                    ...refineDraft.shortlist,
                    requiredTerms: e.target.value.split("\n"),
                  },
                })
              }
            />
          </label>
          <p>
            These preferences stay local. Focus words receive more weight; when
            context terms are supplied, at least one must appear in a paper’s
            title or abstract. Thumbs feedback trains the classifier.
          </p>
          <label>
            Maximum shortlist size
            <input
              type="number"
              min={5}
              max={100}
              value={refineDraft.shortlist.limit}
              onChange={(e) =>
                setRefineDraft({
                  ...refineDraft,
                  shortlist: {
                    ...refineDraft.shortlist,
                    limit: Number(e.target.value),
                  },
                })
              }
            />
          </label>
          <button
            className="button primary"
            disabled={action.isPending || active}
            onClick={() =>
              action.mutate(
                {
                  path: "/refine",
                  body: {
                    ...refineDraft,
                    shortlist: {
                      ...refineDraft.shortlist,
                      requiredTerms: refineDraft.shortlist.requiredTerms
                        .map((s: string) => s.trim())
                        .filter(Boolean),
                    },
                  },
                },
                {
                  onSuccess: () => {
                    setView(
                      refineDraft.shortlist.enabled
                        ? "shortlist"
                        : "recommended",
                    );
                    setOffset(0);
                    setRefineDraft(undefined);
                    setSaved(
                      "Preferences saved. Local second-pass ranking queued.",
                    );
                    changed();
                  },
                },
              )
            }
          >
            Save and refine locally
          </button>
        </div>
      )}
      {draft && (
        <div style={{ padding: "16px 0" }}>
          <label>
            <input
              type="checkbox"
              checked={draft.profile.enabled}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  profile: { ...draft.profile, enabled: e.target.checked },
                })
              }
            />{" "}
            Enable simple discovery for this collection
          </label>
          <br />
          <label>
            <input
              type="checkbox"
              checked={draft.profile.daily}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  profile: { ...draft.profile, daily: e.target.checked },
                })
              }
            />{" "}
            Refresh recommendations every 24 hours
          </label>
          <p>
            Public queries and category codes go to the selected scholarly
            sources. Seed text and feedback stay local. Enabling this experiment
            replaces legacy daily discovery for this collection; use the daily
            switch above to schedule it.
          </p>
          <label>
            Public discovery queries (one per line)
            <textarea
              value={draft.profile.publicQueries.join("\n")}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  profile: {
                    ...draft.profile,
                    publicQueries: e.target.value.split("\n"),
                  },
                })
              }
            />
          </label>
          <label>
            arXiv categories (comma separated)
            <input
              value={draft.profile.arxivCategories.join(",")}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  profile: {
                    ...draft.profile,
                    arxivCategories: e.target.value.split(","),
                  },
                })
              }
            />
          </label>
          <fieldset>
            <legend>Scholarly sources</legend>
            {["openalex", "crossref", "arxiv"].map((source) => (
              <label key={source} style={{ marginRight: 16 }}>
                <input
                  type="checkbox"
                  checked={draft.profile.sources.includes(source)}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      profile: {
                        ...draft.profile,
                        sources: e.target.checked
                          ? [...draft.profile.sources, source]
                          : draft.profile.sources.filter(
                              (x: string) => x !== source,
                            ),
                      },
                    })
                  }
                />
                {source}
              </label>
            ))}
          </fieldset>
          <label>
            Pages per query (100 records/page)
            <input
              type="number"
              min={1}
              max={5}
              value={draft.profile.pagesPerQuery}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  profile: {
                    ...draft.profile,
                    pagesPerQuery: Number(e.target.value),
                  },
                })
              }
            />
          </label>
          <label>
            Maximum recommendations
            <input
              type="number"
              min={20}
              max={1000}
              value={draft.profile.maxRecommendations}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  profile: {
                    ...draft.profile,
                    maxRecommendations: Number(e.target.value),
                  },
                })
              }
            />
          </label>
          <button
            className="button primary"
            disabled={action.isPending}
            onClick={() =>
              action.mutate(
                {
                  path: "/settings",
                  method: "PUT",
                  body: {
                    ...draft,
                    profile: {
                      ...draft.profile,
                      publicQueries: draft.profile.publicQueries
                        .map((s: string) => s.trim())
                        .filter(Boolean),
                      arxivCategories: draft.profile.arxivCategories
                        .map((s: string) => s.trim())
                        .filter(Boolean),
                    },
                  },
                },
                {
                  onSuccess: () => {
                    setDraft(undefined);
                    setSaved("Discovery settings saved.");
                    changed();
                  },
                },
              )
            }
          >
            Save discovery settings
          </button>
        </div>
      )}
      {d.run && !d.run.tasks.length && (
        <p>
          Local reranking: {d.run.status}
          {d.run.error ? ` · ${d.run.error}` : ""}
        </p>
      )}
      {sourceRun && (
        <div>
          <p>
            Latest source refresh: {sourceRun.status} ·{" "}
            {new Date(sourceRun.created_at).toLocaleString()}
            {sourceRun.error ? ` · ${sourceRun.error}` : ""}
          </p>
          <details>
            <summary>Source coverage and limits</summary>
            <p>
              Each query is bounded by the configured pages. The retained
              ranking pool is limited to 20,000 recent public records plus
              labeled papers. This is not exhaustive literature coverage.
            </p>
            <ul>
              {sourceRun.tasks.map((t: any, i: number) => (
                <li key={i}>
                  {t.source} · {t.query} · {t.state} · {t.found} records
                  {t.error ? ` · ${t.error}` : ""}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
      {d.model && (
        <p>
          {d.model.metadata.algorithm} · {d.model.metadata.corpusSize} indexed
          records · {d.model.metadata.positive} positive examples ·{" "}
          {d.model.metadata.negative} explicit negatives ·{" "}
          {d.model.metadata.background} unlabeled background. Ranked{" "}
          {new Date(d.model.updated_at).toLocaleString()}.
        </p>
      )}
      {shortlistEnabled && (
        <div role="status">
          <h3>Sanity shortlist</h3>
          {d.shortlistReady ? (
            <>
              <p>
                {d.model.metadata.shortlist.candidates} broad candidates →{" "}
                {d.model.metadata.shortlist.selected} shortlisted. Local text
                model; relevance still needs your review.
              </p>
              {d.model.metadata.shortlist.positive === 1 && (
                <p>
                  Only one positive example is available. Mark several close
                  papers and poor matches to sharpen the next pass.
                </p>
              )}
            </>
          ) : (
            <p>
              {active
                ? "The shortlist is being rebuilt. Broad recommendations remain available below."
                : (sanityReasons[d.model?.metadata.shortlist?.status] ??
                  "Run Refine with Sanity to build a current shortlist.")}
            </p>
          )}
          {cfg.profile.shortlist.focus && (
            <p>Local focus: {cfg.profile.shortlist.focus}</p>
          )}
        </div>
      )}
      <label>
        Show papers{" "}
        <select
          aria-label="Recommendation view"
          value={view}
          onChange={(e) => {
            setView(e.target.value);
            setOffset(0);
          }}
        >
          {shortlistEnabled && (
            <option value="shortlist">Sanity shortlist</option>
          )}
          <option value="recommended">Broad recommendations</option>
          {shortlistEnabled && (
            <option value="filtered">Filtered by Sanity</option>
          )}
          <option value="saved">Saved</option>
          <option value="dismissed">Dismissed</option>
        </select>
      </label>
      <label style={{ marginLeft: 16 }}>
        Sort by{" "}
        <select
          aria-label="Recommendation sort"
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            setOffset(0);
          }}
        >
          <option value="view">Current view ranking</option>
          <option value="metadata_desc">Metadata ranking: highest first</option>
          <option value="metadata_asc">Metadata ranking: lowest first</option>
        </select>
      </label>
      <p>{d.total} papers in this view</p>
      {!d.total && (
        <p>
          {active
            ? "Discovery is running; results will appear here as batches arrive."
            : view === "shortlist"
              ? "No current shortlist papers. Inspect broad recommendations, adjust the local focus, or mark good matches and rerun the filter."
              : "No papers in this view. Refresh sources or import and rerank earlier public candidates."}
        </p>
      )}
      {(d.items ?? []).map((row: any) => (
        <Paper
          key={row.paper_id}
          row={row}
          id={id}
          changed={changed}
          shortlistReady={d.shortlistReady}
          view={view}
          sort={sort}
        />
      ))}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          className="button secondary"
          disabled={!offset}
          onClick={() => setOffset(Math.max(0, offset - 25))}
        >
          Previous recommendations
        </button>
        <button
          className="button secondary"
          disabled={offset + 25 >= d.total}
          onClick={() => setOffset(offset + 25)}
        >
          Next recommendations
        </button>
      </div>
    </section>
  );
}
