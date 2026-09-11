import { useState } from "react";
import { request } from "../api";
import {
  Choice,
  Download,
  Feedback,
  Field,
  Source,
  get,
  send,
  useAction,
  useK,
} from "./common";
import { RichMarkdown } from "./RichMarkdown";
import { ErrorNotice } from "../components/ui";
export function Arguments() {
  const [selected, setSelected] = useState(""),
    [title, setTitle] = useState(""),
    list = useK("/argument-options"),
    detail = useK("/arguments/" + selected, Boolean(selected)),
    a = useAction();
  return (
    <>
      <Feedback action={a} />
      <div className="research-filters">
        <Choice
          label="Argument outline"
          value={selected}
          onChange={setSelected}
          items={list.data?.items ?? []}
        />
        <Field label="New argument title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <button
          className="button secondary"
          disabled={!title || a.busy}
          onClick={() =>
            void a.run(async () => {
              const row = await request<any>("/arguments", {
                method: "POST",
                body: JSON.stringify({ title }),
              });
              setSelected(row.id);
              setTitle("");
            })
          }
        >
          Create argument
        </button>
      </div>
      {detail.error && <ErrorNotice error={detail.error} />}
      <p>
        Use an ordered outline to connect claims, evidence, caveats and open
        questions. Each block can reuse passages and notes.
      </p>
      {detail.data && (
        <ArgumentEditor
          key={detail.data.id + ":" + detail.data.version}
          argument={detail.data}
        />
      )}
    </>
  );
}
function ArgumentEditor({ argument }: { argument: any }) {
  const [title, setTitle] = useState(argument.title),
    [description, setDescription] = useState(argument.description),
    [blocks, setBlocks] = useState<any[]>(argument.outline),
    [markdown, setMarkdown] = useState(""),
    options = useK("/options"),
    a = useAction();
  const update = (i: number, k: string, v: any) =>
    setBlocks(blocks.map((b, n) => (n === i ? { ...b, [k]: v } : b)));
  const move = (i: number, delta: number) => {
    const copy = [...blocks];
    [copy[i], copy[i + delta]] = [copy[i + delta], copy[i]];
    setBlocks(copy);
  };
  return (
    <section className="review-panel">
      <Feedback action={a} />
      <Field label="Argument title">
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Argument description">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      {blocks.map((b, i) => (
        <article className="outline-block" key={b.id}>
          <h3>Block {i + 1}</h3>
          <Choice
            label={"Block " + (i + 1) + " kind"}
            value={b.kind}
            onChange={(v) => update(i, "kind", v)}
            items={["claim", "evidence", "caveat", "question"]}
          />
          <Field label={"Block " + (i + 1) + " text"}>
            <textarea
              value={b.text}
              onChange={(e) => update(i, "text", e.target.value)}
            />
          </Field>
          <div className="research-columns">
            <Choice
              label={"Block " + (i + 1) + " passages"}
              value={b.passageIds}
              onChange={(v) => update(i, "passageIds", v)}
              items={options.data?.passages ?? []}
              multiple
            />
            <Choice
              label={"Block " + (i + 1) + " notes"}
              value={b.noteIds}
              onChange={(v) => update(i, "noteIds", v)}
              items={options.data?.notes ?? []}
              multiple
            />
          </div>
          {b.passages?.map((p: any) => (
            <p key={p.id}>
              <Source value={p} />
            </p>
          ))}
          <div className="toolbar">
            <button
              className="button secondary"
              disabled={i === 0}
              onClick={() => move(i, -1)}
            >
              Move block up
            </button>
            <button
              className="button secondary"
              disabled={i === blocks.length - 1}
              onClick={() => move(i, 1)}
            >
              Move block down
            </button>
            <button
              className="button secondary"
              onClick={() => setBlocks(blocks.filter((x) => x.id !== b.id))}
            >
              Remove block
            </button>
          </div>
        </article>
      ))}
      <div className="toolbar">
        <button
          className="button secondary"
          disabled={blocks.length >= 100}
          onClick={() =>
            setBlocks([
              ...blocks,
              {
                id: crypto.randomUUID(),
                kind: "claim",
                text: "",
                passageIds: [],
                noteIds: [],
              },
            ])
          }
        >
          Add outline block
        </button>
        <button
          className="button primary"
          disabled={a.busy || !title}
          onClick={() =>
            void a.run(() =>
              send(
                "/arguments/" + argument.id,
                {
                  version: argument.version,
                  title,
                  description,
                  outline: blocks,
                },
                "PATCH",
              ),
            )
          }
        >
          Save outline
        </button>
        <button
          className="button secondary"
          disabled={a.busy}
          onClick={() =>
            void a.run(
              async () =>
                setMarkdown(
                  (await get("/arguments/" + argument.id + "/export")).markdown,
                ),
              "Export preview shows the saved outline.",
            )
          }
        >
          Preview saved Markdown
        </button>
      </div>
      {markdown && (
        <>
          <Download text={markdown} name="argument.md" />
          <RichMarkdown text={markdown} />
        </>
      )}
    </section>
  );
}
