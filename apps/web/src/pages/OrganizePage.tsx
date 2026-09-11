import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ReadingState } from "@vani/shared";
import { request } from "../api";
import { ErrorNotice, PageHeader } from "../components/ui";
export function OrganizePage() {
  const client = useQueryClient();
  const [tab, setTab] = useState("collections"),
    [collectionId, setCollectionId] = useState(""),
    [text, setText] = useState(""),
    [tag, setTag] = useState(""),
    [unfiled, setUnfiled] = useState(false),
    [yearFrom, setYearFrom] = useState(""),
    [yearTo, setYearTo] = useState(""),
    [filterStatus, setFilterStatus] = useState(""),
    [offset, setOffset] = useState(0),
    [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState(""),
    [parent, setParent] = useState(""),
    [saved, setSaved] = useState(false),
    [editCollection, setEditCollection] = useState<any>(null),
    [destination, setDestination] = useState(""),
    [status, setStatus] = useState("inbox"),
    [priority, setPriority] = useState(0),
    [rationale, setRationale] = useState("");
  const [sourceId, setSourceId] = useState(""),
    [targetId, setTargetId] = useState(""),
    [preview, setPreview] = useState<any>(),
    [relation, setRelation] = useState("version_of"),
    [reason, setReason] = useState(""),
    [sourceUrl, setSourceUrl] = useState("");
  const [operation, setOperation] = useState("add_tag"),
    [field, setField] = useState("publisher"),
    [value, setValue] = useState(""),
    [alias, setAlias] = useState(""),
    [batch, setBatch] = useState<any>();
  const rule = {
    text,
    tag,
    unfiled,
    ...(yearFrom ? { yearFrom: Number(yearFrom) } : {}),
    ...(yearTo ? { yearTo: Number(yearTo) } : {}),
    ...(filterStatus ? { status: filterStatus } : {}),
  };
  const collections = useQuery({
    queryKey: ["organization-collections"],
    queryFn: () => request<any>("/organization/collections"),
  });
  const works = useQuery({
    queryKey: ["organization-works", rule, collectionId, offset],
    queryFn: () =>
      request<any>("/organization/works", {
        method: "POST",
        body: JSON.stringify({
          rule,
          collectionId: collectionId || undefined,
          offset,
        }),
      }),
  });
  const candidates = useQuery({
    queryKey: ["identity"],
    queryFn: () => request<any>("/identity/candidates"),
    enabled: tab === "identity",
  });
  const identityHistory = useQuery({
    queryKey: ["identity-history"],
    queryFn: () => request<any>("/identity/history"),
    enabled: tab === "identity",
  });
  const history = useQuery({
    queryKey: ["cleanup"],
    queryFn: () => request<any>("/cleanup"),
    enabled: tab === "cleanup",
  });
  const mutation = useMutation({
    mutationFn: ({
      path,
      body,
      method = "POST",
      kind,
    }: {
      path: string;
      body?: unknown;
      method?: string;
      kind?: string;
    }) =>
      request<any>(path, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }).then((data) => ({ data, kind })),
    onSuccess: ({ data, kind }) => {
      client.invalidateQueries();
      if (kind === "preview") setPreview(data);
      if (kind === "batch") setBatch(data);
      if (kind === "collection") {
        setName("");
        setEditCollection(null);
      }
      if (kind === "merge") setPreview(undefined);
    },
  });
  const run = (path: string, body?: unknown, method = "POST", kind?: string) =>
    mutation.mutate({ path, body, method, kind });
  const error =
    mutation.error ||
    collections.error ||
    works.error ||
    candidates.error ||
    history.error;
  return (
    <div className="page">
      <PageHeader
        eyebrow="F04–F06 · Organize"
        title="A library you can trust"
        description="Organize projects, review identities, and preview reversible cleanup."
      />
      <div className="tab-row">
        {["collections", "identity", "cleanup"].map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {error && <ErrorNotice error={error} />}
      <section className="review-panel">
        <h2>Find and select papers</h2>
        <div className="research-filters">
          <label>
            Collection
            <select
              aria-label="Collection"
              value={collectionId}
              onChange={(e) => {
                setCollectionId(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">All library</option>
              {collections.data?.items.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.parent_id ? "↳ " : ""}
                  {c.name}
                  {c.collection_type === "saved_search"
                    ? " (saved search)"
                    : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Text
            <input
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setOffset(0);
              }}
            />
          </label>
          <label>
            Tag
            <input
              value={tag}
              onChange={(e) => {
                setTag(e.target.value);
                setOffset(0);
              }}
            />
          </label>
          <label>
            From year
            <input
              type="number"
              value={yearFrom}
              onChange={(e) => {
                setYearFrom(e.target.value);
                setOffset(0);
              }}
            />
          </label>
          <label>
            To year
            <input
              type="number"
              value={yearTo}
              onChange={(e) => {
                setYearTo(e.target.value);
                setOffset(0);
              }}
            />
          </label>
          <label>
            Reading state
            <select
              aria-label="Reading state"
              value={filterStatus}
              onChange={(e) => {
                setFilterStatus(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">Any</option>
              {ReadingState.options.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="check-line">
            <input
              type="checkbox"
              checked={unfiled}
              onChange={(e) => {
                setUnfiled(e.target.checked);
                setOffset(0);
              }}
            />
            Unfiled inbox
          </label>
        </div>
        <p>
          {works.data?.total ?? 0} matching papers · {selected.length} selected{" "}
          <button className="button secondary" onClick={() => setSelected([])}>
            Clear selection
          </button>
        </p>
        <div className="research-work-list">
          {works.data?.items.map((w: any) => (
            <article key={w.id}>
              <label className="check-line">
                <input
                  type="checkbox"
                  aria-label={`Select ${w.title}`}
                  checked={selected.includes(w.id)}
                  disabled={!selected.includes(w.id) && selected.length >= 100}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, w.id]
                        : selected.filter((id) => id !== w.id),
                    )
                  }
                />
                <strong>{w.title}</strong>
              </label>
              <Link to={`/read/${w.id}`}>{w.citation_key}</Link>
              <span>
                {" "}
                · {w.year} · {w.tags.join(", ")}
              </span>
              <small>
                {w.memberships
                  .map(
                    (m: any) =>
                      `${collections.data?.items.find((c: any) => c.id === m.collectionId)?.name ?? m.collectionId}: ${m.status}, priority ${m.priority}${m.rationale ? " — " + m.rationale : ""}`,
                  )
                  .join(" · ")}
              </small>
              {w.memberships.map((m: any) => (
                <button
                  className="button small secondary"
                  key={m.collectionId}
                  disabled={mutation.isPending}
                  onClick={() =>
                    run(
                      `/organization/memberships/${m.collectionId}/${w.id}`,
                      undefined,
                      "DELETE",
                    )
                  }
                >
                  Unfile from{" "}
                  {collections.data?.items.find(
                    (c: any) => c.id === m.collectionId,
                  )?.name ?? "collection"}
                </button>
              ))}
            </article>
          ))}
        </div>
        <div className="toolbar">
          <button
            className="button secondary"
            disabled={!offset}
            onClick={() => setOffset(Math.max(0, offset - 100))}
          >
            Previous 100
          </button>
          <button
            className="button secondary"
            disabled={offset + 100 >= (works.data?.total ?? 0)}
            onClick={() => setOffset(offset + 100)}
          >
            Next 100
          </button>
        </div>
      </section>
      {tab === "collections" && (
        <>
          <section className="review-panel">
            <h2>{editCollection ? "Edit collection" : "Create collection"}</h2>
            <form
              className="stack-form"
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  "/organization/collections" +
                    (editCollection ? "/" + editCollection.id : ""),
                  {
                    name,
                    parentId: parent || null,
                    rule: saved ? rule : null,
                    ...(editCollection
                      ? {
                          revision: editCollection.version,
                          description: editCollection.description,
                        }
                      : {}),
                  },
                  editCollection ? "PATCH" : "POST",
                  "collection",
                );
              }}
            >
              <label>
                Name
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                Parent
                <select
                  aria-label="Parent"
                  value={parent}
                  onChange={(e) => setParent(e.target.value)}
                >
                  <option value="">Top level</option>
                  {collections.data?.items.map((c: any) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="check-line">
                <input
                  type="checkbox"
                  disabled={Boolean(editCollection)}
                  checked={saved}
                  onChange={(e) => setSaved(e.target.checked)}
                />
                Saved search using the filters above
              </label>
              {saved && <pre>{JSON.stringify(rule, null, 2)}</pre>}
              <button className="button primary" disabled={mutation.isPending}>
                Save collection
              </button>
            </form>
            <div className="research-work-list">
              {collections.data?.items.map((c: any) => (
                <article key={c.id}>
                  <strong>{c.name}</strong>
                  <span>
                    {" "}
                    · {c.collection_type} · Parent:{" "}
                    {collections.data?.items.find(
                      (p: any) => p.id === c.parent_id,
                    )?.name ?? "Top level"}
                  </span>
                  <button
                    className="button secondary"
                    onClick={() => {
                      setEditCollection(c);
                      setName(c.name);
                      setParent(c.parent_id ?? "");
                      setSaved(c.collection_type === "saved_search");
                      if (c.search_rule) {
                        setText(c.search_rule.text ?? "");
                        setTag(c.search_rule.tag ?? "");
                        setUnfiled(c.search_rule.unfiled ?? false);
                        setYearFrom(c.search_rule.yearFrom?.toString() ?? "");
                        setYearTo(c.search_rule.yearTo?.toString() ?? "");
                        setFilterStatus(c.search_rule.status ?? "");
                      }
                    }}
                  >
                    Edit {c.name}
                  </button>
                </article>
              ))}
            </div>
            {editCollection && (
              <button
                className="button secondary"
                onClick={() => {
                  setEditCollection(null);
                  setName("");
                }}
              >
                Cancel edit
              </button>
            )}
          </section>
          <section className="review-panel">
            <h2>File selected papers</h2>
            <form
              className="stack-form"
              onSubmit={(e) => {
                e.preventDefault();
                run("/organization/memberships", {
                  collectionId: destination,
                  workIds: selected,
                  status,
                  priority,
                  rationale,
                });
              }}
            >
              <label>
                Destination project
                <select
                  aria-label="Destination project"
                  required
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                >
                  <option value="">Choose manual collection</option>
                  {collections.data?.items
                    .filter((c: any) => c.collection_type === "manual")
                    .map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Project reading state
                <select
                  aria-label="Project reading state"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {ReadingState.options.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label>
                Priority (0–5)
                <input
                  type="number"
                  min={0}
                  max={5}
                  value={priority}
                  onChange={(e) => setPriority(Number(e.target.value))}
                />
              </label>
              <label>
                Project relevance
                <textarea
                  value={rationale}
                  onChange={(e) => setRationale(e.target.value)}
                />
              </label>
              <button
                className="button primary"
                disabled={!selected.length || mutation.isPending}
              >
                Save project state
              </button>
            </form>
            <p>
              Use the Cleanup tab to add, remove or consolidate tags on selected
              papers.
            </p>
          </section>
        </>
      )}
      {tab === "identity" && (
        <>
          <section className="review-panel">
            <h2>Review suspected duplicates</h2>
            <p>
              Suggestions use title similarity and shared PDFs. They are not
              automatic merge decisions. Showing at most 100 pairs.
            </p>
            {candidates.data?.items.map((p: any) => (
              <article className="decision-row" key={p.source_id + p.target_id}>
                <strong>
                  {p.source_title} ↔ {p.target_title}
                </strong>
                <span>
                  {p.shared_pdf ? "Shared PDF · " : ""}Title similarity{" "}
                  {(p.similarity * 100).toFixed(0)}%
                </span>
                <div>
                  <button
                    className="button secondary"
                    onClick={() => {
                      setSourceId(p.source_id);
                      setTargetId(p.target_id);
                      setPreview(undefined);
                    }}
                  >
                    Review this pair
                  </button>
                  <button
                    className="button secondary"
                    onClick={() =>
                      run("/identity/dismiss", {
                        sourceId: p.source_id,
                        targetId: p.target_id,
                      })
                    }
                  >
                    Keep separate
                  </button>
                </div>
              </article>
            ))}
          </section>
          <section className="review-panel">
            <h2>Merge or relate two records</h2>
            <details>
              <summary>Merge and dismissal history</summary>
              {identityHistory.data?.items.map((entry: any) => (
                <details key={entry.id}>
                  <summary>
                    {entry.action} ·{" "}
                    {new Date(entry.created_at).toLocaleString()}
                  </summary>
                  <pre>{JSON.stringify(entry.snapshot, null, 2)}</pre>
                </details>
              ))}
            </details>
            <button
              className="button secondary"
              disabled={selected.length !== 2}
              onClick={() => {
                setSourceId(selected[0]!);
                setTargetId(selected[1]!);
                setPreview(undefined);
              }}
            >
              Use two selected papers
            </button>
            <div className="research-filters">
              <label>
                Original record ID
                <input
                  value={sourceId}
                  onChange={(e) => {
                    setSourceId(e.target.value);
                    setPreview(undefined);
                  }}
                />
              </label>
              <label>
                Canonical / related record ID
                <input
                  value={targetId}
                  onChange={(e) => {
                    setTargetId(e.target.value);
                    setPreview(undefined);
                  }}
                />
              </label>
            </div>
            <button
              className="button secondary"
              disabled={!sourceId || !targetId || mutation.isPending}
              onClick={() =>
                run(
                  "/identity/preview",
                  { sourceId, targetId },
                  "POST",
                  "preview",
                )
              }
            >
              Preview merge
            </button>
            {preview && (
              <>
                <p>{preview.policy}</p>
                <div className="research-columns">
                  {["source", "target"].map((side) => (
                    <div key={side}>
                      <h3>
                        {side === "source"
                          ? "Preserved alias"
                          : "Canonical record"}
                      </h3>
                      <strong>{preview[side].title}</strong>
                      <p>
                        {preview[side].citation_key} ·{" "}
                        {preview[side].doi || "No DOI"}
                      </p>
                      <pre>
                        {JSON.stringify(preview[side + "Counts"], null, 2)}
                      </pre>
                    </div>
                  ))}
                </div>
                {preview.conflicts.map((c: string) => (
                  <p key={c} className="review-warnings">
                    {c}
                  </p>
                ))}
                <button
                  className="button primary"
                  disabled={preview.conflicts.length > 0 || mutation.isPending}
                  onClick={() =>
                    run(
                      "/identity/merge",
                      {
                        sourceId: preview.source.id,
                        targetId: preview.target.id,
                        sourceRevision: preview.source.version,
                        targetRevision: preview.target.version,
                      },
                      "POST",
                      "merge",
                    )
                  }
                >
                  Confirm logical merge
                </button>
              </>
            )}
            <form
              className="stack-form"
              onSubmit={(e) => {
                e.preventDefault();
                run(`/works/${sourceId}/versions`, {
                  targetId,
                  relation,
                  reason,
                  sourceUrl,
                });
              }}
            >
              <h3>Keep distinct versions linked</h3>
              <label>
                Original record is
                <select
                  aria-label="Original record is"
                  value={relation}
                  onChange={(e) => setRelation(e.target.value)}
                >
                  {["preprint_of", "version_of", "corrects", "retracts"].map(
                    (r) => (
                      <option key={r}>{r}</option>
                    ),
                  )}
                </select>
              </label>
              <label>
                Reason / evidence
                <textarea
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <label>
                Supporting URL
                <input
                  type="url"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                />
              </label>
              <button
                className="button primary"
                disabled={!sourceId || !targetId || mutation.isPending}
              >
                Save version relationship
              </button>
            </form>
          </section>
        </>
      )}
      {tab === "cleanup" && (
        <section className="review-panel">
          <h2>Preview batch cleanup</h2>
          <form
            className="stack-form"
            onSubmit={(e) => {
              e.preventDefault();
              const op =
                operation === "field"
                  ? {
                      type: operation,
                      field,
                      value:
                        field === "year"
                          ? value
                            ? Number(value)
                            : null
                          : value,
                    }
                  : operation === "merge_tag"
                    ? { type: operation, from: alias, to: value }
                    : operation === "normalize_names"
                      ? { type: operation }
                      : { type: operation, tag: value };
              run(
                "/cleanup/preview",
                { workIds: selected, operation: op },
                "POST",
                "batch",
              );
            }}
          >
            <label>
              Operation
              <select
                aria-label="Operation"
                value={operation}
                onChange={(e) => setOperation(e.target.value)}
              >
                {[
                  "field",
                  "add_tag",
                  "remove_tag",
                  "merge_tag",
                  "normalize_names",
                ].map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
            {operation === "field" && (
              <label>
                Field
                <select
                  aria-label="Field"
                  value={field}
                  onChange={(e) => setField(e.target.value)}
                >
                  {[
                    "title",
                    "venue",
                    "publisher",
                    "year",
                    "language",
                    "publicationType",
                  ].map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </label>
            )}
            {operation === "merge_tag" && (
              <label>
                Tag alias
                <input
                  required
                  value={alias}
                  onChange={(e) => setAlias(e.target.value)}
                />
              </label>
            )}
            {operation !== "normalize_names" && (
              <label>
                New value / tag
                <input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </label>
            )}
            <button
              className="button primary"
              disabled={!selected.length || mutation.isPending}
            >
              Preview selected changes
            </button>
          </form>
          {batch && (
            <>
              <h3>Batch · {batch.state}</h3>
              {batch.items.map((item: any) => (
                <details key={item.id} open>
                  <summary>{item.title}</summary>
                  <table className="review-table">
                    <thead>
                      <tr>
                        <th>Before</th>
                        <th>After</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>
                          <pre>
                            {JSON.stringify(
                              {
                                fields: Object.fromEntries(
                                  Object.entries(item.before.fields).filter(
                                    ([k, v]) =>
                                      JSON.stringify(v) !==
                                      JSON.stringify(item.after.fields[k]),
                                  ),
                                ),
                                tags: item.before.tags,
                              },
                              null,
                              2,
                            )}
                          </pre>
                        </td>
                        <td>
                          <pre>
                            {JSON.stringify(
                              {
                                fields: Object.fromEntries(
                                  Object.entries(item.after.fields).filter(
                                    ([k, v]) =>
                                      JSON.stringify(v) !==
                                      JSON.stringify(item.before.fields[k]),
                                  ),
                                ),
                                tags: item.after.tags,
                              },
                              null,
                              2,
                            )}
                          </pre>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </details>
              ))}
              {batch.state !== "undone" && (
                <button
                  className="button primary"
                  disabled={mutation.isPending}
                  onClick={() =>
                    run(
                      `/cleanup/${batch.id}/${batch.state === "preview" ? "apply" : "undo"}`,
                      {},
                      "POST",
                      "batch",
                    )
                  }
                >
                  {batch.state === "preview"
                    ? "Apply previewed changes"
                    : "Undo this batch"}
                </button>
              )}
            </>
          )}
          <h3>Cleanup history</h3>
          {history.data?.items.map((b: any) => (
            <p key={b.id}>
              <button className="button secondary" onClick={() => setBatch(b)}>
                {new Date(b.created_at).toLocaleString()} · {b.operation.type} ·{" "}
                {b.state}
              </button>
            </p>
          ))}
        </section>
      )}
    </div>
  );
}
