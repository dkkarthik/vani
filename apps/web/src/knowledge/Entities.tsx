import { useSearchParams } from "react-router-dom";
import { useState } from "react";
import { EntityType } from "@vani/shared";
import { Choice, Feedback, Field, Json, send, useAction, useK } from "./common";
import { ErrorNotice } from "../components/ui";
export function Entities() {
  const [params] = useSearchParams();
  const list = useK("/entities"),
    suggest = useK("/entities/suggest"),
    edges = useK("/edges"),
    a = useAction(),
    [edit, setEdit] = useState<any>(null),
    [sourceId, setSource] = useState(params.get("entity") ?? ""),
    [targetId, setTarget] = useState(""),
    [merge, setMerge] = useState<any>(null),
    [split, setSplit] = useState<any>(null),
    [splitName, setSplitName] = useState(""),
    [aliases, setAliases] = useState<string[]>([]),
    [edgeIds, setEdges] = useState<string[]>([]);
  const active = list.data?.items.filter((e: any) => !e.merged_into) ?? [],
    source = active.find((e: any) => e.id === sourceId);
  const candidates =
    edges.data?.items
      .filter(
        (e: any) =>
          (e.source.kind === "entity" && e.source.id === sourceId) ||
          (e.target.kind === "entity" && e.target.id === sourceId),
      )
      .map((e: any) => ({
        id: e.id,
        label: `${e.source.label} → ${e.predicate} → ${e.target.label}`,
      })) ?? [];
  const splitInput = { entityId: sourceId, name: splitName, aliases, edgeIds };
  return (
    <>
      <Feedback action={a} />
      {list.error && <ErrorNotice error={list.error} />}
      <EntityEditor
        key={edit?.id ?? edit?.name ?? "new"}
        entity={edit}
        done={() => setEdit(null)}
      />
      <section className="review-panel">
        <h2>Entities and aliases</h2>
        <p>
          Concepts, methods, datasets, tasks and authors are user-curated.
          Author names alone do not establish identity. Showing up to 1,000
          records.
        </p>
        {list.data?.items.map((e: any) => (
          <article
            className="k-row"
            style={e.id === sourceId ? { background: "#eef6f0" } : undefined}
            key={e.id}
          >
            <strong>{e.name}</strong> · {e.entity_type}
            <p>
              {e.aliases.join(", ") || "No aliases"}{" "}
              {e.merged_into &&
                " · merged into " +
                  list.data.items.find((t: any) => t.id === e.merged_into)
                    ?.name}
            </p>
            {!e.merged_into && (
              <button className="button secondary" onClick={() => setEdit(e)}>
                Edit entity
              </button>
            )}
          </article>
        ))}
      </section>
      <section className="review-panel">
        <h2>Resolve entity identity</h2>
        <Choice
          label="Entity to merge or split"
          value={sourceId}
          onChange={(v) => {
            setSource(v);
            setAliases([]);
            setEdges([]);
            setMerge(null);
            setSplit(null);
          }}
          items={active}
        />
        <div className="research-columns">
          <div>
            <h3>Merge aliases into another entity</h3>
            <Choice
              label="Merge target entity"
              value={targetId}
              onChange={(v) => {
                setTarget(v);
                setMerge(null);
              }}
              items={active.filter((e: any) => e.id !== sourceId)}
            />
            <button
              className="button secondary"
              disabled={!sourceId || !targetId || a.busy}
              onClick={() =>
                void a.run(
                  async () =>
                    setMerge(
                      await send("/entities/merge-preview", {
                        sourceId,
                        targetId,
                      }),
                    ),
                  "Review the merge preview below.",
                )
              }
            >
              Preview entity merge
            </button>
            {merge && (
              <>
                <p>
                  {merge.source.name} becomes an alias of {merge.target.name}.{" "}
                  {merge.edges.length} incident connections are audited.{" "}
                  {merge.collapsedEdgeIds.length} connections between the merged
                  entities are retired to avoid self-links.
                </p>
                <details>
                  <summary>Review affected records</summary>
                  <Json value={merge} />
                </details>
                <button
                  className="button primary"
                  disabled={a.busy}
                  onClick={() =>
                    void a.run(async () => {
                      await send("/entities/merge", {
                        sourceId,
                        targetId,
                        previewHash: merge.previewHash,
                      });
                      setMerge(null);
                      setSource("");
                    })
                  }
                >
                  Apply entity merge
                </button>
              </>
            )}
          </div>
          <div>
            <h3>Split a mistaken match</h3>
            <Field label="Split entity name">
              <input
                value={splitName}
                onChange={(e) => {
                  setSplitName(e.target.value);
                  setSplit(null);
                }}
              />
            </Field>
            <Choice
              label="Aliases to move"
              value={aliases}
              onChange={(v) => {
                setAliases(v);
                setSplit(null);
              }}
              items={source?.aliases ?? []}
              multiple
            />
            <Choice
              label="Connections to move"
              value={edgeIds}
              onChange={(v) => {
                setEdges(v);
                setSplit(null);
              }}
              items={candidates}
              multiple
            />
            <button
              className="button secondary"
              disabled={!sourceId || !splitName || a.busy}
              onClick={() =>
                void a.run(
                  async () =>
                    setSplit(await send("/entities/split-preview", splitInput)),
                  "Review the split preview below.",
                )
              }
            >
              Preview entity split
            </button>
            {split && (
              <>
                <p>
                  Create {splitName}, move {aliases.length} aliases and{" "}
                  {edgeIds.length} connections. Other connections stay with{" "}
                  {source?.name}.
                </p>
                <details>
                  <summary>Review split records</summary>
                  <Json value={split} />
                </details>
                <button
                  className="button primary"
                  disabled={a.busy}
                  onClick={() =>
                    void a.run(async () => {
                      await send("/entities/split", {
                        ...splitInput,
                        previewHash: split.previewHash,
                      });
                      setSplit(null);
                      setAliases([]);
                      setEdges([]);
                    })
                  }
                >
                  Apply entity split
                </button>
              </>
            )}
          </div>
        </div>
      </section>
      <section className="review-panel">
        <h2>Entity candidates</h2>
        <p>
          Derived from stored tags and authors in up to 500 recent papers; first
          100 candidates. Review the type before creating an entity.
        </p>
        {suggest.data?.items.map((s: any) => (
          <article className="k-row" key={s.fingerprint}>
            <strong>{s.name}</strong> · {s.entityType}
            <p>
              {s.derivation} · {s.title}
            </p>
            <div className="toolbar">
              <button
                className="button secondary"
                onClick={() =>
                  setEdit({
                    name: s.name,
                    entity_type: s.entityType,
                    aliases: [],
                  })
                }
              >
                Review candidate
              </button>
              <button
                className="button secondary"
                disabled={a.busy}
                onClick={() =>
                  void a.run(() =>
                    send("/entities/dismiss", { fingerprint: s.fingerprint }),
                  )
                }
              >
                Dismiss candidate
              </button>
            </div>
          </article>
        ))}
      </section>
      <details className="review-panel">
        <summary>Identity audit history (latest 50)</summary>
        <Json value={list.data?.audit} />
      </details>
    </>
  );
}
function EntityEditor({ entity, done }: { entity: any; done: () => void }) {
  const [name, setName] = useState(entity?.name ?? ""),
    [type, setType] = useState(entity?.entity_type ?? "concept"),
    [aliases, setAliases] = useState(entity?.aliases.join("\n") ?? ""),
    a = useAction();
  return (
    <section className="review-panel">
      <h2>{entity?.id ? "Edit entity" : "Create entity"}</h2>
      <Feedback action={a} />
      <form
        className="stack-form"
        onSubmit={(e) => {
          e.preventDefault();
          void a.run(async () => {
            await send(
              "/entities" + (entity?.id ? "/" + entity.id : ""),
              {
                name,
                entityType: type,
                aliases: aliases
                  .split("\n")
                  .map((s: string) => s.trim())
                  .filter(Boolean),
                ...(entity?.id ? { version: entity.version } : {}),
              },
              entity?.id ? "PATCH" : "POST",
            );
            setName("");
            setAliases("");
            done();
          });
        }}
      >
        <Field label="Entity name">
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Choice
          label="Entity type"
          value={type}
          onChange={setType}
          items={EntityType.options}
        />
        <Field label="Aliases (one per line)">
          <textarea
            value={aliases}
            onChange={(e) => setAliases(e.target.value)}
          />
        </Field>
        <button className="button primary" disabled={a.busy}>
          Save entity
        </button>
        {entity && (
          <button className="button secondary" type="button" onClick={done}>
            Cancel entity editing
          </button>
        )}
      </form>
    </section>
  );
}
