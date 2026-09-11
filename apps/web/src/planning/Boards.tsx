import { useState } from "react";
import { BoardState, MapLayers } from "@vani/shared";
import {
  Choice,
  Field,
  Feedback,
  RefPicker,
  send,
  get,
  useAction,
  useK,
} from "../knowledge/common";
import { ErrorNotice } from "../components/ui";
const empty = () => BoardState.parse({ cards: [] });
export function Boards() {
  const [id, setId] = useState(""),
    [title, setTitle] = useState(""),
    list = useK("/boards"),
    detail = useK("/boards/" + id, Boolean(id)),
    a = useAction();
  return (
    <>
      <Feedback action={a} />
      <div className="research-filters">
        <Choice
          label="Saved research map"
          value={id}
          onChange={setId}
          items={list.data?.items ?? []}
        />
        <Field label="New map title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <button
          className="button primary"
          disabled={!title || a.busy}
          onClick={() =>
            void a.run(async () =>
              setId((await send("/boards", { title, state: empty() })).id),
            )
          }
        >
          Create research map
        </button>
      </div>
      <Field label="Import editable map JSON">
        <input
          type="file"
          accept="application/json,.json"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file)
              void a.run(async () => {
                if (file.size > 1000000) throw Error("Map JSON exceeds 1 MB.");
                setId(
                  (await send("/boards/import", JSON.parse(await file.text())))
                    .id,
                );
              });
          }}
        />
      </Field>
      {detail.error && <ErrorNotice error={detail.error} />}{" "}
      {detail.data && (
        <BoardEditor
          key={detail.data.id + ":" + detail.data.version}
          row={detail.data}
        />
      )}
    </>
  );
}
function BoardEditor({ row }: { row: any }) {
  const [title, setTitle] = useState(row.title),
    [s, setS] = useState<any>(row.state),
    [ref, setRef] = useState({ kind: "work", id: "" }),
    [selected, setSelected] = useState(""),
    [groupName, setGroupName] = useState(""),
    [neighbors, setNeighbors] = useState<any[]>([]),
    [suggestions, setSuggestions] = useState<any[]>([]),
    a = useAction(),
    options = useK("/options"),
    graph = useK(
      "/map-edges" +
        (s.cards.some((c: any) => c.ref.kind === "work")
          ? "?workIds=" +
            s.cards
              .filter((c: any) => c.ref.kind === "work")
              .map((c: any) => c.ref.id)
              .join(",")
          : ""),
    );
  const labels = new Map((row.cards ?? []).map((c: any) => [c.id, c]));
  const info = (c: any): any =>
    labels.get(c.id) ?? {
      source: {
        label:
          Object.values(options.data ?? {})
            .flatMap((v: any) => (Array.isArray(v) ? v : []))
            .find((o: any) => o.id === c.ref.id)?.label ?? c.ref.id,
        url:
          c.ref.kind === "work"
            ? "/read/" + c.ref.id
            : c.ref.kind === "note"
              ? "/notes/" + c.ref.id
              : c.ref.kind === "passage"
                ? "/passages/" + c.ref.id
                : "/knowledge?tab=entities&entity=" + c.ref.id,
      },
      year: null,
    };
  const patch = (id: string, key: string, value: any) =>
    setS({
      ...s,
      cards: s.cards.map((c: any) =>
        c.id === id ? { ...c, [key]: value } : c,
      ),
    });
  const add = (r: any) => {
    if (s.cards.some((c: any) => c.ref.id === r.id && c.ref.kind === r.kind))
      return;
    let slot = 0;
    while (
      slot < 1000 &&
      s.cards.some(
        (c: any) =>
          Math.abs(c.x - (20 + (slot % 6) * 300)) < 280 &&
          Math.abs(c.y - (20 + Math.floor(slot / 6) * 180)) < 160,
      )
    )
      slot++;
    const card = {
      id: crypto.randomUUID(),
      ref: { kind: r.kind, id: r.id },
      x: 20 + (slot % 6) * 300,
      y: 20 + Math.floor(slot / 6) * 180,
      pinned: false,
      groupId: null,
      explanation: "",
    };
    setS({ ...s, cards: [...s.cards, card] });
    setSelected(card.id);
  };
  const filters = (next: any) =>
    setS({
      ...s,
      history: [...s.history, s.filters].slice(-20),
      filters: { ...s.filters, ...next },
    });
  const visible = s.cards.filter(
    (c: any) =>
      (!s.filters.visible.length || s.filters.visible.includes(c.id)) &&
      (!info(c).year ||
        ((!s.filters.yearFrom || info(c).year >= s.filters.yearFrom) &&
          (!s.filters.yearTo || info(c).year <= s.filters.yearTo))),
  );
  const expanded = visible.filter(
      (c: any) => !s.groups.find((g: any) => g.id === c.groupId)?.collapsed,
    ),
    card = s.cards.find((c: any) => c.id === selected),
    next = s.path.find((p: any) => !p.complete),
    nodeByRef = new Map(
      expanded.map((c: any) => [
        (info(c).source.kind ?? c.ref.kind) +
          ":" +
          (info(c).source.id ?? c.ref.id),
        c,
      ]),
    );
  const edges = (graph.data?.edges ?? []).filter(
    (e: any) =>
      s.filters.layers.includes(e.layer) &&
      nodeByRef.has(e.source.kind + ":" + e.source.id) &&
      nodeByRef.has(e.target.kind + ":" + e.target.id),
  );
  const download = async (format: string) => {
    if (format === "json") {
      const data = await get(`/boards/${row.id}/export?format=json`);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "research-map.json";
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const a = document.createElement("a");
      a.href = `/api/v1/knowledge/boards/${row.id}/export?format=svg`;
      a.download = "research-map.svg";
      a.click();
    }
  };
  return (
    <>
      <Feedback action={a} />
      <section className="review-panel">
        <div className="research-filters">
          <Field label="Map title">
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Current research question">
            <input
              value={s.question}
              onChange={(e) => setS({ ...s, question: e.target.value })}
            />
          </Field>
        </div>
        <div className="toolbar">
          <button
            className="button primary"
            disabled={a.busy}
            onClick={() =>
              void a.run(() =>
                send(
                  "/boards/" + row.id,
                  { title, state: s, version: row.version },
                  "PATCH",
                ),
              )
            }
          >
            Save map and path
          </button>
          <button
            className="button secondary"
            onClick={() =>
              void a.run(() => download("json"), "Saved map JSON exported.")
            }
          >
            Export saved JSON
          </button>
          <button
            className="button secondary"
            onClick={() =>
              void a.run(() => download("svg"), "Saved map figure exported.")
            }
          >
            Export saved SVG
          </button>
        </div>
        <RefPicker
          label="Add map object"
          value={ref}
          onChange={setRef}
          options={options.data}
        />
        <button
          className="button secondary"
          disabled={!ref.id || s.cards.length >= 100}
          onClick={() => add(ref)}
        >
          Add card
        </button>
        <p>
          {s.cards.length}/100 cards · Save to persist edits. Exports reflect
          the saved map.
        </p>
        <div className="research-filters">
          <Choice
            label="Map view"
            value={s.filters.view}
            onChange={(view) => filters({ view })}
            items={["spatial", "timeline", "list"]}
          />
          <Field label="From year">
            <input
              type="number"
              value={s.filters.yearFrom ?? ""}
              onChange={(e) =>
                filters({
                  yearFrom: e.target.value ? Number(e.target.value) : null,
                })
              }
            />
          </Field>
          <Field label="Through year">
            <input
              type="number"
              value={s.filters.yearTo ?? ""}
              onChange={(e) =>
                filters({
                  yearTo: e.target.value ? Number(e.target.value) : null,
                })
              }
            />
          </Field>
          <button
            className="button secondary"
            disabled={!s.history.length}
            onClick={() =>
              setS({
                ...s,
                filters: s.history.at(-1),
                history: s.history.slice(0, -1),
              })
            }
          >
            Back view
          </button>
          <button
            className="button secondary"
            onClick={() => filters({ visible: [] })}
          >
            Show all cards
          </button>
        </div>
        <div className="toolbar">
          {MapLayers.options.map((layer) => (
            <label className="check-line" key={layer}>
              <input
                type="checkbox"
                checked={s.filters.layers.includes(layer)}
                onChange={(e) =>
                  filters({
                    layers: e.target.checked
                      ? [...s.filters.layers, layer]
                      : s.filters.layers.filter((x: string) => x !== layer),
                  })
                }
              />
              {layer}
            </label>
          ))}
        </div>
        <p>
          {visible.length} filtered cards · {edges.length} visible edges.
          Undated cards remain visible.{" "}
          {graph.data?.coverage?.truncated ? "Graph source limit reached." : ""}
        </p>
      </section>
      <section className="review-panel">
        <div className="research-filters">
          <Field label="New group name">
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
            />
          </Field>
          <button
            className="button secondary"
            disabled={!groupName || s.groups.length >= 30}
            onClick={() => {
              setS({
                ...s,
                groups: [
                  ...s.groups,
                  {
                    id: crypto.randomUUID(),
                    name: groupName,
                    collapsed: false,
                  },
                ],
              });
              setGroupName("");
            }}
          >
            Add topic group
          </button>
        </div>
        {s.groups.map((g: any) => (
          <label className="check-line" key={g.id}>
            <input
              type="checkbox"
              checked={g.collapsed}
              onChange={(e) =>
                setS({
                  ...s,
                  groups: s.groups.map((x: any) =>
                    x.id === g.id ? { ...x, collapsed: e.target.checked } : x,
                  ),
                })
              }
            />
            Collapse {g.name} (
            {visible.filter((c: any) => c.groupId === g.id).length} cards)
          </label>
        ))}
        {s.filters.view === "spatial" ? (
          <div className="board-scroll">
            <div
              className="board-surface"
              style={{
                width: Math.max(850, ...expanded.map((c: any) => c.x + 290)),
                height: Math.max(420, ...expanded.map((c: any) => c.y + 160)),
              }}
            >
              <svg
                className="board-lines"
                width="100%"
                height="100%"
                aria-label="Connections between visible cards"
              >
                {edges.map((e: any) => {
                  const a: any = nodeByRef.get(
                      e.source.kind + ":" + e.source.id,
                    ),
                    b: any = nodeByRef.get(e.target.kind + ":" + e.target.id);
                  return (
                    <line
                      key={e.id}
                      x1={a.x + 130}
                      y1={a.y + 60}
                      x2={b.x + 130}
                      y2={b.y + 60}
                      stroke="#72998e"
                      strokeWidth="2"
                      strokeDasharray={
                        e.layer === "citation" ? undefined : "6 4"
                      }
                    >
                      <title>{e.predicate + " · " + e.layer}</title>
                    </line>
                  );
                })}
              </svg>
              {expanded.map((c: any) => (
                <div
                  key={c.id}
                  className={
                    "board-card " + (c.id === selected ? "active" : "")
                  }
                  style={{ left: c.x, top: c.y }}
                >
                  <button
                    className="card-drag"
                    aria-label={"Move " + info(c).source.label}
                    onPointerDown={(e) => {
                      if (c.pinned) return;
                      const el = e.currentTarget,
                        start = {
                          x: e.clientX,
                          y: e.clientY,
                          cx: c.x,
                          cy: c.y,
                        };
                      el.setPointerCapture(e.pointerId);
                      const move = (ev: PointerEvent) =>
                        setS((old: any) => ({
                          ...old,
                          cards: old.cards.map((x: any) =>
                            x.id === c.id
                              ? {
                                  ...x,
                                  x: Math.min(
                                    5000,
                                    Math.max(
                                      0,
                                      start.cx + ev.clientX - start.x,
                                    ),
                                  ),
                                  y: Math.min(
                                    5000,
                                    Math.max(
                                      0,
                                      start.cy + ev.clientY - start.y,
                                    ),
                                  ),
                                }
                              : x,
                          ),
                        }));
                      const up = () => {
                        el.removeEventListener("pointermove", move);
                        el.removeEventListener("pointerup", up);
                        el.removeEventListener("pointercancel", up);
                      };
                      el.addEventListener("pointermove", move);
                      el.addEventListener("pointerup", up);
                      el.addEventListener("pointercancel", up);
                    }}
                  >
                    {c.pinned ? "Pinned" : "Drag to move"}
                  </button>
                  <button
                    className="cell-button"
                    onClick={() => setSelected(c.id)}
                  >
                    {info(c).source.label}
                  </button>
                  <small>
                    {info(c).year ?? "Undated"} ·{" "}
                    {s.groups.find((g: any) => g.id === c.groupId)?.name ??
                      "Ungrouped"}
                  </small>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <ol className="board-list">
            {[...visible]
              .sort((a: any, b: any) =>
                s.filters.view === "timeline"
                  ? (info(a).year ?? 9999) - (info(b).year ?? 9999)
                  : 0,
              )
              .map((c: any) => (
                <li key={c.id}>
                  <button
                    className="cell-button"
                    onClick={() => setSelected(c.id)}
                  >
                    {info(c).year ?? "Undated"} · {info(c).source.label}
                  </button>
                  <p>{c.explanation}</p>
                </li>
              ))}
          </ol>
        )}
        <details>
          <summary>Visible connection list ({edges.length})</summary>
          {edges.map((e: any) => (
            <p key={e.id}>
              {e.source.label} → {e.predicate} → {e.target.label} · {e.layer}:{" "}
              {e.explanation}
            </p>
          ))}
        </details>
      </section>
      {card && (
        <section className="review-panel">
          <h2>Selected card: {info(card).source.label}</h2>
          <a href={info(card).source.url}>Open source</a>
          <button
            className="button secondary"
            onClick={() => {
              const clean = (f: any) => ({
                ...f,
                visible: f.visible.filter((id: string) => id !== card.id),
              });
              setS({
                ...s,
                cards: s.cards.filter((c: any) => c.id !== card.id),
                path: s.path.filter((p: any) => p.cardId !== card.id),
                filters: clean(s.filters),
                history: s.history.map(clean),
              });
              setSelected("");
            }}
          >
            Remove card from map
          </button>
          <div className="research-filters">
            <Field label="Card X">
              <input
                type="number"
                min="0"
                max="5000"
                value={card.x}
                onChange={(e) => patch(card.id, "x", Number(e.target.value))}
              />
            </Field>
            <Field label="Card Y">
              <input
                type="number"
                min="0"
                max="5000"
                value={card.y}
                onChange={(e) => patch(card.id, "y", Number(e.target.value))}
              />
            </Field>
            <Choice
              label="Card group"
              value={card.groupId ?? ""}
              onChange={(v) => patch(card.id, "groupId", v || null)}
              items={s.groups}
            />
            <label className="check-line">
              <input
                type="checkbox"
                checked={card.pinned}
                onChange={(e) => patch(card.id, "pinned", e.target.checked)}
              />
              Pin card position
            </label>
          </div>
          <Field label="Card explanation">
            <textarea
              aria-label="Card explanation"
              value={card.explanation}
              onChange={(e) => patch(card.id, "explanation", e.target.value)}
            />
          </Field>
          <div className="toolbar">
            <button
              className="button secondary"
              onClick={() => filters({ visible: [card.id] })}
            >
              Focus this card
            </button>
            <button
              className="button secondary"
              onClick={() =>
                void a.run(
                  async () =>
                    setNeighbors(
                      (
                        await send("/boards/neighbors", {
                          ref: card.ref,
                          existing: s.cards.map((c: any) => c.ref.id),
                        })
                      ).items,
                    ),
                  "Review the one-hop expansion candidates.",
                )
              }
            >
              Find one-hop neighbors
            </button>
          </div>
          {neighbors.map((n: any) => (
            <p key={n.ref.kind + n.ref.id}>
              <button
                className="button secondary"
                disabled={s.cards.length >= 100}
                onClick={() => {
                  add(n.ref);
                  setNeighbors(neighbors.filter((x) => x.ref.id !== n.ref.id));
                }}
              >
                Add {n.ref.label}
              </button>{" "}
              {n.reason}
            </p>
          ))}
        </section>
      )}
      <section className="review-panel">
        <h2>Editable reading path</h2>
        {next && (
          <a
            className="button primary"
            href={
              info(s.cards.find((c: any) => c.id === next.cardId)).source.url
            }
          >
            Resume next reading step
          </a>
        )}
        <button
          className="button secondary"
          onClick={() =>
            void a.run(
              async () =>
                setSuggestions(
                  (await send("/boards/path-suggestions", s)).items,
                ),
              "Review suggestions before adding them to the path.",
            )
          }
        >
          Suggest reading steps
        </button>
        {suggestions
          .filter((p) => !s.path.some((x: any) => x.cardId === p.cardId))
          .map((p) => (
            <article className="k-row" key={p.cardId}>
              <strong>
                {p.label} · {p.role}
              </strong>
              <p>{p.rationale}</p>
              <button
                className="button secondary"
                onClick={() =>
                  setS({
                    ...s,
                    path: [
                      ...s.path,
                      {
                        cardId: p.cardId,
                        role: p.role,
                        rationale: p.rationale,
                        complete: false,
                      },
                    ],
                  })
                }
              >
                Add suggested step
              </button>
            </article>
          ))}
        {s.path.map((p: any, i: number) => (
          <article className="outline-block" key={p.cardId}>
            <h3>
              {i + 1}.{" "}
              {info(s.cards.find((c: any) => c.id === p.cardId)).source.label}
            </h3>
            <Choice
              label={"Step " + (i + 1) + " role"}
              value={p.role}
              onChange={(role) =>
                setS({
                  ...s,
                  path: s.path.map((x: any, j: number) =>
                    j === i ? { ...x, role } : x,
                  ),
                })
              }
              items={["background", "comparison", "next_step"]}
            />
            <Field label={"Step " + (i + 1) + " rationale"}>
              <textarea
                aria-label={"Step " + (i + 1) + " rationale"}
                value={p.rationale}
                onChange={(e) =>
                  setS({
                    ...s,
                    path: s.path.map((x: any, j: number) =>
                      j === i ? { ...x, rationale: e.target.value } : x,
                    ),
                  })
                }
              />
            </Field>
            <label className="check-line">
              <input
                type="checkbox"
                checked={p.complete}
                onChange={(e) =>
                  setS({
                    ...s,
                    path: s.path.map((x: any, j: number) =>
                      j === i ? { ...x, complete: e.target.checked } : x,
                    ),
                  })
                }
              />
              Step complete
            </label>
            <div className="toolbar">
              <button
                className="button secondary"
                disabled={!i}
                onClick={() => {
                  const path = [...s.path];
                  [path[i - 1], path[i]] = [path[i], path[i - 1]];
                  setS({ ...s, path });
                }}
              >
                Move step up
              </button>
              <button
                className="button secondary"
                onClick={() =>
                  setS({
                    ...s,
                    path: s.path.filter((_: any, j: number) => j !== i),
                  })
                }
              >
                Remove step
              </button>
            </div>
          </article>
        ))}
      </section>
    </>
  );
}
