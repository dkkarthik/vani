import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ImportSession, ImportItem, MetadataFields } from "@vani/shared";
import { api, request } from "../api";
import { useWorkspace } from "../context";
import { MetadataEditor } from "../components/MetadataEditor";
import { ErrorNotice, Loading, PageHeader } from "../components/ui";
export function ImportsPage() {
  const [params, setParams] = useSearchParams(),
    id = params.get("id");
  const workspace = useWorkspace(),
    client = useQueryClient();
  const [destination, setDestination] = useState(workspace.collectionId ?? ""),
    [files, setFiles] = useState<File[]>([]),
    [identifiers, setIdentifiers] = useState(""),
    [online, setOnline] = useState(false),
    [editing, setEditing] = useState<string | null>(null);
  const collections = useQuery({
    queryKey: ["collections"],
    queryFn: api.collections,
  });
  const history = useQuery({
    queryKey: ["imports"],
    queryFn: () =>
      request<{
        items: Array<{ id: string; state: string; created_at: string }>;
      }>("/imports"),
  });
  const session = useQuery({
    queryKey: ["import", id],
    queryFn: () => request<ImportSession>(`/imports/${id}`),
    enabled: Boolean(id),
    refetchInterval: (query) =>
      query.state.data?.state === "running" ? 1500 : false,
  });
  const mutation = useMutation({
    mutationFn: ({
      path = "",
      body,
      method = "POST",
    }: {
      path?: string;
      body: FormData | unknown;
      method?: string;
    }) =>
      request<ImportSession>(`/imports${path}`, {
        method,
        body: body instanceof FormData ? body : JSON.stringify(body),
      }),
    onSuccess: (data) => {
      client.setQueryData(["import", data.id], data);
      client.invalidateQueries({ queryKey: ["imports"] });
      client.invalidateQueries({ queryKey: ["library"] });
      client.invalidateQueries({ queryKey: ["collection-members"] });
      setParams({ id: data.id });
      setEditing(null);
    },
  });
  const data = session.data;
  const edit = (
    item: ImportItem,
    change: { included?: boolean; metadata?: MetadataFields },
  ) =>
    mutation.mutate({
      path: `/${id}`,
      method: "PATCH",
      body: { revision: data!.revision, items: [{ id: item.id, ...change }] },
    });
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `vani-import-${id}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="page import-page">
      <PageHeader
        eyebrow="F02 · Bulk import"
        title="Bring your research into VANI"
        description="Preview bibliography records, notes, and original PDFs before adding them to a collection."
        actions={
          id ? (
            <button
              className="button secondary"
              onClick={() => {
                setParams({});
                setFiles([]);
                setIdentifiers("");
                setOnline(false);
                setEditing(null);
                mutation.reset();
              }}
            >
              New import
            </button>
          ) : (
            <Link className="button secondary" to="/library">
              Back to library
            </Link>
          )
        }
      />
      {mutation.error && <ErrorNotice error={mutation.error} />}
      {!id && (
        <section className="review-panel">
          <form
            className="stack-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData();
              form.append("collectionId", destination);
              form.append("identifiers", identifiers);
              form.append("online", String(online));
              files.forEach((file) => form.append("files", file));
              mutation.mutate({ body: form });
            }}
          >
            <label>
              Destination collection
              <select
                required
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
              >
                <option value="">Choose a collection</option>
                {collections.data?.items.filter(collection=>collection.collectionType!=="saved_search").map((collection) => (
                  <option key={collection.id} value={collection.id}>
                    {collection.name}
                  </option>
                ))}
              </select>
            </label>
            {collections.error && <ErrorNotice error={collections.error} />}{" "}
            {collections.data?.items.length === 0 && (
              <p>
                <Link to="/collections">Create a collection</Link> before
                importing.
              </p>
            )}
            <label>
              Bibliographies and PDFs
              <input
                type="file"
                multiple
                accept=".bib,.ris,.json,.txt,.pdf"
                onChange={(event) =>
                  setFiles(Array.from(event.target.files ?? []))
                }
              />
            </label>
            <p className="muted">
              BibTeX / BibLaTeX, RIS, CSL JSON, DOI or arXiv text lists, and
              PDFs. Up to 100 files, 500 records, 200 MB total; 10 MB per
              bibliography and 50 MB per PDF.
            </p>
            <label>
              DOIs or arXiv IDs (one per line)
              <textarea
                rows={5}
                value={identifiers}
                onChange={(event) => setIdentifiers(event.target.value)}
                placeholder="10.1234/example"
              />
            </label>
            <label className="check-line">
              <input
                type="checkbox"
                checked={online}
                onChange={(event) => setOnline(event.target.checked)}
              />
              Resolve pasted/text identifiers online using Crossref, DataCite,
              and arXiv
            </label>
            <p>
              Upload referenced PDFs with the bibliography so filenames can be
              matched. External file paths are never opened. Original files and
              unmapped fields remain available in the report.
            </p>
            <button
              className="button primary"
              disabled={
                mutation.isPending || (!files.length && !identifiers.trim())
              }
            >
              {mutation.isPending ? "Preparing preview…" : "Preview import"}
            </button>
          </form>
        </section>
      )}
      {id &&
        (session.isLoading ? (
          <Loading label="Loading import report…" />
        ) : session.error ? (
          <ErrorNotice error={session.error} />
        ) : (
          data && (
            <>
              <section className="review-panel">
                <h2>
                  {data.state === "preview"
                    ? "Review before importing"
                    : "Import report"}{" "}
                  · {data.state}
                </h2>
                <p>
                  Destination:{" "}
                  {collections.data?.items.find(
                    (collection) => collection.id === data.collectionId,
                  )?.name ?? data.collectionId}{" "}
                  · {data.files.length} input files · {data.items.length}{" "}
                  records
                </p>
                <p>
                  {
                    data.items.filter((item) => item.status === "created")
                      .length
                  }{" "}
                  created ·{" "}
                  {data.items.filter((item) => item.status === "reused").length}{" "}
                  reused ·{" "}
                  {data.items.filter((item) => item.status === "failed").length}{" "}
                  failed · {data.items.filter((item) => !item.included).length}{" "}
                  excluded · {data.items.filter((item) => item.included).length}{" "}
                  selected
                </p>
                <ul className="review-warnings">
                  {data.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
                <div className="toolbar">
                  {data.state !== "complete" && (
                    <button
                      className="button primary"
                      disabled={
                        mutation.isPending ||
                        !data.items.some((item) => item.included)
                      }
                      onClick={() =>
                        mutation.mutate({
                          path: `/${id}/commit`,
                          body: { revision: data.revision },
                        })
                      }
                    >
                      {mutation.isPending
                        ? "Importing…"
                        : data.state === "preview"
                          ? "Confirm selected records"
                          : data.state === "running"
                            ? "Resume interrupted import"
                            : "Retry failed records"}
                    </button>
                  )}
                  <button
                    className="button secondary"
                    onClick={() => session.refetch()}
                  >
                    Refresh report
                  </button>
                  <button className="button secondary" onClick={download}>
                    Download report
                  </button>
                </div>
                {data.state === "running" && (
                  <p role="status">
                    Progress is saved after each record. You can return to this
                    report or resume an interrupted run.
                  </p>
                )}
              </section>
              <div className="import-records">
                {data.items.map((item) => (
                  <article className="review-panel" key={item.id}>
                    <div className="import-record-heading">
                      <label className="check-line">
                        <input
                          type="checkbox"
                          aria-label={`Include record ${item.ordinal + 1}`}
                          checked={item.included}
                          disabled={
                            data.state !== "preview" ||
                            mutation.isPending ||
                            Boolean(item.error)
                          }
                          onChange={(event) =>
                            edit(item, { included: event.target.checked })
                          }
                        />
                        <strong>
                          {item.ordinal + 1}.{" "}
                          {item.metadata?.title || item.label}
                        </strong>
                      </label>
                      <span>
                        {item.status === "pending"
                          ? item.matchId
                            ? "Reuse existing"
                            : "New record"
                          : item.status}
                      </span>
                    </div>
                    <p>
                      {item.metadata?.authors
                        .map((author) =>
                          `${author.given} ${author.family}`.trim(),
                        )
                        .join("; ")}{" "}
                      {item.metadata?.year && ` · ${item.metadata.year}`}{" "}
                      {item.metadata?.doi && ` · ${item.metadata.doi}`}
                    </p>
                    {item.error && (
                      <ErrorNotice error={new Error(item.error)} />
                    )}
                    {item.matchId && (
                      <p>
                        Matches{" "}
                        <Link to={`/read/${item.matchId}`}>
                          {item.matchTitle}
                        </Link>
                        . Existing metadata and citation key will be preserved.
                      </p>
                    )}
                    {item.workId && (
                      <Link to={`/works/${item.workId}/metadata`}>
                        Review imported paper metadata
                      </Link>
                    )}
                    {item.attachments.length > 0 && (
                      <p>
                        Attached PDFs:{" "}
                        {item.attachments.map((file) => file.name).join(", ")}
                      </p>
                    )}
                    {item.warnings.length > 0 && (
                      <ul className="review-warnings">
                        {item.warnings.map((warning, index) => (
                          <li key={index}>{warning}</li>
                        ))}
                      </ul>
                    )}
                    <p>{item.notes.length} plain text note(s)</p>
                    {data.state === "preview" && item.metadata && (
                      <button
                        className="button secondary"
                        disabled={mutation.isPending}
                        onClick={() =>
                          setEditing(editing === item.id ? null : item.id)
                        }
                      >
                        {editing === item.id ? "Close editor" : "Edit record"}
                      </button>
                    )}
                    {editing === item.id && item.metadata && (
                      <MetadataEditor
                        key={`${item.id}:${data.revision}`}
                        initial={item.metadata}
                        pending={mutation.isPending}
                        onSave={(metadata) => edit(item, { metadata })}
                      />
                    )}
                    <details>
                      <summary>Original record and notes</summary>
                      <pre>
                        {JSON.stringify(
                          {
                            source: item.source,
                            raw: item.raw,
                            notes: item.notes,
                          },
                          null,
                          2,
                        )}
                      </pre>
                    </details>
                  </article>
                ))}
              </div>
              <section className="review-panel">
                <h2>Original files</h2>
                {data.files.map((file) => (
                  <p key={file.id}>
                    <a href={`/api/v1/imports/${id}/files/${file.id}`}>
                      {file.name}
                    </a>{" "}
                    · {file.size.toLocaleString()} bytes{" "}
                    <code>{file.hash}</code>
                  </p>
                ))}
              </section>
            </>
          )
        ))}
      <section className="review-panel">
        <h2>Recent imports</h2>
        {history.error && <ErrorNotice error={history.error} />}{" "}
        {!history.data?.items.length && <p>No saved import sessions yet.</p>}
        {history.data?.items.map((item) => (
          <p key={item.id}>
            <Link to={`/imports?id=${item.id}`}>
              {new Date(item.created_at).toLocaleString()} · {item.state}
            </Link>
          </p>
        ))}
      </section>
    </div>
  );
}
