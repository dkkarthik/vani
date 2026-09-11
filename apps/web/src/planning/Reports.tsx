import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Choice,
  Field,
  Feedback,
  Json,
  Source,
  send,
  useAction,
  useK,
} from "../knowledge/common";
import { ErrorNotice, Loading } from "../components/ui";
export function Reports({
  initialKind = "first-pass",
}: { initialKind?: string } = {}) {
  const [id, setId] = useState(""),
    [kind, setKind] = useState(initialKind),
    [works, setWorks] = useState<string[]>([]),
    [notes, setNotes] = useState<string[]>([]),
    [args, setArgs] = useState<string[]>([]),
    [passages, setPassages] = useState<string[]>([]),
    [target, setTarget] = useState(""),
    [question, setQuestion] = useState(""),
    [model, setModel] = useState(false),
    options = useK("/options"),
    argumentsList = useK("/argument-options"),
    list = useK("/insights"),
    detail = useK("/insights/" + id, Boolean(id)),
    a = useAction();
  return (
    <>
      <Feedback action={a} />
      <section className="review-panel">
        <Choice
          label="Saved report"
          value={id}
          onChange={setId}
          items={list.data?.items ?? []}
        />
        <Choice
          label="Report workflow"
          value={kind}
          onChange={setKind}
          items={["first-pass", "ask", "inspection", "addition"]}
        />
        {["first-pass", "addition"].includes(kind) && (
          <Choice
            label="Target paper"
            value={target}
            onChange={setTarget}
            items={options.data?.works ?? []}
          />
        )}{" "}
        {["ask", "addition"].includes(kind) && (
          <>
            <Choice
              label={
                kind === "ask"
                  ? "Explicit answer corpus"
                  : "Existing baseline papers"
              }
              value={works}
              onChange={setWorks}
              items={options.data?.works ?? []}
              multiple
            />
            <Choice
              label="Selected context notes"
              value={notes}
              onChange={setNotes}
              items={options.data?.notes ?? []}
              multiple
            />
          </>
        )}
        {kind === "addition" && (
          <Choice
            label="Selected context arguments"
            value={args}
            onChange={setArgs}
            items={argumentsList.data?.items ?? []}
            multiple
          />
        )}
        {kind === "inspection" && (
          <Choice
            label="Two passages to inspect"
            value={passages}
            onChange={setPassages}
            items={options.data?.passages ?? []}
            multiple
          />
        )}
        {kind === "ask" && (
          <Field label="Question for selected corpus">
            <textarea
              aria-label="Question for selected corpus"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </Field>
        )}
        {["first-pass", "ask"].includes(kind) && (
          <label className="check-line">
            <input
              type="checkbox"
              checked={model}
              onChange={(e) => setModel(e.target.checked)}
            />
            Use configured local model; keep all evidence local
          </label>
        )}
        <p>
          Source snapshots are bounded. Extractive mode retrieves quoted
          evidence; it does not pretend to perform full synthesis or verify
          correctness.
        </p>
        <button
          className="button primary"
          disabled={a.busy}
          onClick={() =>
            void a.run(async () => {
              const payload =
                kind === "first-pass"
                  ? { workId: target, useModel: model }
                  : kind === "ask"
                    ? {
                        workIds: works,
                        noteIds: notes,
                        question,
                        useModel: model,
                      }
                    : kind === "inspection"
                      ? { passageIds: passages }
                      : {
                          workId: target,
                          baselineIds: works,
                          noteIds: notes,
                          argumentIds: args,
                        };
              const r = await send("/insights/" + kind, payload);
              setId(r.id);
            }, "Report saved with its evidence snapshot.")
          }
        >
          Create source-backed report
        </button>
      </section>
      {detail.error && <ErrorNotice error={detail.error} />}{" "}
      {detail.data && (
        <ReportEditor
          key={detail.data.id + ":" + detail.data.version}
          row={detail.data}
        />
      )}
    </>
  );
}
function ReportEditor({ row }: { row: any }) {
  const [title, setTitle] = useState(row.title),
    [sections, setSections] = useState<any[]>(row.sections),
    [judgment, setJudgment] = useState(row.context.judgment ?? "unresolved"),
    [confirm, setConfirm] = useState(false),
    a = useAction();
  const update = (i: number, key: string, value: any) =>
    setSections(sections.map((s, n) => (n === i ? { ...s, [key]: value } : s)));
  return (
    <section className="review-panel">
      <Feedback action={a} />
      <Field label="Report title">
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <p>
        {row.kind} · {row.provider} · revision {row.version} ·{" "}
        {row.confirmed
          ? "User-confirmed judgment"
          : "Unconfirmed interpretation"}
      </p>
      <details open>
        <summary>Actual source coverage</summary>
        <Json value={row.coverage} />
      </details>
      {sections.map((s, i) => (
        <article className="outline-block" key={s.id}>
          <h3>{s.label}</h3>
          <Choice
            label={`Section ${i + 1} type`}
            value={s.kind}
            onChange={(v) => update(i, "kind", v)}
            items={[
              "quotation",
              "synthesis",
              "inference",
              "interpretation",
              "unavailable",
            ]}
          />
          <Field label={`Section ${i + 1} text`}>
            <textarea
              aria-label={`Section ${i + 1} text`}
              rows={4}
              value={s.text}
              onChange={(e) => update(i, "text", e.target.value)}
            />
          </Field>
          <small>
            Quotation text must equal a cited quote. Use interpretation for your
            own wording; keep source excerpts attached.
          </small>
          {s.citations.map((c: any, j: number) => {
            const source = row.sources.find((x: any) => x.id === c.sourceId);
            return (
              <blockquote key={j}>
                {c.quote}
                <br />
                <Link to={`/insights/${row.id}/sources/${c.sourceId}`}>
                  {source?.label ?? "Unavailable source"}
                </Link>
              </blockquote>
            );
          })}
        </article>
      ))}
      {row.kind === "inspection" && (
        <>
          <Choice
            label="Inspection judgment"
            value={judgment}
            onChange={setJudgment}
            items={[
              "unresolved",
              "supports",
              "challenges",
              "mixed",
              "incomparable",
            ]}
          />
          <label className="check-line">
            <input
              type="checkbox"
              checked={confirm}
              onChange={(e) => setConfirm(e.target.checked)}
            />
            I inspected the two sources and confirm this judgment
          </label>
          <p>
            Fill “Judgment rationale” before confirming. Saving an edit without
            confirmation clears the previous confirmation.
          </p>
        </>
      )}
      <button
        className="button primary"
        disabled={a.busy}
        onClick={() =>
          void a.run(() =>
            send(
              "/insights/" + row.id,
              {
                version: row.version,
                title,
                sections,
                ...(row.kind === "inspection" ? { judgment, confirm } : {}),
              },
              "PATCH",
            ),
          )
        }
      >
        Save report edits
      </button>
      <h3>Source snapshot</h3>
      {row.sources.map((s: any) => (
        <p key={s.id}>
          <Link to={`/insights/${row.id}/sources/${s.id}`}>{s.label}</Link> ·{" "}
          {s.kind}
        </p>
      ))}
      <details>
        <summary>Interpretation context and revision history</summary>
        <Json value={{ context: row.context, history: row.history }} />
      </details>
    </section>
  );
}
export function InsightSourcePage() {
  const { id, sourceId } = useParams(),
    data = useK(`/insights/${id}/sources/${sourceId}`);
  if (data.error) return <ErrorNotice error={data.error} />;
  if (!data.data) return <Loading />;
  const d = data.data;
  return (
    <div className="page knowledge-page">
      <h1>{d.source.label}</h1>
      <p>
        Recorded {new Date(d.recordedAt).toLocaleString()} · {d.status}
      </p>
      <blockquote>{d.source.text}</blockquote>
      <Source
        value={{ label: "Open original source location", url: d.source.url }}
      />
      <p>
        Snapshot text is retained even if the current source changes. Inspect
        the original to check its present state.
      </p>
      {d.source.hash && <p>Document SHA-256: {d.source.hash}</p>}
    </div>
  );
}

export function GroundedQuestionsPage() {
  return (
    <div className="page knowledge-page">
      <h1>Ask the selected evidence</h1>
      <p>
        Select the exact paper corpus and notes. Citations refer to stored
        source snapshots.
      </p>
      <Reports initialKind="ask" />
    </div>
  );
}
