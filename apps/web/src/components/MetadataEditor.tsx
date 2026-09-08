import { useState } from "react";
import { MetadataFields, metadataKeys, metadataLabels } from "@vani/shared";
import { ErrorNotice } from "./ui";
export function MetadataEditor({
  initial,
  locks = [],
  pending,
  onSave,
}: {
  initial: MetadataFields;
  locks?: string[];
  pending: boolean;
  onSave: (fields: MetadataFields) => void;
}) {
  const [fields, setFields] = useState(initial),
    [error, setError] = useState<unknown>();
  return (
    <form
      className="stack-form metadata-form"
      onSubmit={(event) => {
        event.preventDefault();
        const result = MetadataFields.safeParse(fields);
        if (!result.success) {
          setError(
            new Error(
              result.error.issues
                .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                .join("; "),
            ),
          );
          return;
        }
        setError(undefined);
        onSave(result.data);
      }}
    >
      {metadataKeys.map((key) =>
        key === "authors" || key === "editors" ? (
          <fieldset key={key}>
            <legend>
              {metadataLabels[key]} {locks.includes(key) && "· Your correction"}
            </legend>
            {fields[key].map((name, index) => (
              <div className="name-row" key={index}>
                <label>
                  Given names
                  <input
                    value={name.given}
                    onChange={(event) =>
                      setFields({
                        ...fields,
                        [key]: fields[key].map((value, i) =>
                          i === index
                            ? { ...value, given: event.target.value }
                            : value,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Family or organization name
                  <input
                    required
                    value={name.family}
                    onChange={(event) =>
                      setFields({
                        ...fields,
                        [key]: fields[key].map((value, i) =>
                          i === index
                            ? { ...value, family: event.target.value }
                            : value,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  ORCID
                  <input
                    value={name.orcid ?? ""}
                    onChange={(event) =>
                      setFields({
                        ...fields,
                        [key]: fields[key].map((value, i) =>
                          i === index
                            ? { ...value, orcid: event.target.value || null }
                            : value,
                        ),
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="button secondary"
                  disabled={!index}
                  aria-label={`Move ${key} ${index + 1} up`}
                  onClick={() => {
                    const list = [...fields[key]];
                    [list[index - 1], list[index]] = [
                      list[index]!,
                      list[index - 1]!,
                    ];
                    setFields({ ...fields, [key]: list });
                  }}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="button secondary"
                  aria-label={`Remove ${key} ${index + 1}`}
                  onClick={() =>
                    setFields({
                      ...fields,
                      [key]: fields[key].filter((_, i) => i !== index),
                    })
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="button secondary"
              onClick={() =>
                setFields({
                  ...fields,
                  [key]: [...fields[key], { given: "", family: "" }],
                })
              }
            >
              Add {key === "authors" ? "author" : "editor"}
            </button>
          </fieldset>
        ) : (
          <label
            key={key}
            className={
              key === "title" || key === "abstract" ? "wide-field" : ""
            }
          >
            {metadataLabels[key]}{" "}
            {locks.includes(key) && <small>· Your correction</small>}
            {key === "abstract" ? (
              <textarea
                rows={4}
                value={fields[key]}
                onChange={(event) =>
                  setFields({ ...fields, [key]: event.target.value })
                }
              />
            ) : (
              <input
                required={[
                  "title",
                  "publicationType",
                  "manifestationType",
                ].includes(key)}
                type={key === "year" ? "number" : "text"}
                value={fields[key] ?? ""}
                onChange={(event) =>
                  setFields({
                    ...fields,
                    [key]:
                      key === "year"
                        ? event.target.value
                          ? Number(event.target.value)
                          : null
                        : key === "doi"
                          ? event.target.value || null
                          : event.target.value,
                  })
                }
              />
            )}
          </label>
        ),
      )}
      <div className="wide-field">
        {Boolean(error) && <ErrorNotice error={error} />}
        <button className="button primary" disabled={pending}>
          {pending ? "Saving…" : "Save metadata"}
        </button>
      </div>
    </form>
  );
}
export function metadataValue(value: unknown): string {
  if (Array.isArray(value))
    return (
      value
        .map((name) =>
          typeof name === "object"
            ? `${name.given ?? ""} ${name.family ?? ""}`.trim()
            : String(name),
        )
        .join("; ") || "—"
    );
  return value == null || value === "" ? "—" : String(value);
}
