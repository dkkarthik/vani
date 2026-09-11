import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ReadingState } from "@vani/shared";
import { api } from "../api";
import { useWorkspace } from "../context";
import { Choice, Feedback, Field, send, useAction, useK } from "./common";
import { ErrorNotice } from "../components/ui";
export function Reading() {
  const { collectionId } = useWorkspace(),
    [project, setProject] = useState(collectionId ?? ""),
    collections = useQuery({
      queryKey: ["collections"],
      queryFn: api.collections,
    }),
    reading = useK("/reading?collectionId=" + project, Boolean(project));
  const next = reading.data?.items.find(
    (w: any) =>
      w.queued && !["read", "rejected", "archived", "cited"].includes(w.status),
  );
  return (
    <>
      <Choice
        label="Reading project"
        value={project}
        onChange={setProject}
        items={
          collections.data?.items.filter(
            (c) => c.collectionType !== "saved_search",
          ) ?? []
        }
      />
      <p>
        Queue the subset you want to read, then set a question and priority for
        each paper. Up to 500 memberships are shown.
      </p>
      {next ? (
        <Link className="button primary" to={"/read/" + next.work_id}>
          Resume next: {next.title}
        </Link>
      ) : (
        <p>No unfinished papers in this queue.</p>
      )}
      {reading.error && <ErrorNotice error={reading.error} />}
      <p>Add papers to the project from Organize or Library.</p>
      {reading.data?.items.map((w: any) => (
        <ReadingRow key={w.work_id + ":" + w.reading_revision} work={w} />
      ))}
    </>
  );
}
function ReadingRow({ work }: { work: any }) {
  const [d, setD] = useState({
      version: work.reading_revision,
      question: work.question,
      rationale: work.rationale,
      priority: work.priority,
      status: work.status,
      queued: work.queued,
      ordinal: work.ordinal,
    }),
    a = useAction();
  const set = (k: string, v: any) => setD({ ...d, [k]: v });
  return (
    <section className="review-panel">
      <h2>
        <Link to={"/read/" + work.work_id}>{work.title}</Link>
      </h2>
      <small>
        {work.citation_key} ·{" "}
        {work.last_read
          ? "Last read " + new Date(work.last_read).toLocaleString()
          : "Not opened yet"}
      </small>
      <Feedback action={a} />
      <form
        className="stack-form"
        onSubmit={(e) => {
          e.preventDefault();
          void a.run(() =>
            send(`/reading/${work.collection_id}/${work.work_id}`, d, "PATCH"),
          );
        }}
      >
        <Field label="Question this paper may answer">
          <input
            value={d.question}
            onChange={(e) => set("question", e.target.value)}
          />
        </Field>
        <Field label="Why I saved this paper">
          <textarea
            value={d.rationale}
            onChange={(e) => set("rationale", e.target.value)}
          />
        </Field>
        <div className="research-filters">
          <Choice
            label="Reading state"
            value={d.status}
            onChange={(v) => set("status", v)}
            items={ReadingState.options}
          />
          <Field label="Priority (0–5)">
            <input
              type="number"
              min="0"
              max="5"
              value={d.priority}
              onChange={(e) => set("priority", Number(e.target.value))}
            />
          </Field>
          <Field label="Queue order">
            <input
              type="number"
              min="0"
              value={d.ordinal}
              onChange={(e) => set("ordinal", Number(e.target.value))}
            />
          </Field>
          <label className="check-line">
            <input
              type="checkbox"
              checked={d.queued}
              onChange={(e) => set("queued", e.target.checked)}
            />
            In my reading queue
          </label>
        </div>
        <button className="button primary" disabled={a.busy}>
          Save reading plan
        </button>
      </form>
    </section>
  );
}
