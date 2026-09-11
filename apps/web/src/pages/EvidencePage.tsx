import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "../api";
import { ErrorNotice, PageHeader } from "../components/ui";
export function EvidencePage() {
  const client = useQueryClient();
  const [topic, setTopic] = useState(""),
    [tag, setTag] = useState(""),
    [collection, setCollection] = useState(""),
    [type, setType] = useState(""),
    [argumentId, setArgument] = useState(""),
    [offset, setOffset] = useState(0),
    [selected, setSelected] = useState<string[]>([]),
    [target, setTarget] = useState(""),
    [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [rationale, setRationale] = useState(""),
    [editing, setEditing] = useState<any>(null),
    [notice, setNotice] = useState("");
  const filters = {
    topic,
    tag,
    collectionId: collection || undefined,
    type: type || undefined,
    argumentId: argumentId || undefined,
    offset,
  };
  const evidence = useQuery({
    queryKey: ["evidence", filters],
    queryFn: () =>
      request<any>("/evidence", {
        method: "POST",
        body: JSON.stringify(filters),
      }),
  });
  const collections = useQuery({
    queryKey: ["organization-collections"],
    queryFn: () => request<any>("/organization/collections"),
  });
  const argumentsQuery = useQuery({
    queryKey: ["arguments"],
    queryFn: () => request<any>("/arguments"),
  });
  const mutation = useMutation({
    mutationFn: async ({
      path,
      body,
      method = "POST",
      many,
    }: {
      path?: string;
      body?: unknown;
      method?: string;
      many?: string[];
    }) => {
      if (many) {
        for (const id of many)
          await request(`/arguments/${target}/evidence/${id}`, {
            method: "PUT",
            body: JSON.stringify({ rationale }),
          });
        return;
      }
      return request<any>(path!, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    },
    onSuccess: () => {
      client.invalidateQueries();
      setEditing(null);
      setNotice("Saved.");
    },
  });
  const error = evidence.error || mutation.error || argumentsQuery.error;
  return (
    <div className="page">
      <PageHeader
        eyebrow="F09 · Evidence workspace"
        title="Connect passages to arguments"
        description="Quotes stay attached to their original document; reuse evidence across your research."
      />
      {error && <ErrorNotice error={error} />}{" "}
      {notice && <p role="status">{notice}</p>}
      <section className="review-panel">
        <div className="research-filters">
          <label>
            Topic or comment
            <input
              value={topic}
              onChange={(e) => {
                setTopic(e.target.value);
                setOffset(0);
              }}
            />
          </label>
          <label>
            Evidence or paper tag
            <input
              value={tag}
              onChange={(e) => {
                setTag(e.target.value);
                setOffset(0);
              }}
            />
          </label>
          <label>
            Collection
            <select
              aria-label="Collection"
              value={collection}
              onChange={(e) => {
                setCollection(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">All collections</option>
              {collections.data?.items.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Annotation type
            <select
              aria-label="Annotation type"
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">All types</option>
              {["highlight", "comment", "area"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            Argument
            <select
              aria-label="Argument"
              value={argumentId}
              onChange={(e) => {
                setArgument(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">All arguments</option>
              {argumentsQuery.data?.items.map((a: any) => (
                <option key={a.id} value={a.id}>
                  {a.title} ({a.evidence_count})
                </option>
              ))}
            </select>
          </label>
        </div>
        <p>
          {evidence.data?.total ?? 0} passages · {selected.length} selected{" "}
          <button className="button secondary" onClick={() => setSelected([])}>
            Clear selection
          </button>
        </p>
        {evidence.data?.items.map((item: any) => (
          <article className="evidence-card" key={item.id}>
            <label className="check-line">
              <input
                type="checkbox"
                aria-label={`Select passage ${item.id}`}
                checked={selected.includes(item.id)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...selected, item.id]
                      : selected.filter((id) => id !== item.id),
                  )
                }
              />
              <strong>{item.title}</strong>
            </label>
            <p>
              {item.citation_key} · {item.filename} · p. {item.page_start} ·{" "}
              {item.annotation_type} · Anchor: {item.anchor.status}
            </p>
            <blockquote>
              {item.selector.quote ||
                "Area selection — open the source to inspect."}
            </blockquote>
            <p>{item.body_markdown}</p>
            {item.arguments?.map((a: any) => (
              <p key={a.id}>
                <strong>{a.title}</strong>:{" "}
                {a.rationale || "No argument-specific rationale"}
              </p>
            ))}
            <small>
              {item.tags.join(", ")} · SHA-256 {item.object_hash}
            </small>
            <div className="toolbar">
              <Link className="button secondary" to={`/passages/${item.id}`}>
                Open exact source
              </Link>
              <button
                className="button secondary"
                onClick={() =>
                  setEditing({ ...item, tagText: item.tags.join(", ") })
                }
              >
                Edit comment / tags
              </button>
              <button
                className="button secondary"
                onClick={() =>
                  mutation.mutate({ path: `/passages/${item.id}/note` })
                }
              >
                Create linked note
              </button>
              <button
                className="button secondary"
                onClick={() =>
                  navigator.clipboard
                    .writeText(
                      `> ${item.selector.quote}\n\n[${item.citation_key}, p. ${item.page_start}](${new URL("/passages/" + item.id, location.href).href})`,
                    )
                    .then(() => setNotice("Markdown citation copied."))
                    .catch(() =>
                      setNotice(
                        "Clipboard unavailable. Open the source and copy its URL.",
                      ),
                    )
                }
              >
                Copy Markdown citation
              </button>
              {argumentId && (
                <button
                  className="button secondary"
                  onClick={() =>
                    mutation.mutate({
                      path: `/arguments/${argumentId}/evidence/${item.id}`,
                      method: "DELETE",
                    })
                  }
                >
                  Remove from this argument
                </button>
              )}
            </div>
          </article>
        ))}
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
            disabled={offset + 100 >= (evidence.data?.total ?? 0)}
            onClick={() => setOffset(offset + 100)}
          >
            Next 100
          </button>
        </div>
      </section>
      {editing && (
        <section className="review-panel">
          <h2>Edit evidence</h2>
          <form
            className="stack-form"
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate({
                path: `/annotations/${editing.id}`,
                method: "PATCH",
                body: {
                  revision: editing.version,
                  body: editing.body_markdown,
                  tags: editing.tagText
                    .split(",")
                    .map((t: string) => t.trim())
                    .filter(Boolean),
                },
              });
            }}
          >
            <label>
              Comment
              <textarea
                value={editing.body_markdown}
                onChange={(e) =>
                  setEditing({ ...editing, body_markdown: e.target.value })
                }
              />
            </label>
            <label>
              Tags
              <input
                value={editing.tagText}
                onChange={(e) =>
                  setEditing({ ...editing, tagText: e.target.value })
                }
              />
            </label>
            <button className="button primary" disabled={mutation.isPending}>
              Save evidence changes
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => setEditing(null)}
            >
              Cancel
            </button>
          </form>
        </section>
      )}
      <div className="research-columns">
        <section className="review-panel">
          <h2>Create an argument</h2>
          <form
            className="stack-form"
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate({
                path: "/arguments",
                body: { title, description },
              });
            }}
          >
            <label>
              Argument title
              <input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label>
              Description
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <button className="button primary" disabled={mutation.isPending}>
              Create argument
            </button>
          </form>
        </section>
        <section className="review-panel">
          <h2>Reuse selected evidence</h2>
          <form
            className="stack-form"
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate({ many: selected });
            }}
          >
            <label>
              Target argument
              <select
                aria-label="Target argument"
                required
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">Choose argument</option>
                {argumentsQuery.data?.items.map((a: any) => (
                  <option key={a.id} value={a.id}>
                    {a.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Why this evidence matters
              <textarea
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
              />
            </label>
            <button
              className="button primary"
              disabled={!selected.length || mutation.isPending}
            >
              Add selected evidence
            </button>
          </form>
          <p>Repeat for another argument to reuse the same passages.</p>
        </section>
      </div>
    </div>
  );
}
export function NotePage() {
  const { noteId } = useParams();
  const note = useQuery({
    queryKey: ["note", noteId],
    queryFn: () => request<any>("/notes/" + noteId),
  });
  return (
    <div className="page">
      <PageHeader title={note.data?.title ?? "Note"} />
      {note.error && <ErrorNotice error={note.error} />}
      <p style={{ whiteSpace: "pre-wrap" }}>{note.data?.markdown}</p>
      {Array.from(
        (note.data?.markdown ?? "").matchAll(/\/passages\/([a-f0-9-]{36})/g),
      ).map((m: any) => (
        <p key={m[1]}>
          <Link to={"/passages/" + m[1]}>Open linked source passage</Link>
        </p>
      ))}
    </div>
  );
}
