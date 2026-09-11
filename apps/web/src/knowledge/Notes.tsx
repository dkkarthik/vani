import { useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { request } from "../api";
import { ErrorNotice, Loading, PageHeader } from "../components/ui";
import {
  Choice,
  Feedback,
  Field,
  Source,
  send,
  useAction,
  useK,
} from "./common";
import { RichMarkdown } from "./RichMarkdown";
export function Notes() {
  const [type, setType] = useState(""),
    [q, setQ] = useState(""),
    [offset, setOffset] = useState(0),
    [title, setTitle] = useState("");
  const notes = useK(
      "/notes?" +
        new URLSearchParams({
          ...(type ? { type } : {}),
          q,
          offset: String(offset),
        }),
    ),
    action = useAction(),
    navigate = useNavigate();
  return (
    <>
      <div className="research-filters">
        <Field label="Find notes">
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOffset(0);
            }}
          />
        </Field>
        <Choice
          label="Note type filter"
          value={type}
          onChange={(v) => {
            setType(v);
            setOffset(0);
          }}
          items={["source", "topic", "argument", "claim", "synthesis"]}
          empty="All types"
        />
      </div>
      <Feedback action={action} />
      <form
        className="k-inline"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            const n = await send("/notes", {
              title,
              noteType: type || "source",
            });
            navigate("/notes/" + n.id);
          });
        }}
      >
        <Field label="New note title">
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <button className="button primary" disabled={action.busy}>
          Create note
        </button>
      </form>
      {notes.error && <ErrorNotice error={notes.error} />}
      <p>{notes.data?.total ?? 0} notes · 100 per page</p>
      {notes.data?.items.map((n: any) => (
        <article className="k-row" key={n.id}>
          <Link to={"/notes/" + n.id}>{n.title}</Link>
          <span>
            {n.note_type} · revision {n.version}
          </span>
          <p>{n.markdown.slice(0, 180)}</p>
        </article>
      ))}
      <div className="toolbar">
        <button
          className="button secondary"
          disabled={!offset}
          onClick={() => setOffset(Math.max(0, offset - 100))}
        >
          Previous notes
        </button>
        <button
          className="button secondary"
          disabled={offset + 100 >= (notes.data?.total ?? 0)}
          onClick={() => setOffset(offset + 100)}
        >
          Next notes
        </button>
      </div>
    </>
  );
}
export function NoteEditorPage() {
  const { noteId } = useParams(),
    note = useK("/notes/" + noteId, Boolean(noteId));
  if (note.error) return <ErrorNotice error={note.error} />;
  if (!note.data) return <Loading />;
  return (
    <div className="page knowledge-page">
      <PageHeader
        eyebrow="Contextual notes"
        title={note.data.title}
        description="Keep your interpretation separate from the quoted source."
      />
      <Link to="/knowledge?tab=notes">All notes</Link>
      <NoteEditor
        key={note.data.id + ":" + note.data.version}
        note={note.data}
      />
    </div>
  );
}
function NoteEditor({ note }: { note: any }) {
  const [draft, setDraft] = useState({
      title: note.title,
      markdown: note.markdown,
      noteType: note.note_type,
      workId: note.work_id,
      collectionId: note.collection_id,
      argumentId: note.argument_id,
      version: note.version,
    }),
    [reference, setReference] = useState(""),
    [kind, setKind] = useState("quote"),
    [label, setLabel] = useState(""),
    [target, setTarget] = useState(""),
    [rationale, setRationale] = useState("");
  const options = useK("/options"),
    args = useK("/argument-options"),
    action = useAction();
  const set = (key: string, value: any) => setDraft({ ...draft, [key]: value });
  return (
    <>
      <Feedback action={action} />
      <div className="research-columns">
        <section className="review-panel">
          <form
            className="stack-form"
            onSubmit={(e) => {
              e.preventDefault();
              void action.run(() => send("/notes/" + note.id, draft, "PATCH"));
            }}
          >
            <Field label="Note title">
              <input
                required
                value={draft.title}
                onChange={(e) => set("title", e.target.value)}
              />
            </Field>
            <Choice
              label="Note type"
              value={draft.noteType}
              onChange={(v) => set("noteType", v)}
              items={["source", "topic", "argument", "claim", "synthesis"]}
            />
            <Choice
              label="Source paper"
              value={draft.workId ?? ""}
              onChange={(v) => set("workId", v || null)}
              items={options.data?.works ?? []}
              empty="No source paper"
            />
            <Choice
              label="Argument association"
              value={draft.argumentId ?? ""}
              onChange={(v) => set("argumentId", v || null)}
              items={args.data?.items ?? []}
              empty="No argument"
            />
            <Field label="Personal interpretation (Markdown)">
              <textarea
                rows={16}
                value={draft.markdown}
                onChange={(e) => set("markdown", e.target.value)}
              />
            </Field>
            <small>
              Use $x^2$ or $$…$$ for equations, Markdown tables, and links to
              notes. Quotes are added below with source references.
            </small>
            <Field label="Add local image">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  void action.run(async () => {
                    const form = new FormData();
                    form.append("file", file);
                    const img = await request<any>("/knowledge/note-images", {
                      method: "POST",
                      body: form,
                    });
                    setDraft((v) => ({
                      ...v,
                      markdown:
                        v.markdown +
                        `\n\n![${file.name.replace(/[\]]|\[/g, "")}](${img.url})\n`,
                    }));
                  }, "Image inserted into draft. Save the note to retain the reference.");
                }}
              />
            </Field>
            <button className="button primary" disabled={action.busy}>
              Save note
            </button>
          </form>
        </section>
        <section className="review-panel">
          <h2>Live preview · interpretation</h2>
          <RichMarkdown text={draft.markdown} />
        </section>
      </div>
      <section className="review-panel">
        <h2>Quoted sources and figure/table references</h2>
        {note.references.map((r: any) => (
          <article className="k-row" key={r.passage_id}>
            <strong>
              {r.kind}: {r.label}
            </strong>
            <blockquote>
              {r.passage.quote ??
                "Area selection — inspect the original source."}
            </blockquote>
            <Source value={r.passage} />
            <button
              className="button secondary"
              onClick={() =>
                void action.run(() =>
                  send(
                    `/notes/${note.id}/references/${r.passage_id}`,
                    undefined,
                    "DELETE",
                  ),
                )
              }
            >
              Remove reference
            </button>
          </article>
        ))}
        <div className="research-filters">
          <Choice
            label="Source passage"
            value={reference}
            onChange={setReference}
            items={options.data?.passages ?? []}
          />
          <Choice
            label="Reference kind"
            value={kind}
            onChange={setKind}
            items={["quote", "figure", "table"]}
          />
          <Field label="Reference label">
            <input value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <button
            className="button secondary"
            disabled={!reference || action.busy}
            onClick={() =>
              void action.run(() =>
                send(
                  `/notes/${note.id}/references/${reference}`,
                  { kind, label },
                  "PUT",
                ),
              )
            }
          >
            Attach source reference
          </button>
        </div>
      </section>
      <section className="review-panel">
        <h2>Linked notes and backlinks</h2>
        {note.links.map((l: any) => (
          <div className="k-row" key={l.source_id + l.target_id}>
            <span>{l.direction} · </span>
            <Source value={l.note} />
            <p>{l.rationale}</p>
            {l.direction === "outgoing" && (
              <button
                className="button secondary"
                onClick={() =>
                  void action.run(() =>
                    send(
                      `/notes/${note.id}/links/${l.target_id}`,
                      undefined,
                      "DELETE",
                    ),
                  )
                }
              >
                Remove note link
              </button>
            )}
          </div>
        ))}
        <div className="research-filters">
          <Choice
            label="Related note"
            value={target}
            onChange={setTarget}
            items={(options.data?.notes ?? []).filter(
              (n: any) => n.id !== note.id,
            )}
          />
          <Field label="Note link rationale">
            <input
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
            />
          </Field>
          <button
            className="button secondary"
            disabled={!target || action.busy}
            onClick={() =>
              void action.run(() =>
                send(`/notes/${note.id}/links/${target}`, { rationale }, "PUT"),
              )
            }
          >
            Link note
          </button>
        </div>
      </section>
    </>
  );
}
