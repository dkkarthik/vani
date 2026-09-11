import { lazy, Suspense, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, request } from "../api";
import { useWorkspace } from "../context";
import { ErrorNotice, Loading, PageHeader } from "../components/ui";
const PdfReader = lazy(() =>
  import("../components/PdfReader").then((module) => ({
    default: module.PdfReader,
  })),
);
import { CaptureSources } from "../components/CaptureSources";
export function ReaderPage() {
  const { workId, passageId } = useParams(),
    [params] = useSearchParams(),
    workspace = useWorkspace(),
    client = useQueryClient();
  const [chosen, setChosen] = useState(""),
    [note, setNote] = useState("");
  const anchor = useQuery({
    queryKey: ["passage", passageId],
    queryFn: () => request<any>("/passages/" + passageId),
    enabled: Boolean(passageId),
  });
  const id = anchor.data?.work_id ?? workId ?? workspace.selected[0]?.id;
  const work = useQuery({
    queryKey: ["work", id],
    queryFn: () => api.work(id!),
    enabled: Boolean(id),
  });
  const attachments = useQuery({
    queryKey: ["attachments", id],
    queryFn: () => request<any>(`/works/${id}/attachments`),
    enabled: Boolean(id),
  });
  const notes = useQuery({
    queryKey: ["notes", id],
    queryFn: () => api.notes(undefined, id),
    enabled: Boolean(id),
  });
  const graph = useQuery({
    queryKey: ["reader-relations", id],
    queryFn: () => api.graph(undefined, id),
    enabled: Boolean(id),
  });
  const versions = useQuery({
    queryKey: ["versions", id],
    queryFn: () => request<any>(`/works/${id}/versions`),
    enabled: Boolean(id),
  });
  const mutation = useMutation({
    mutationFn: ({ file }: { file?: File }) =>
      file
        ? api.uploadPdf(id!, file)
        : api.createNote({
            title: `Reading notes — ${work.data?.citationKey}`,
            markdown: note,
            workId: id,
          }),
    onSuccess: () => {
      client.invalidateQueries();
      setNote("");
    },
  });
  if (anchor.error)
    return (
      <div className="page">
        <ErrorNotice error={anchor.error} />
        <Link to="/library">Back to library</Link>
      </div>
    );
  if ((passageId && anchor.isLoading) || work.isLoading) return <Loading />;
  if (!id)
    return (
      <div className="page">
        <PageHeader
          title="Read"
          description="Choose a paper in your library."
        />
        <Link to="/library">Open library</Link>
      </div>
    );
  const error = work.error || attachments.error || mutation.error;
  const attachmentId =
    anchor.data?.attachment_id ||
    chosen ||
    params.get("attachment") ||
    attachments.data?.items[0]?.id;
  const validAttachment = attachments.data?.items.find(
    (a: any) => a.id === attachmentId,
  );
  return (
    <div className="page reader-workspace">
      <PageHeader
        eyebrow="F07–F08 · Source reading"
        title={work.data?.title ?? "Read"}
        description={work.data?.citationKey}
        actions={
          <Link
            className="button secondary"
            to={`/works/${work.data?.id ?? id}/metadata`}
          >
            Review metadata
          </Link>
        }
      />
      {error && <ErrorNotice error={error} />}
      {versions.data?.items.map((v: any) => (
        <p
          className={
            v.relation === "retracts" ? "error-notice" : "version-notice"
          }
          key={v.id}
        >
          <span>
            User-recorded relationship:{" "}
            <Link to={`/read/${v.source_id}`}>{v.source_title}</Link>{" "}
            <strong>{v.relation}</strong>{" "}
            <Link to={`/read/${v.target_id}`}>{v.target_title}</Link> —{" "}
            {v.reason} {v.source_url && <a href={v.source_url}>Evidence</a>}
          </span>
        </p>
      ))}
      {versions.data?.aliases.length > 0 && (
        <details>
          <summary>Preserved original records and citation keys</summary>
          {versions.data.aliases.map((a: any) => (
            <p key={a.id}>
              {a.citation_key} — {a.title}
            </p>
          ))}
        </details>
      )}
      <div className="pdf-controls">
        <label>
          Document version
          <select
            aria-label="Document version"
            value={attachmentId ?? ""}
            disabled={Boolean(passageId)}
            onChange={(e) => setChosen(e.target.value)}
          >
            {attachments.data?.items.map((a: any) => (
              <option value={a.id} key={a.id}>
                {a.filename} · {a.object_hash.slice(0, 12)}
              </option>
            ))}
          </select>
        </label>
        <label className="button secondary">
          Add PDF version
          <input
            type="file"
            accept=".pdf"
            disabled={mutation.isPending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) mutation.mutate({ file });
            }}
          />
        </label>
      </div>
      {attachmentId && validAttachment ? (
        <Suspense fallback={<Loading label="Loading PDF reader…" />}>
          <PdfReader
            key={attachmentId}
            attachmentId={attachmentId}
            initialPage={
              anchor.data?.selector.page ??
              (Number(params.get("page")) || undefined)
            }
            focus={anchor.data}
          />
        </Suspense>
      ) : attachmentId ? (
        <p className="review-warnings">
          The requested document is not attached to this paper. Choose an
          available version.
        </p>
      ) : (
        <div className="review-panel">
          <h2>Abstract</h2>
          <p>
            {work.data?.abstract ||
              "No PDF attached yet. Add a PDF version to read and annotate."}
          </p>
        </div>
      )}
      <section className="review-panel">
        <h2>Reading notes</h2>
        <form
          className="stack-form"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate({});
          }}
        >
          <label>
            New note
            <textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <button
            className="button primary"
            disabled={!note.trim() || mutation.isPending}
          >
            Save note
          </button>
        </form>
        {notes.data?.items.map((n: any) => (
          <article className="decision-row" key={n.id}>
            <Link to={`/notes/${n.id}`}>{n.title}</Link>
            <p style={{ whiteSpace: "pre-wrap" }}>{n.markdown}</p>
            {Array.from(
              n.markdown.matchAll(/\/passages\/([a-f0-9-]{36})/g),
            ).map((m: any) => (
              <Link key={m[1]} to={`/passages/${m[1]}`}>
                Open linked passage
              </Link>
            ))}
          </article>
        ))}
      </section>
      <section className="review-panel">
        <h2>Relationship evidence</h2>
        {graph.data?.edges
          .filter((edge) => edge.evidence?.some((e) => e.passageId))
          .map((edge) => (
            <article className="decision-row" key={edge.id}>
              <strong>{edge.predicate.replaceAll("_", " ")}</strong>
              {edge.evidence?.map((e, i) => (
                <p key={i}>
                  {e.exactText}{" "}
                  {e.passageId && (
                    <Link to={`/passages/${e.passageId}`}>
                      Open supporting passage
                    </Link>
                  )}
                </p>
              ))}
            </article>
          ))}
      </section>
      <CaptureSources workId={work.data?.id ?? id} />
    </div>
  );
}
