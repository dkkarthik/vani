import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { request, api } from "../api";
import { ErrorNotice } from "./ui";

export function CorePanel({ id }: { id: string }) {
  const client = useQueryClient();
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState<any>(),
    [detail, setDetail] = useState<any>(),
    [offset, setOffset] = useState(0),
    [article, setArticle] = useState("");
  const data = useQuery({
    queryKey: ["core", id, offset],
    queryFn: () => request<any>(`/collections/${id}/core?offset=${offset}`),
    refetchInterval: 10000,
  });
  const works = useQuery({
    queryKey: ["works", id],
    queryFn: () => api.works(id),
  });
  const action = useMutation({
    mutationFn: ({
      path,
      body,
      method = "POST",
    }: {
      path: string;
      body?: unknown;
      method?: string;
    }) =>
      request<any>(path, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["core", id] });
      void client.invalidateQueries({ queryKey: ["collection-members", id] });
    },
  });
  const d = data.data;
  if (data.error) return <ErrorNotice error={data.error} />;
  if (!d) return null;
  const run = d.runs[0],
    save = () => {
      action.mutate(
        {
          path: `/collections/${id}/core/focus`,
          method: "PUT",
          body: { version: d.focus.version, profile: draft },
        },
        {
          onSuccess: () => {
            setEditing(false);
            setSaved(true);
          },
        },
      );
    };
  const saveButton = (
    <button
      type="button"
      className="button primary"
      disabled={action.isPending}
      onClick={save}
    >
      {action.isPending ? "Saving…" : "Save focus changes"}
    </button>
  );
  return (
    <section className="settings-card core-panel" style={{ margin: "16px 0" }}>
      <h2>Research focus and related work</h2>
      <p>{d.focus.profile.question}</p>
      <p>
        Focus version {d.focus.version} · {d.focus.profile.mode} mode · Local
        inference
      </p>
      <p>
        Reading ceilings per refresh: {d.focus.profile.budgets.d2} targeted
        comparisons · {d.focus.profile.budgets.d3} deep readings.
      </p>
      <button
        className="button secondary"
        onClick={() => {
          setSaved(false);
          action.reset();
          setDraft(structuredClone(d.focus.profile));
          setEditing(!editing);
        }}
      >
        Edit focus and anchors
      </button>{" "}
      <button
        className="button secondary"
        disabled={action.isPending}
        onClick={() =>
          action.mutate({ path: `/collections/${id}/core/refresh` })
        }
      >
        Search / resume
      </button>
      {run && ["running", "queued", "paused"].includes(run.status) && (
        <button
          className="button secondary"
          disabled={action.isPending}
          onClick={() =>
            action.mutate({
              path: `/collections/${id}/core/control`,
              body: { action: run.status === "paused" ? "resume" : "pause" },
            })
          }
        >
          {run.status === "paused"
            ? "Start next measured wave"
            : "Pause reading"}
        </button>
      )}
      {d.compute && (
        <details open>
          <summary>Compute and reading quality</summary>
          <p>
            Reading waves: D1 {d.focus.profile.compute?.d1 ?? 40} · D2{" "}
            {d.focus.profile.compute?.d2 ?? 10} · D3{" "}
            {d.focus.profile.compute?.d3 ?? 3} calls. High failure rates pause
            reading automatically. Search / resume does not release this hold.
          </p>
          <p>{d.compute.scope}</p>
          <table>
            <thead>
              <tr>
                <th>Stage</th>
                <th>Calls</th>
                <th>Valid evidence</th>
                <th>Validity</th>
                <th>Model minutes</th>
                <th>Minutes / valid</th>
                <th>Output tokens</th>
              </tr>
            </thead>
            <tbody>
              {d.compute.stages.map((x: any) => (
                <tr key={x.stage}>
                  <td>{x.stage}</td>
                  <td>{x.attempts}</td>
                  <td>{x.accepted}</td>
                  <td>
                    {x.attempts
                      ? Math.round((100 * x.accepted) / x.attempts)
                      : 0}
                    %
                  </td>
                  <td>{(x.duration_ms / 60000).toFixed(1)}</td>
                  <td>
                    {x.accepted
                      ? (x.duration_ms / 60000 / x.accepted).toFixed(1)
                      : "—"}
                  </td>
                  <td>{x.output_tokens}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {d.compute.issues.map((x: any) => (
            <p key={x.code}>
              {x.code}: {x.count}
            </p>
          ))}
          <p>
            Valid evidence does not guarantee relevance. Use paper feedback to
            evaluate retrieval quality before reducing search coverage.
          </p>
        </details>
      )}
      {saved && (
        <p role="status">
          Focus changes saved. You can now start Deep refresh or Search /
          resume.
        </p>
      )}
      {editing && draft && (
        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
          <div>
            {saveButton}
            <p>
              Changes are not saved automatically. Save focus changes applies
              all edits in this editor.
            </p>
          </div>
          <fieldset>
            <legend>Model calls per measured wave</legend>
            {["d1", "d2", "d3"].map((stage) => (
              <label key={stage}>
                {stage.toUpperCase()}{" "}
                <input
                  type="number"
                  min="1"
                  max={stage === "d1" ? 200 : stage === "d2" ? 100 : 50}
                  value={
                    draft.compute?.[stage] ??
                    ({ d1: 40, d2: 10, d3: 3 } as any)[stage]
                  }
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      compute: {
                        d1: 40,
                        d2: 10,
                        d3: 3,
                        ...draft.compute,
                        [stage]: Number(e.target.value),
                      },
                    })
                  }
                />
              </label>
            ))}
          </fieldset>
          <label>
            Research question
            <textarea
              style={{ width: "100%" }}
              value={draft.question}
              onChange={(e) => setDraft({ ...draft, question: e.target.value })}
            />
          </label>
          <label>
            Objective{" "}
            <select
              value={draft.objective}
              onChange={(e) =>
                setDraft({ ...draft, objective: e.target.value })
              }
            >
              {[
                "closest",
                "competitors",
                "foundations",
                "inspiration",
                "recent",
              ].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            Admission mode{" "}
            <select
              value={draft.mode}
              onChange={(e) => setDraft({ ...draft, mode: e.target.value })}
            >
              {["shadow", "review", "automatic"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>{" "}
            Automatic admission requires a promoted policy and source-backed
            comparison.
          </label>
          <fieldset>
            <legend>Explicit anchor papers</legend>
            {works.data?.items.map((w) => (
              <label key={w.id} style={{ display: "block" }}>
                <input
                  type="checkbox"
                  checked={draft.anchors.some((a: any) => a.workId === w.id)}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      anchors: e.target.checked
                        ? [...draft.anchors, { workId: w.id, weight: 1 }]
                        : draft.anchors.filter((a: any) => a.workId !== w.id),
                    })
                  }
                />
                {w.title}
              </label>
            ))}
          </fieldset>
          <label>
            Public search queries (one per line)
            <textarea
              style={{ width: "100%" }}
              value={draft.publicQueries.join("\n")}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  publicQueries: e.target.value.split("\n"),
                })
              }
            />
          </label>
          <div>
            {saveButton}
            {action.error && <ErrorNotice error={action.error} />}
          </div>
          <fieldset>
            <legend>Reading ceilings per refresh</legend>
            <p>
              Larger budgets take longer. Papers still need sufficient relevance
              and evidence to advance.
            </p>
            <label>
              Targeted comparisons (D2)
              <input
                type="number"
                min={1}
                max={1000}
                step={1}
                value={draft.budgets.d2}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    budgets: { ...draft.budgets, d2: Number(e.target.value) },
                  })
                }
              />
            </label>
            <label>
              Deep readings (D3)
              <input
                type="number"
                min={1}
                max={250}
                step={1}
                value={draft.budgets.d3}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    budgets: { ...draft.budgets, d3: Number(e.target.value) },
                  })
                }
              />
            </label>
          </fieldset>
          <label>
            Contribution facets (one per line)
            <textarea
              style={{ width: "100%" }}
              value={draft.facets.map((f: any) => f.text).join("\n")}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  facets: e.target.value
                    .split("\n")
                    .filter(Boolean)
                    .map((text, i) => ({
                      id: draft.facets[i]?.id ?? `facet-${i + 1}`,
                      kind: draft.facets[i]?.kind ?? "contribution",
                      text,
                    })),
                })
              }
            />
          </label>
          <label>
            Conceptual exclusions (one per line)
            <textarea
              style={{ width: "100%" }}
              value={draft.exclusions.join("\n")}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  exclusions: e.target.value.split("\n").filter(Boolean),
                })
              }
            />
          </label>
          <label>
            Quiet-window timezone{" "}
            <input
              value={draft.audits.timezone}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  audits: { ...draft.audits, timezone: e.target.value },
                })
              }
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.audits.enabled}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  audits: { ...draft.audits, enabled: e.target.checked },
                })
              }
            />
            Audit early decisions every three days and deeper readings monthly,
            02:00–06:00 in this timezone
          </label>
          {saveButton}
        </div>
      )}
      {action.error && <ErrorNotice error={action.error} />}
      {run && (
        <p role="status">
          {run.status} · {run.phase} ·{" "}
          {Object.entries(run.counters)
            .map(([k, v]) => `${k}: ${v}`)
            .join(" · ")}
          {run.error && ` · ${run.error}`}
        </p>
      )}
      <details>
        <summary>Coverage and audit history</summary>
        <pre
          style={{ whiteSpace: "pre-wrap", maxHeight: 240, overflow: "auto" }}
        >
          {JSON.stringify(
            {
              counts: d.counts,
              coverage: run?.coverage,
              audits: d.audits,
              policies: d.policies,
            },
            null,
            2,
          )}
        </pre>
        <button
          className="button secondary"
          onClick={() =>
            action.mutate({
              path: `/collections/${id}/core/audits`,
              body: { kind: "early" },
            })
          }
        >
          Queue early audit
        </button>{" "}
        <button
          className="button secondary"
          onClick={() =>
            action.mutate({
              path: `/collections/${id}/core/audits`,
              body: { kind: "deep" },
            })
          }
        >
          Queue deep audit
        </button>
      </details>
      <label>
        Research article or blog URL{" "}
        <input
          type="url"
          value={article}
          onChange={(e) => setArticle(e.target.value)}
        />
      </label>
      <button
        className="button secondary"
        disabled={!article || action.isPending}
        onClick={() =>
          action.mutate({
            path: `/collections/${id}/core/articles`,
            body: { url: article },
          })
        }
      >
        Extract primary-paper leads
      </button>
      <p>
        Candidates are reviewed separately from your saved collection.
        Experimental compatibility is a separate judgment from idea proximity.
      </p>
      <details>
        <summary>
          Review candidates (
          {d.counts.reduce((n: number, c: any) => n + c.count, 0)})
        </summary>
        {d.candidates.map((c: any) => (
          <article
            key={c.id}
            style={{ borderTop: "1px solid #ddd", padding: "12px 0" }}
          >
            <strong>{c.title}</strong>
            <p>
              {c.proximity} · {c.role} · requested depth {c.stage} · {c.state}
            </p>
            <p>
              {c.assessment.contribution ??
                c.assessment.reason ??
                "Awaiting source-grounded assessment."}
            </p>
            {c.features.exclusion && (
              <p>
                Excluded: {c.features.exclusion.reason.replaceAll("_", " ")}
              </p>
            )}
            {c.features.selectionReason && (
              <p>
                Selected for: {c.features.selectionReason.replaceAll("_", " ")}
              </p>
            )}
            {c.last_error && (
              <p role="status">
                Reading attempts: {c.attempts} · {c.last_error}
                {c.state === "pending"
                  ? ` · Retry after ${new Date(c.next_attempt_at).toLocaleString()}`
                  : " · Request reading to retry."}
              </p>
            )}
            {c.assessment.comparison && (
              <p>
                Experimental compatibility: {c.assessment.comparison.status}
              </p>
            )}
            <button
              className="button secondary"
              onClick={() =>
                void request<any>(`/core/candidates/${c.id}`)
                  .then(setDetail)
                  .catch((e) => setDetail({ error: String(e) }))
              }
            >
              Evidence and history
            </button>{" "}
            <button
              className="button secondary"
              disabled={
                action.isPending ||
                c.state === "accepted" ||
                c.state === "excluded"
              }
              onClick={() =>
                action.mutate({ path: `/core/candidates/${c.id}/accept` })
              }
            >
              Accept and obtain PDF
            </button>{" "}
            <button
              className="button secondary"
              onClick={() =>
                action.mutate({
                  path: `/core/candidates/${c.id}/read`,
                  body: { depth: "D3" },
                })
              }
              disabled={action.isPending || c.state === "excluded"}
            >
              Request deep reading
            </button>{" "}
            <label>
              My judgment{" "}
              <select
                value={c.feedback?.label ?? ""}
                onChange={(e) =>
                  action.mutate({
                    path: `/core/candidates/${c.id}/feedback`,
                    body: {
                      label: e.target.value,
                      reason: "Researcher judgment in collection review",
                    },
                  })
                }
              >
                <option value="" disabled>
                  Unjudged
                </option>
                {[
                  "closest",
                  "related",
                  "background",
                  "out_of_scope",
                  "wrong_role",
                  "incompatible_protocol",
                  "duplicate",
                  "already_known",
                  "low_priority",
                ].map((x) => (
                  <option key={x} value={x}>
                    {x.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
          </article>
        ))}
        <button
          className="button secondary"
          disabled={!offset}
          onClick={() => setOffset(Math.max(0, offset - 50))}
        >
          Previous candidates
        </button>{" "}
        <button
          className="button secondary"
          disabled={d.candidates.length < 50}
          onClick={() => setOffset(offset + 50)}
        >
          Next candidates
        </button>
      </details>
      {detail && (
        <div role="dialog" aria-label="Candidate evidence">
          <button
            className="button secondary"
            onClick={() => setDetail(undefined)}
          >
            Close evidence
          </button>
          {detail.attempts
            ?.filter((a: any) => a.replayable)
            .map((a: any) => (
              <button
                key={a.id}
                className="button secondary"
                onClick={() => {
                  void request<any>(`/core/attempts/${a.id}`)
                    .then((selectedAttempt) =>
                      setDetail({ ...detail, selectedAttempt }),
                    )
                    .catch((e) => setDetail({ ...detail, error: String(e) }));
                }}
              >
                Inspect {a.stage} {a.status} ·{" "}
                {new Date(a.created_at).toLocaleString()}
              </button>
            ))}
          <pre
            style={{ whiteSpace: "pre-wrap", maxHeight: 500, overflow: "auto" }}
          >
            {JSON.stringify(
              {
                title: detail.paper?.title,
                assessment: detail.assessment,
                history: detail.history,
                attempts: detail.attempts,
                selectedAttempt: detail.selectedAttempt,
                paths: detail.paths,
                artifacts: detail.artifacts,
                error: detail.error,
              },
              null,
              2,
            )}
          </pre>
        </div>
      )}
    </section>
  );
}
