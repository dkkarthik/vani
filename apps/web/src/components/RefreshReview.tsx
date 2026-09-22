import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { request } from "../api";
import { ErrorNotice } from "./ui";

function Feedback({
  row,
  run,
  changed,
}: {
  row: any;
  run: string;
  changed: () => void;
}) {
  const [reason, setReason] = useState(row.current_feedback?.reason ?? "");
  const [label, setLabel] = useState(row.current_feedback?.label ?? "");
  const save = useMutation({
    mutationFn: (value: string) =>
      request(`/core/candidates/${row.candidate_id}/feedback`, {
        method: "POST",
        body: JSON.stringify({ label: value, reason, runId: run }),
      }),
    onSuccess: (_, value) => {
      setLabel(value === "clear" ? "" : value);
      changed();
    },
  });
  return (
    <div>
      <button
        className="button secondary"
        aria-label="Good match"
        aria-pressed={["closest", "related"].includes(label)}
        disabled={save.isPending}
        onClick={() => save.mutate("related")}
      >
        👍 Good match
      </button>{" "}
      <button
        className="button secondary"
        aria-label="Poor match"
        aria-pressed={label === "out_of_scope"}
        disabled={save.isPending}
        onClick={() => save.mutate("out_of_scope")}
      >
        👎 Poor match
      </button>{" "}
      <button
        className="button secondary"
        disabled={save.isPending || !label}
        onClick={() => save.mutate("clear")}
      >
        Clear judgment
      </button>
      <label>
        Why this paper fits or misses the collection (optional)
        <textarea
          maxLength={2000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <button
        className="button secondary"
        disabled={save.isPending || !label}
        onClick={() => save.mutate(label)}
      >
        Save explanation
      </button>
      {save.isSuccess && (
        <span role="status">
          {" "}
          Feedback saved for future ranking and screening.
        </span>
      )}
      {save.error && <ErrorNotice error={save.error} />}
    </div>
  );
}
function PaperTrace({ collection, run, row, changed }: any) {
  const [open, setOpen] = useState(false);
  const trace = useQuery({
    queryKey: ["refresh-trace", run, row.candidate_id],
    queryFn: () =>
      request<any>(
        `/collections/${collection}/core/runs/${run}/candidates/${row.candidate_id}`,
      ),
    enabled: open,
  });
  const s = row.snapshot;
  return (
    <article className="card">
      <h4>{s.title}</h4>
      <p>
        {s.stage} · {row.outcome.replaceAll("_", " ")} · {s.proximity} ·{" "}
        {row.retrieved
          ? "Retrieved this refresh"
          : "Retained from earlier discovery"}
      </p>
      <p>
        {s.assessment?.reason ||
          s.assessment?.contribution ||
          s.features?.exclusion?.reason ||
          s.last_error ||
          s.features?.selectionReason ||
          "Awaiting assessment"}
      </p>
      <Feedback
        key={row.candidate_id + run}
        row={row}
        run={run}
        changed={changed}
      />
      <button className="button secondary" onClick={() => setOpen(!open)}>
        {open ? "Hide" : "Inspect"} decision timeline and sources
      </button>
      {open && (
        <div>
          {trace.error && <ErrorNotice error={trace.error} />}
          {row.partial_history && (
            <p>Partial history: this candidate predates run tracing.</p>
          )}
          <h5>Discovery paths for this refresh</h5>
          <pre style={{ whiteSpace: "pre-wrap" }}>
            {JSON.stringify(row.paths, null, 2)}
          </pre>
          {trace.data?.events.map((e: any) => (
            <div key={e.id}>
              <strong>
                {new Date(e.created_at).toLocaleString()} · {e.stage} ·{" "}
                {e.state}
              </strong>
              <details>
                <summary>Decision, score and evidence</summary>
                <pre style={{ whiteSpace: "pre-wrap" }}>
                  {JSON.stringify(e.detail, null, 2)}
                </pre>
              </details>
            </div>
          ))}
          <details>
            <summary>Paper metadata and final decision</summary>
            <pre style={{ whiteSpace: "pre-wrap" }}>
              {JSON.stringify(s, null, 2)}
            </pre>
          </details>
          <details>
            <summary>Reading diagnostics and feedback history</summary>
            <pre style={{ whiteSpace: "pre-wrap" }}>
              {JSON.stringify(
                {
                  attempts: trace.data?.attempts,
                  feedback: trace.data?.feedbackHistory,
                },
                null,
                2,
              )}
            </pre>
          </details>
        </div>
      )}
    </article>
  );
}
function RefreshReviewContent({ id }: { id: string }) {
  const client = useQueryClient();
  const [selected, setSelected] = useState(""),
    [runOffset, setRunOffset] = useState(0),
    [offset, setOffset] = useState(0),
    [stage, setStage] = useState(""),
    [outcome, setOutcome] = useState(""),
    [search, setSearch] = useState("");
  const [queries, setQueries] = useState(""),
    [proposal, setProposal] = useState<any>();
  const runs = useQuery({
    queryKey: ["refresh-runs", id, runOffset],
    queryFn: () =>
      request<any>(`/collections/${id}/core/runs?offset=${runOffset}`),
    refetchInterval: 10000,
  });
  const run = selected || runs.data?.items?.[0]?.id;
  const data = useQuery({
    queryKey: ["refresh-review", id, run, offset, stage, outcome, search],
    queryFn: () =>
      request<any>(
        `/collections/${id}/core/runs/${run}?` +
          new URLSearchParams({
            offset: String(offset),
            stage,
            outcome,
            search,
          }),
      ),
    enabled: !!run,
    refetchInterval: 10000,
  });
  const changed = () => {
    void client.invalidateQueries({ queryKey: ["refresh-review", id] });
    void client.invalidateQueries({ queryKey: ["refresh-trace"] });
    void client.invalidateQueries({ queryKey: ["core", id] });
  };
  const edit = useMutation({
    mutationFn: () => request<any>(`/collections/${id}/core`),
    onSuccess: (d) => {
      setProposal({ version: d.focus.version, profile: d.focus.profile });
      setQueries(d.focus.profile.publicQueries.join("\n"));
    },
  });
  const suggest = useMutation({
    mutationFn: () =>
      request<any>(`/collections/${id}/core/query-proposal`, {
        method: "POST",
        body: "{}",
      }),
    onSuccess: (d) => {
      setProposal(d);
      setQueries(d.queries.join("\n"));
    },
  });
  const apply = useMutation({
    mutationFn: () =>
      request(`/collections/${id}/core/focus`, {
        method: "PUT",
        body: JSON.stringify({
          version: proposal.version,
          profile: {
            ...proposal.profile,
            publicQueries: queries
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean),
          },
        }),
      }),
    onSuccess: () => {
      setProposal(undefined);
      changed();
    },
  });
  return (
    <div>
      <p>
        Inspect every refresh, including rejected and deferred papers. Feedback
        affects subsequent local ranking and screening; it does not restart a
        paused run or automatically accept papers.
      </p>
      {[runs.error, data.error, edit.error, suggest.error, apply.error]
        .filter(Boolean)
        .map((e, i) => (
          <ErrorNotice key={i} error={e} />
        ))}
      <label>
        Refresh
        <select
          value={run ?? ""}
          onChange={(e) => {
            setSelected(e.target.value);
            setOffset(0);
          }}
        >
          {runs.data?.items?.map((r: any) => (
            <option key={r.id} value={r.id}>
              {new Date(r.created_at).toLocaleString()} · {r.status}
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={!runOffset}
        onClick={() => {
          setRunOffset(Math.max(0, runOffset - 20));
          setSelected("");
        }}
      >
        Newer refreshes
      </button>{" "}
      <button
        disabled={runs.data?.items?.length !== 20}
        onClick={() => {
          setRunOffset(runOffset + 20);
          setSelected("");
        }}
      >
        Older refreshes
      </button>
      {!run && <p>No deep refreshes yet.</p>}
      {data.data && (
        <>
          <p>
            {data.data.run.status} · {data.data.run.phase} {data.data.run.error}
          </p>
          <p>
            {data.data.summary
              .map((x: any) => `${x.outcome.replaceAll("_", " ")}: ${x.count}`)
              .join(" · ") ||
              "No candidate trace is available yet; older runs may predate tracing."}
          </p>
          <p>
            Stages reached or retained:{" "}
            {data.data.stages
              .map((x: any) => `${x.stage}: ${x.count}`)
              .join(" · ")}
          </p>
          {data.data.summary.some((x: any) => x.partial > 0) && (
            <p>
              Older data has partial history; full tracing starts after this
              update.
            </p>
          )}
          <details>
            <summary>Search coverage and run counters</summary>
            <pre style={{ whiteSpace: "pre-wrap" }}>
              {JSON.stringify(
                {
                  coverage: data.data.run.coverage,
                  counters: data.data.run.counters,
                },
                null,
                2,
              )}
            </pre>
          </details>
          <label>
            Recorded stage
            <select
              value={stage}
              onChange={(e) => {
                setStage(e.target.value);
                setOffset(0);
              }}
            >
              {["", "D0", "D1a", "D1b", "D2", "D3"].map((s) => (
                <option key={s} value={s}>
                  {s || "All stages"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Outcome
            <select
              value={outcome}
              onChange={(e) => {
                setOutcome(e.target.value);
                setOffset(0);
              }}
            >
              {[
                "",
                "accepted",
                "not_related",
                "excluded",
                "budget_deferred",
                "missing_evidence",
                "failure",
                "review",
              ].map((s) => (
                <option key={s} value={s}>
                  {s.replaceAll("_", " ") || "All outcomes"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Find paper
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
              }}
            />
          </label>
          <p>{data.data.total} matching papers</p>
          {data.data.items.map((row: any) => (
            <PaperTrace
              key={run + row.candidate_id}
              collection={id}
              run={run}
              row={row}
              changed={changed}
            />
          ))}
          <button
            disabled={!offset}
            onClick={() => setOffset(Math.max(0, offset - 30))}
          >
            Previous papers
          </button>{" "}
          <button
            disabled={offset + 30 >= data.data.total}
            onClick={() => setOffset(offset + 30)}
          >
            Next papers
          </button>
        </>
      )}
      <h4>Refine public search queries</h4>
      <p>
        Use your feedback to draft better searches. Queries below are sent to
        scholarly sources only after you apply them and run discovery. Review
        the wording before applying.
      </p>
      <button
        className="button secondary"
        disabled={edit.isPending || suggest.isPending || apply.isPending}
        onClick={() => edit.mutate()}
      >
        Edit saved queries
      </button>{" "}
      <button
        className="button secondary"
        disabled={suggest.isPending || edit.isPending || apply.isPending}
        onClick={() => suggest.mutate()}
      >
        {suggest.isPending
          ? "Local model is drafting…"
          : "Suggest queries from feedback (local model)"}
      </button>
      {proposal && (
        <div>
          <p>{proposal.explanation}</p>
          <label>
            Public queries, one per line
            <textarea
              value={queries}
              onChange={(e) => setQueries(e.target.value)}
            />
          </label>
          <button
            className="button primary"
            disabled={apply.isPending || suggest.isPending || edit.isPending}
            onClick={() => apply.mutate()}
          >
            Apply public queries
          </button>
        </div>
      )}
      {apply.isSuccess && !proposal && (
        <p role="status">
          Queries saved. Use Deep refresh to search with them.
        </p>
      )}
    </div>
  );
}

export function RefreshReview({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Deep refresh history and feedback</summary>
      {open && <RefreshReviewContent id={id} />}
    </details>
  );
}
