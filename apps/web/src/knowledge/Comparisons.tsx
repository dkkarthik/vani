import { useState } from "react";
import { ComparisonColumn } from "@vani/shared";
import {
  Choice,
  Download,
  Feedback,
  Field,
  Json,
  get,
  send,
  useAction,
  useK,
} from "./common";
import { ErrorNotice } from "../components/ui";
export function Comparisons() {
  const [selected, setSelected] = useState(""),
    [title, setTitle] = useState(""),
    [works, setWorks] = useState<string[]>([]),
    list = useK("/comparisons"),
    options = useK("/options"),
    detail = useK("/comparisons/" + selected, Boolean(selected)),
    a = useAction();
  return (
    <>
      <Feedback action={a} />
      <section className="review-panel">
        <h2>Compare source evidence</h2>
        <Choice
          label="Existing comparison"
          value={selected}
          onChange={setSelected}
          items={list.data?.items ?? []}
        />
        <div className="research-columns">
          <Field label="New comparison title">
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Choice
            label="Papers to compare"
            value={works}
            onChange={setWorks}
            items={options.data?.works ?? []}
            multiple
          />
        </div>
        <button
          className="button primary"
          disabled={!title || !works.length || works.length > 20 || a.busy}
          onClick={() =>
            void a.run(async () => {
              const c = await send("/comparisons", { title, workIds: works });
              setSelected(c.id);
            })
          }
        >
          Create comparison
        </button>
      </section>
      {detail.error && <ErrorNotice error={detail.error} />}{" "}
      {detail.data && (
        <Matrix
          key={detail.data.id + ":" + detail.data.version}
          table={detail.data}
        />
      )}
    </>
  );
}
function Matrix({ table }: { table: any }) {
  const [edit, setEdit] = useState<any>(null),
    [markdown, setMarkdown] = useState(""),
    a = useAction();
  return (
    <section className="review-panel">
      <h2>{table.title}</h2>
      <p>
        Every nonempty finding needs a source. Unrecorded means the evidence has
        not been entered.
      </p>
      <Feedback action={a} />
      <div className="review-table-wrap">
        <table className="review-table comparison-matrix">
          <thead>
            <tr>
              <th>Paper</th>
              {ComparisonColumn.options.map((c) => (
                <th key={c}>{c.replaceAll("_", " ")}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.work_ids.map((id: string, i: number) => (
              <tr key={id}>
                <th>
                  <a href={"/read/" + id}>{table.works[i].label}</a>
                </th>
                {ComparisonColumn.options.map((col) => {
                  const cell = table.cells.find(
                    (c: any) => c.work_id === id && c.column_name === col,
                  );
                  return (
                    <td key={col}>
                      <button
                        className="cell-button"
                        aria-label={`Edit ${col} for ${table.works[i].label}`}
                        onClick={() =>
                          setEdit({ workId: id, column: col, ...cell })
                        }
                      >
                        {cell?.text || "Unrecorded"}
                      </button>
                      {cell?.source && (
                        <p>
                          <a
                            href={
                              cell.source.kind === "passage"
                                ? "/passages/" + cell.source.passageId
                                : "/read/" + id
                            }
                          >
                            {cell.source.kind === "passage"
                              ? `Passage · p. ${cell.source.page}`
                              : "Abstract quotation"}
                          </a>
                        </p>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <CellEditor
          key={edit.workId + edit.column}
          tableId={table.id}
          cell={edit}
          done={() => setEdit(null)}
        />
      )}
      <button
        className="button secondary"
        onClick={() =>
          void a.run(
            async () =>
              setMarkdown(
                (await get("/comparisons/" + table.id + "/export")).markdown,
              ),
            "Saved comparison export ready.",
          )
        }
      >
        Export comparison
      </button>
      {markdown && (
        <>
          <Download text={markdown} name="comparison.md" />
          <pre>{markdown}</pre>
        </>
      )}
    </section>
  );
}
function CellEditor({
  tableId,
  cell,
  done,
}: {
  tableId: string;
  cell: any;
  done: () => void;
}) {
  const [text, setText] = useState(cell.text ?? ""),
    [kind, setKind] = useState(cell.source?.kind ?? "passage"),
    [passageId, setPassage] = useState(cell.source?.passageId ?? ""),
    [quote, setQuote] = useState(cell.source?.quote ?? ""),
    options = useK("/options"),
    a = useAction();
  return (
    <section className="outline-block">
      <h3>Edit {cell.column.replaceAll("_", " ")}</h3>
      <Feedback action={a} />
      <Field label="Comparison finding">
        <textarea value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <Choice
        label="Cell source kind"
        value={kind}
        onChange={setKind}
        items={["passage", "abstract"]}
      />
      {kind === "passage" ? (
        <Choice
          label="Cell supporting passage"
          value={passageId}
          onChange={setPassage}
          items={options.data?.passages ?? []}
        />
      ) : (
        <Field label="Exact abstract quotation">
          <textarea value={quote} onChange={(e) => setQuote(e.target.value)} />
        </Field>
      )}
      <p>
        The source must belong to this row’s paper. Clear the finding to restore
        an unrecorded cell.
      </p>
      <div className="toolbar">
        <button
          className="button primary"
          disabled={a.busy}
          onClick={() =>
            void a.run(async () => {
              await send(
                `/comparisons/${tableId}/cells`,
                {
                  workId: cell.workId,
                  column: cell.column,
                  text,
                  version: cell.version ?? 0,
                  source: !text.trim()
                    ? null
                    : kind === "passage"
                      ? { kind, passageId }
                      : { kind, quote },
                },
                "PUT",
              );
              done();
            })
          }
        >
          Save sourced cell
        </button>
        <button className="button secondary" onClick={done}>
          Cancel cell edit
        </button>
      </div>
      <details>
        <summary>Previous cell revisions</summary>
        <Json value={cell.history ?? []} />
      </details>
    </section>
  );
}
