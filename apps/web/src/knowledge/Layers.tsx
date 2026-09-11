import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useWorkspace } from "../context";
import { ErrorNotice, Loading, PageHeader } from "../components/ui";
import { Json, Source, send } from "./common";
const legend = [
  {
    id: "citation",
    name: "Direct citations",
    color: "#347366",
    dash: "",
    meaning: "Directed, indexed reference; not agreement.",
  },
  {
    id: "bibliographic",
    name: "Shared references",
    color: "#bc7b25",
    dash: "8 3",
    meaning: "Undirected Jaccard overlap of known references.",
  },
  {
    id: "semantic",
    name: "Semantic similarity",
    color: "#865bb3",
    dash: "3 5",
    meaning: "Undirected cosine similarity of cached metadata vectors.",
  },
  {
    id: "evidence",
    name: "Evidence relations",
    color: "#336c9d",
    dash: "12 3 2 3",
    meaning: "Authored or reviewed interpretations; inspect sources.",
  },
  {
    id: "personal",
    name: "Personal organization",
    color: "#875249",
    dash: "2 3",
    meaning: "Reading order and personal connections.",
  },
];
export function LayersPage() {
  const { collectionId } = useWorkspace(),
    data = useQuery({
      queryKey: ["knowledge", "layers", collectionId],
      queryFn: () => send("/layers", { collectionId }),
    }),
    [enabled, setEnabled] = useState(legend.map((l) => l.id)),
    [selected, setSelected] = useState<string>(),
    [focus, setFocus] = useState("");
  const edges = (data.data?.edges ?? []).filter(
      (e: any) =>
        enabled.includes(e.layer) &&
        (!focus ||
          [e.source.label, e.target.label, e.predicate]
            .join(" ")
            .toLowerCase()
            .includes(focus.toLowerCase())),
    ),
    chosen = edges.find((e: any) => e.id === selected);
  return (
    <div className="page knowledge-page">
      <PageHeader
        eyebrow="Relationship layers"
        title="Inspect what each connection means"
        description="Citations, shared references, semantic proximity and interpretations answer different questions."
      />
      <Link className="button secondary" to="/planning">
        Arrange a persistent research map
      </Link>
      <Link to="/knowledge?tab=connections">Create or review connections</Link>
      {data.isLoading && <Loading />}
      {data.error && <ErrorNotice error={data.error} />}
      <section className="review-panel">
        <div className="layer-legend">
          {legend.map((l) => (
            <label key={l.id}>
              <input
                type="checkbox"
                checked={enabled.includes(l.id)}
                onChange={(e) =>
                  setEnabled(
                    e.target.checked
                      ? [...enabled, l.id]
                      : enabled.filter((x) => x !== l.id),
                  )
                }
              />
              <svg width="36" height="12" aria-hidden="true">
                <line
                  x1="0"
                  y1="6"
                  x2="36"
                  y2="6"
                  stroke={l.color}
                  strokeWidth="3"
                  strokeDasharray={l.dash}
                />
              </svg>
              <strong>{l.name}</strong>
              <small>{l.meaning}</small>
            </label>
          ))}
        </div>
        <label className="k-field">
          Focus on title, entity or relation
          <input value={focus} onChange={(e) => setFocus(e.target.value)} />
        </label>
        {data.data && (
          <>
            <p>
              {data.data.coverage.works} works ·{" "}
              {data.data.coverage.referenceRecords} reference records ·{" "}
              {data.data.coverage.semanticVectors} current semantic vectors.{" "}
              {data.data.coverage.semanticStatus}
            </p>
            <p>
              {data.data.coverage.note}{" "}
              {data.data.coverage.truncated &&
                "Result limit reached; narrow the collection."}
            </p>
          </>
        )}
      </section>
      <LayerGraph edges={edges} onSelect={setSelected} />
      {chosen && (
        <section className="review-panel" aria-label="Selected relationship">
          <h2>{chosen.predicate.replaceAll("_", " ")}</h2>
          <p>
            <Source value={chosen.source} /> → <Source value={chosen.target} />
          </p>
          <p>{chosen.explanation}</p>
          <p>
            Origin: {chosen.origin}{" "}
            {chosen.score !== null && chosen.score !== undefined
              ? ` · measured score ${Number(chosen.score).toFixed(3)}`
              : ""}
          </p>
          {chosen.passages?.map((p: any) => (
            <blockquote key={p.id}>
              {p.quote}
              <br />
              <Source value={p} />
            </blockquote>
          ))}
          <Json value={chosen.evidence} />
        </section>
      )}
      <section className="review-panel">
        <h2>All visible relationships ({edges.length})</h2>
        <p>
          Graph and list use the same layer filters. Select a relation to
          inspect its derivation.
        </p>
        <div className="review-table-wrap">
          <table className="review-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Relation / explanation</th>
                <th>Target</th>
                <th>Layer</th>
              </tr>
            </thead>
            <tbody>
              {edges.map((e: any) => (
                <tr key={e.id}>
                  <td>
                    <Source value={e.source} />
                  </td>
                  <td>
                    <button
                      className="cell-button"
                      onClick={() => setSelected(e.id)}
                    >
                      {e.predicate.replaceAll("_", " ")}
                    </button>
                    <small>{e.origin}</small>
                  </td>
                  <td>
                    <Source value={e.target} />
                  </td>
                  <td>{legend.find((l) => l.id === e.layer)?.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!edges.length && (
          <p>No relationships in the selected layers and scope.</p>
        )}
      </section>
    </div>
  );
}
function LayerGraph({
  edges,
  onSelect,
}: {
  edges: any[];
  onSelect: (id: string) => void;
}) {
  const nodes = useMemo(
    () =>
      [
        ...new Map(
          edges
            .flatMap((e) => [e.source, e.target])
            .map((n) => [n.kind + ":" + n.id, n]),
        ).values(),
      ].slice(0, 40),
    [edges],
  );
  const points = new Map(
    nodes.map((n, i) => [
      n.kind + ":" + n.id,
      {
        x: 480 + 350 * Math.cos((i / nodes.length) * 2 * Math.PI),
        y: 300 + 215 * Math.sin((i / nodes.length) * 2 * Math.PI),
      },
    ]),
  );
  return (
    <section className="review-panel">
      <h2>Focused visual map</h2>
      <p>
        Up to 40 objects fit this preview; the complete bounded result is in the
        list below. Arrows indicate directed citation and evidence/personal
        relations.
      </p>
      <svg
        className="layer-map"
        viewBox="0 0 960 620"
        role="img"
        aria-label="Relationship layer map; equivalent interactive list follows"
      >
        <defs>
          {legend.map((l) => (
            <marker
              key={l.id}
              id={"arrow-" + l.id}
              viewBox="0 0 10 10"
              refX="22"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={l.color} />
            </marker>
          ))}
        </defs>
        {edges.map((e) => {
          const s = points.get(e.source.kind + ":" + e.source.id),
            t = points.get(e.target.kind + ":" + e.target.id),
            l = legend.find((l) => l.id === e.layer)!;
          return s && t ? (
            <line
              key={e.id}
              x1={s.x}
              y1={s.y}
              x2={t.x}
              y2={t.y}
              stroke={l.color}
              strokeWidth="2"
              strokeDasharray={l.dash}
              markerEnd={
                ["semantic", "bibliographic"].includes(e.layer)
                  ? undefined
                  : `url(#arrow-${e.layer})`
              }
              onClick={() => onSelect(e.id)}
            >
              <title>
                {e.source.label + " " + e.predicate + " " + e.target.label}
              </title>
            </line>
          ) : null;
        })}
        {nodes.map((n) => {
          const p = points.get(n.kind + ":" + n.id)!;
          return (
            <g key={n.kind + n.id}>
              <circle
                cx={p.x}
                cy={p.y}
                r="13"
                fill="#f8faf5"
                stroke="#356e61"
                strokeWidth="2"
              />
              <text x={p.x} y={p.y + 30} textAnchor="middle" fontSize="12">
                {n.label.slice(0, 24)}
                {n.label.length > 24 ? "…" : ""}
              </text>
              <title>{n.label}</title>
            </g>
          );
        })}
      </svg>
    </section>
  );
}
