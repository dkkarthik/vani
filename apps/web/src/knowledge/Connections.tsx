import { useState } from "react";
import { Predicate } from "@vani/shared";
import {
  Choice,
  Feedback,
  Field,
  Json,
  RefPicker,
  Source,
  send,
  useAction,
  useK,
} from "./common";
import { ErrorNotice } from "../components/ui";
export function Connections() {
  const options = useK("/options"),
    edges = useK("/edges"),
    [edit, setEdit] = useState<any>(null);
  return (
    <>
      {edges.error && <ErrorNotice error={edges.error} />}
      <EdgeEditor
        key={edit?.id ?? "new"}
        initial={edit}
        options={options.data}
        done={() => setEdit(null)}
      />
      <h2>Authored and reviewed connections</h2>
      <p>
        Showing up to 1,000 relationships. User rationale is an interpretation.
      </p>
      {edges.data?.items.map((e: any) => (
        <article className="review-panel" key={e.id}>
          <p>
            <Source value={e.source} /> →{" "}
            <strong>{e.predicate.replaceAll("_", " ")}</strong> →{" "}
            <Source value={e.target} />
          </p>
          <p>{e.rationale}</p>
          <small>
            Origin: {e.origin} · revision {e.version}
          </small>
          {e.passages.map((p: any) => (
            <blockquote key={p.id}>
              {p.quote}
              <br />
              <Source value={p} />
            </blockquote>
          ))}
          <details>
            <summary>Derivation</summary>
            <Json value={e.provenance} />
          </details>
          <button className="button secondary" onClick={() => setEdit(e)}>
            Edit connection
          </button>
        </article>
      ))}
    </>
  );
}
function EdgeEditor({
  initial,
  options,
  done,
}: {
  initial: any;
  options: any;
  done: () => void;
}) {
  const [d, setD] = useState(
      initial
        ? {
            source: { kind: initial.source.kind, id: initial.source.id },
            target: { kind: initial.target.kind, id: initial.target.id },
            predicate: initial.predicate,
            rationale: initial.rationale,
            passageIds: initial.passage_ids,
            version: initial.version,
          }
        : {
            source: { kind: "work", id: "" },
            target: { kind: "entity", id: "" },
            predicate: "relates_to",
            rationale: "",
            passageIds: [],
          },
    ),
    a = useAction();
  const set = (k: string, v: any) => setD({ ...d, [k]: v });
  return (
    <section className="review-panel">
      <h2>{initial ? "Edit relationship" : "Connect research objects"}</h2>
      <Feedback action={a} />
      <form
        className="stack-form"
        onSubmit={(e) => {
          e.preventDefault();
          void a.run(async () => {
            await send(
              "/edges" + (initial ? "/" + initial.id : ""),
              d,
              initial ? "PATCH" : "POST",
            );
            done();
          });
        }}
      >
        <div className="research-columns">
          <RefPicker
            label="Source object"
            value={d.source}
            onChange={(v) => set("source", v)}
            options={options}
          />
          <RefPicker
            label="Target object"
            value={d.target}
            onChange={(v) => set("target", v)}
            options={options}
          />
        </div>
        <Choice
          label="Relationship"
          value={d.predicate}
          onChange={(v) => set("predicate", v)}
          items={Predicate.options}
        />
        <Field label="Relationship rationale">
          <textarea
            required
            value={d.rationale}
            onChange={(e) => set("rationale", e.target.value)}
          />
        </Field>
        <Choice
          label="Supporting passages"
          value={d.passageIds}
          onChange={(v) => set("passageIds", v)}
          items={options?.passages ?? []}
          multiple
        />
        <button
          className="button primary"
          disabled={a.busy || !d.source.id || !d.target.id}
        >
          Save connection
        </button>
        {initial && (
          <div className="toolbar">
            <button type="button" className="button secondary" onClick={done}>
              Cancel editing
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={a.busy}
              onClick={() =>
                void a.run(async () => {
                  await send(
                    "/edges/" + initial.id,
                    { version: initial.version },
                    "DELETE",
                  );
                  done();
                })
              }
            >
              Remove connection
            </button>
          </div>
        )}
      </form>
    </section>
  );
}
export function Suggestions() {
  const options = useK("/options"),
    list = useK("/suggestions"),
    [works, setWorks] = useState<string[]>([]),
    a = useAction(),
    [coverage, setCoverage] = useState("");
  return (
    <>
      <Feedback action={a} />
      <section className="review-panel">
        <h2>Find explicit relationship cues</h2>
        <p>
          Rules look for use, extension and comparison phrases near curated
          entity names in abstracts and indexed pages. Review context before
          accepting; confidence is a heuristic.
        </p>
        <Choice
          label="Papers to inspect"
          value={works}
          onChange={setWorks}
          items={options.data?.works ?? []}
          multiple
        />
        <button
          className="button primary"
          disabled={!works.length || works.length > 50 || a.busy}
          onClick={() =>
            void a.run(async () => {
              const result = await send("/suggestions/generate", {
                workIds: works,
              });
              setCoverage(result.coverage);
            }, "Suggestion generation finished.")
          }
        >
          Generate suggestions
        </button>
        <p>{coverage}</p>
      </section>
      {list.error && <ErrorNotice error={list.error} />}
      <p>
        Latest 500 suggestions; review decisions persist across repeated runs.
      </p>
      {list.data?.items.map((s: any) => (
        <article className="review-panel" key={s.id}>
          <p>
            <Source value={s.source} /> →{" "}
            <strong>{s.predicate.replaceAll("_", " ")}</strong> →{" "}
            <Source value={s.target} />
          </p>
          <blockquote>{s.evidence.quote}</blockquote>
          <p>
            {s.evidence.kind === "pdf"
              ? `PDF page ${s.evidence.page}`
              : "Abstract only"}{" "}
            · {s.evidence.rule} · heuristic {s.confidence} · {s.state}
          </p>
          <Source
            value={{
              ...s.source,
              url: s.evidence.attachmentId
                ? `/read/${s.source.id}?attachment=${s.evidence.attachmentId}&page=${s.evidence.page}`
                : s.source.url,
              label: "Inspect source context",
            }}
          />
          <details>
            <summary>Full derivation</summary>
            <Json value={s.evidence} />
          </details>
          {s.state === "pending" && (
            <div className="toolbar">
              <button
                className="button primary"
                disabled={a.busy}
                onClick={() =>
                  void a.run(() =>
                    send(`/suggestions/${s.id}/review`, {
                      decision: "accepted",
                    }),
                  )
                }
              >
                Accept suggestion
              </button>
              <button
                className="button secondary"
                disabled={a.busy}
                onClick={() =>
                  void a.run(() =>
                    send(`/suggestions/${s.id}/review`, {
                      decision: "rejected",
                    }),
                  )
                }
              >
                Reject suggestion
              </button>
            </div>
          )}
        </article>
      ))}
    </>
  );
}
