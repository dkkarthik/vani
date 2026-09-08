import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type MetadataDocument,
  type MetadataFields,
  metadataKeys,
  metadataLabels,
  metadataEquivalent,
} from "@vani/shared";
import { request } from "../api";
import { MetadataEditor, metadataValue } from "../components/MetadataEditor";
import {
  ErrorNotice,
  Loading,
  PageHeader,
  VerificationBadge,
} from "../components/ui";
export function MetadataPage() {
  const { workId } = useParams(),
    client = useQueryClient();
  const [identifier, setIdentifier] = useState(""),
    [sourceId, setSourceId] = useState(""),
    [selected, setSelected] = useState<Array<keyof MetadataFields>>([]),
    [override, setOverride] = useState(false),
    [keep, setKeep] = useState(false),
    [reason, setReason] = useState("");
  const query = useQuery({
    queryKey: ["metadata", workId],
    queryFn: () => request<MetadataDocument>(`/works/${workId}/metadata`),
  });
  const mutation = useMutation({
    mutationFn: ({
      path = "",
      body,
      method = "POST",
    }: {
      path?: string;
      body: unknown;
      method?: string;
    }) =>
      request<MetadataDocument>(`/works/${workId}/metadata${path}`, {
        method,
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => {
      client.setQueryData(["metadata", workId], data);
      client.invalidateQueries({ queryKey: ["work", workId] });
      client.invalidateQueries({ queryKey: ["library"] });
      client.invalidateQueries({ queryKey: ["collection-members"] });
      setSelected([]);
      setOverride(false);
      setKeep(false);
    },
  });
  if (query.isLoading) return <Loading />;
  if (query.error) return <ErrorNotice error={query.error} />;
  const data = query.data;
  if (!data) return null;
  const source =
    data.assertions.find((assertion) => assertion.id === sourceId) ??
    data.assertions[0];
  return (
    <div className="page metadata-page">
      <PageHeader
        eyebrow="F03 · Metadata review"
        title={data.fields.title}
        description={`Citation key ${data.citationKey} · Revision ${data.revision}`}
        actions={
          <Link className="button secondary" to={`/read/${workId}`}>
            Back to paper
          </Link>
        }
      />
      <VerificationBadge status={data.verificationStatus} />
      <p>
        Saved corrections are protected. Source lookups add evidence; choose
        which fields to apply.
      </p>
      {data.warnings.length > 0 && (
        <ul className="review-warnings">
          {data.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
      {mutation.error && (
        <>
          <ErrorNotice error={mutation.error} />
          <button className="button secondary" onClick={() => query.refetch()}>
            Reload latest record
          </button>
        </>
      )}
      <section className="review-panel">
        <h2>Edit canonical metadata</h2>
        <label className="stack-form">
          Reason for changes (optional)
          <input
            value={reason}
            maxLength={2000}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <MetadataEditor
          key={data.revision}
          initial={data.fields}
          locks={data.locks}
          pending={mutation.isPending}
          onSave={(fields) =>
            mutation.mutate({
              method: "PATCH",
              body: {
                revision: data.revision,
                reason,
                patch: Object.fromEntries(
                  metadataKeys
                    .filter(
                      (key) =>
                        JSON.stringify(fields[key]) !==
                        JSON.stringify(data.fields[key]),
                    )
                    .map((key) => [key, fields[key]]),
                ),
              },
            })
          }
        />
      </section>
      <section className="review-panel">
        <h2>Look up source metadata</h2>
        <p>
          This sends only the identifier to Crossref, DataCite, or arXiv. Review
          source values below before applying them.
        </p>
        <form
          className="toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            setSourceId("");
            mutation.mutate({
              path: "/lookup",
              body: {
                revision: data.revision,
                identifier: identifier || data.fields.doi || data.fields.url,
              },
            });
          }}
        >
          <label className="stack-form">
            DOI or arXiv identifier
            <input
              value={identifier}
              placeholder={
                data.fields.doi || data.fields.url || "10.… or arXiv:…"
              }
              onChange={(event) => setIdentifier(event.target.value)}
            />
          </label>
          <button
            className="button primary"
            disabled={
              mutation.isPending ||
              !(identifier || data.fields.doi || data.fields.url)
            }
          >
            Look up source
          </button>
        </form>
      </section>
      {source && (
        <section className="review-panel">
          <h2>Compare and reconcile</h2>
          <label className="stack-form">
            Source assertion
            <select
              value={source.id}
              onChange={(event) => {
                setSourceId(event.target.value);
                setSelected([]);
                setKeep(false);
                setOverride(false);
              }}
            >
              {data.assertions.map((assertion) => (
                <option key={assertion.id} value={assertion.id}>
                  {assertion.source} ·{" "}
                  {new Date(assertion.createdAt).toLocaleString()}
                </option>
              ))}
            </select>
          </label>
          <p>
            {source.authoritative
              ? "Provider metadata"
              : "Unverified source snapshot"}{" "}
            {source.sourceUrl.startsWith("https://") && (
              <a href={source.sourceUrl} target="_blank" rel="noreferrer">
                Open source
              </a>
            )}
          </p>
          <div className="review-table-wrap">
            <table className="review-table">
              <thead>
                <tr>
                  <th>Apply</th>
                  <th>Field</th>
                  <th>Current value</th>
                  <th>Source value</th>
                </tr>
              </thead>
              <tbody>
                {metadataKeys
                  .filter((key) => key in source.metadata)
                  .map((key) => (
                    <tr
                      key={key}
                      className={
                        metadataEquivalent(
                          key,
                          data.fields[key],
                          source.metadata[key],
                        )
                          ? ""
                          : "field-difference"
                      }
                    >
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Apply ${metadataLabels[key]}`}
                          checked={selected.includes(key)}
                          onChange={(event) =>
                            setSelected(
                              event.target.checked
                                ? [...selected, key]
                                : selected.filter((field) => field !== key),
                            )
                          }
                        />
                      </td>
                      <th>
                        {metadataLabels[key]}
                        {data.locks.includes(key) && (
                          <small> · Protected</small>
                        )}
                      </th>
                      <td>{metadataValue(data.fields[key])}</td>
                      <td>{metadataValue(source.metadata[key])}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <label className="check-line">
            <input
              type="checkbox"
              checked={override}
              onChange={(event) => setOverride(event.target.checked)}
            />
            Allow selected source fields to replace my protected corrections
          </label>
          <label className="check-line">
            <input
              type="checkbox"
              checked={keep}
              onChange={(event) => setKeep(event.target.checked)}
            />
            Keep current values for remaining differences and record that
            decision
          </label>
          <button
            className="button primary"
            disabled={mutation.isPending}
            onClick={() =>
              mutation.mutate({
                path: "/reconcile",
                body: {
                  revision: data.revision,
                  assertionId: source.id,
                  fields: selected,
                  overrideLocks: override,
                  keepCurrent: keep,
                  reason,
                },
              })
            }
          >
            Apply selections and record review
          </button>
          <details>
            <summary>Original source data</summary>
            <pre>{JSON.stringify(source.raw, null, 2)}</pre>
          </details>
        </section>
      )}
      <section className="review-panel">
        <h2>Decision history</h2>
        {!data.decisions.length ? (
          <p>No field decisions yet.</p>
        ) : (
          data.decisions.map((decision) => (
            <article className="decision-row" key={decision.id}>
              <strong>
                {metadataLabels[decision.field as keyof MetadataFields] ??
                  decision.field}
              </strong>
              <span>
                {metadataValue(decision.before)} →{" "}
                {metadataValue(decision.after)}
              </span>
              <small>
                {decision.origin} · revision {decision.revision} ·{" "}
                {new Date(decision.createdAt).toLocaleString()}
                {decision.reason && ` · ${decision.reason}`}
              </small>
            </article>
          ))
        )}
      </section>
    </div>
  );
}
