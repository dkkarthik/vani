import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "../api";
import { ErrorNotice } from "./ui";
export function DeepRefresh({ id }: { id: string }) {
  const qc = useQueryClient();
  const state = useQuery({
    queryKey: ["deep-refresh", id],
    queryFn: () => request<any>(`/collections/${id}/deep-refresh`),
    refetchInterval: (q) =>
      ["queued", "running"].includes(q.state.data?.job?.status) ? 1500 : false,
  });
  const refresh = useMutation({
    mutationFn: () =>
      request(`/collections/${id}/deep-refresh`, {
        method: "POST",
        body: "{}",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["deep-refresh", id] }),
  });
  const job = state.data?.job,
    running = ["queued", "running"].includes(job?.status);
  useEffect(() => {
    if (job?.updated_at) {
      void qc.invalidateQueries({ queryKey: ["collection-members", id] });
      void qc.invalidateQueries({ queryKey: ["collections"] });
    }
  }, [id, job?.updated_at, qc]);
  return (
    <section className="review-panel">
      <div className="toolbar">
        <div>
          <h2>Refresh this collection</h2>
          <p>
            Search older and newer papers across multiple keyword queries,
            references and citing papers. Your daily schedule stays unchanged.
          </p>
        </div>
        <button
          className="button primary"
          disabled={running || refresh.isPending}
          onClick={() => refresh.mutate()}
        >
          <RefreshCw size={16} />
          {running ? "Deep refresh in progress…" : "Deep refresh"}
        </button>
      </div>
      {refresh.error && <ErrorNotice error={refresh.error} />}{" "}
      {state.error && <ErrorNotice error={state.error} />}
      {job && (
        <div role="status">
          <strong>
            {
              (
                {
                  queued: "Queued",
                  running:
                    job.phase === "importing"
                      ? "Updating collection"
                      : "Searching sources",
                  completed: "Deep refresh complete",
                  partial:
                    "Deep refresh complete with source limits or warnings",
                  failed: "Deep refresh failed",
                  superseded:
                    "Refresh stopped because collection settings changed",
                } as Record<string, string>
              )[job.status]
            }
          </strong>
          <p>
            {job.scanned} unique{" "}
            {job.scanned === 1 ? "candidate" : "candidates"} reviewed ·{" "}
            {job.added} {job.added === 1 ? "paper" : "papers"} added
          </p>
          {job.error && <p>{job.error}</p>}
          {Boolean(job.warnings?.length) && (
            <details>
              <summary>Source coverage and warnings</summary>
              {job.warnings.map((w: string, i: number) => (
                <p key={i}>{w}</p>
              ))}
            </details>
          )}
          {["completed", "partial"].includes(job.status) && (
            <p>
              Available PDFs and contribution summaries are queued for local
              processing.
            </p>
          )}
        </div>
      )}
      <small>
        Up to four keyword queries, five seed neighborhoods and 200 relevant
        additions per refresh. Uses your current keywords and discovery
        feedback; coverage is not exhaustive.
      </small>
    </section>
  );
}
