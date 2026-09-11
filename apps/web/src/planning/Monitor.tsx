import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import {
  Choice,
  Field,
  Feedback,
  Json,
  send,
  useAction,
  useK,
} from "../knowledge/common";
import { ErrorNotice } from "../components/ui";
export function CandidateFeedback({
  runId,
  candidate,
}: {
  runId: string;
  candidate: any;
}) {
  const [reason, setReason] = useState(""),
    [date, setDate] = useState(""),
    [version, setVersion] = useState(candidate.feedback?.version ?? 0),
    [saved, setSaved] = useState(""),
    a = useAction();
  return (
    <div className="candidate-feedback">
      <Feedback action={a} />
      {candidate.feedback && (
        <p>
          Prior decision: {candidate.feedback.state} ·{" "}
          {candidate.feedback.reason}{" "}
          {candidate.feedback.materialChanged
            ? "· material metadata changed; review again"
            : ""}
        </p>
      )}
      <Field label="Recommendation feedback reason">
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Field label="Defer until">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </Field>
      <div className="toolbar">
        {["accepted", "dismissed", "deferred"].map((state) => (
          <button
            className="button secondary"
            key={state}
            disabled={!reason || a.busy || (state === "deferred" && !date)}
            onClick={() =>
              void a.run(async () => {
                await send("/feedback", {
                  runId,
                  resultId: candidate.resultId,
                  state,
                  reason,
                  version,
                  ...(state === "deferred"
                    ? { deferUntil: new Date(date + "T23:59:59").toISOString() }
                    : {}),
                });
                setVersion(version + 1);
                setSaved(state);
              }, "Feedback recorded; unchanged results will be suppressed in this context.")
            }
          >
            {state === "accepted"
              ? "Accept recommendation"
              : state === "dismissed"
                ? "Dismiss recommendation"
                : "Defer recommendation"}
          </button>
        ))}
      </div>
      {saved && (
        <p>
          Recorded: {saved}. Acceptance records relevance; use Import selected
          to add a paper.
        </p>
      )}
    </div>
  );
}
export function FeedbackHistory() {
  const rows = useK("/feedback"),
    a = useAction();
  return (
    <>
      <Feedback action={a} />
      <h2>Discovery decisions</h2>
      <p>
        Latest 200 decisions. Restore allows an unchanged recommendation to
        appear again; material metadata changes and expired deferrals already
        permit review.
      </p>
      {rows.error && <ErrorNotice error={rows.error} />}{" "}
      {rows.data?.items.map((f: any) => (
        <article className="review-panel" key={f.id}>
          <h3>{f.identity_key}</h3>
          <p>
            {f.state} · {f.reason}
          </p>
          <small>
            {f.context_key}
            {f.defer_until
              ? " · deferred until " +
                new Date(f.defer_until).toLocaleDateString()
              : ""}
          </small>
          <button
            className="button secondary"
            disabled={a.busy || f.state === "restored"}
            onClick={() =>
              void a.run(() =>
                send(`/feedback/${f.id}/restore`, { version: f.version }),
              )
            }
          >
            Restore recommendation
          </button>
          <details>
            <summary>Decision history</summary>
            <Json value={f.history} />
          </details>
        </article>
      ))}
    </>
  );
}
export function Digests() {
  const [id, setId] = useState(""),
    collections = useQuery({
      queryKey: ["collections"],
      queryFn: api.collections,
    }),
    d = useK("/digests/" + id, Boolean(id)),
    a = useAction(),
    [capture, setCapture] = useState<any>(null);
  return (
    <>
      <Feedback action={a} />
      <Choice
        label="Monitored collection"
        value={id}
        onChange={(v) => {
          setId(v);
          setCapture(null);
        }}
        items={
          collections.data?.items.filter(
            (c) => c.collectionType !== "saved_search",
          ) ?? []
        }
      />
      <p>
        Configure the topic and daily schedule in Collections. The local worker
        must be running for scheduled discovery. Unchanged snapshots stay quiet.
      </p>
      {d.error && <ErrorNotice error={d.error} />}{" "}
      {d.data && (
        <>
          <section className="review-panel">
            <h2>{d.data.collection.name}</h2>
            <p>
              {d.data.collection.discovery?.enabled
                ? "Monitoring enabled"
                : "Monitoring paused or unconfigured"}{" "}
              · next run{" "}
              {d.data.collection.next_discovery_at ?? "not scheduled"}
            </p>
            {d.data.collection.discovery_error && (
              <p role="alert">
                Provider/worker status: {d.data.collection.discovery_error}
              </p>
            )}
            <div className="toolbar">
              {["pause", "resume", "retry"].map((action) => (
                <button
                  className="button secondary"
                  key={action}
                  disabled={a.busy}
                  onClick={() =>
                    void a.run(
                      () => send(`/digests/${id}/control`, { action }),
                      action === "pause"
                        ? "Monitoring paused."
                        : "Refresh queued for the local worker.",
                    )
                  }
                >
                  {action === "pause"
                    ? "Pause monitoring"
                    : action === "resume"
                      ? "Resume monitoring"
                      : "Retry source refresh"}
                </button>
              ))}
              <button
                className="button primary"
                disabled={a.busy}
                onClick={() =>
                  void a.run(
                    async () =>
                      setCapture(await send(`/digests/${id}/capture`, {})),
                    "Stored collection changes checked.",
                  )
                }
              >
                Check stored changes
              </button>
              <button
                className="button secondary"
                disabled={a.busy}
                onClick={() =>
                  void a.run(() =>
                    send(`/digests/${id}/control`, {
                      action: "acknowledge",
                      ids: d.data.items
                        .filter((e: any) => !e.seen_at)
                        .map((e: any) => e.id),
                    }),
                  )
                }
              >
                Acknowledge visible changes
              </button>
            </div>
            {capture && (
              <p>
                {capture.baseline
                  ? "Baseline established."
                  : capture.added
                    ? `${capture.added} changes recorded.`
                    : "No changes since the previous snapshot."}{" "}
                Coverage: {capture.coverage.works}/1000 works,{" "}
                {capture.coverage.edges}/2000 connections.
              </p>
            )}
          </section>
          {!d.data.items.length && <p>No change events to review.</p>}
          {d.data.items.map((e: any) => (
            <article className="review-panel" key={e.id}>
              <h3>
                {e.kind} ·{" "}
                {e.payload.after?.title ??
                  e.payload.after?.predicate ??
                  e.payload.id}
              </h3>
              <p>
                {e.seen_at ? "Reviewed" : "New change"} ·{" "}
                {new Date(e.created_at).toLocaleString()}
              </p>
              {["new", "corrected", "retracted"].includes(e.kind) && (
                <a href={"/read/" + e.payload.id}>
                  Inspect paper and provenance
                </a>
              )}
              <details>
                <summary>Before / after evidence</summary>
                <Json value={e.payload} />
              </details>
            </article>
          ))}
        </>
      )}
    </>
  );
}
