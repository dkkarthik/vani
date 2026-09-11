import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DiscoverySeed } from "@vani/shared";
import { api } from "../api";
import { ErrorNotice } from "./ui";

export function CollectionSeedForm({
  initial,
  onSave,
  pending,
  disabled = false,
  error,
}: {
  initial?: DiscoverySeed | null;
  onSave: (seed: DiscoverySeed) => void;
  pending: boolean;
  disabled?: boolean;
  error: Error | null;
}) {
  const [mode, setMode] = useState<"topic" | "papers">(
    initial?.mode ?? "topic",
  );
  const [topic, setTopic] = useState(initial?.topic ?? "");
  const [workIds, setWorkIds] = useState<string[]>(initial?.workIds ?? []);
  const [timezone, setTimezone] = useState(
    initial?.timezone ?? "America/New_York",
  );
  const [hour, setHour] = useState(initial?.hour ?? 7);
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [search, setSearch] = useState("");
  const library = useQuery({
    queryKey: ["seed-library", search],
    queryFn: () => api.works(undefined, search || undefined),
  });
  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          mode,
          topic,
          workIds: mode === "papers" ? workIds : [],
          timezone,
          hour,
          enabled,
        });
      }}
    >
      <label>
        Seed collection from
        <select
          value={mode}
          onChange={(event) => {
            setMode(event.target.value as typeof mode);
            setTopic("");
          }}
        >
          <option value="topic">A topic or research question</option>
          <option value="papers">One or more papers</option>
        </select>
      </label>
      {mode === "papers" && (
        <>
          <p>
            Select up to 10 papers. VANI will synthesize a moderately narrow
            topic from their titles and abstracts. Add PDFs or paper links
            directly from the collection. Uploaded seed papers also contribute
            local text excerpts.
          </p>
          <label>
            Find seed papers
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Filter your library"
            />
          </label>
          <div className="seed-paper-list">
            {library.data?.items
              .filter((work) => work.recordKind !== "demo_fixture")
              .map((work) => (
                <label key={work.id}>
                  <input
                    type="checkbox"
                    checked={workIds.includes(work.id)}
                    disabled={
                      !workIds.includes(work.id) && workIds.length >= 10
                    }
                    onChange={() =>
                      setWorkIds((ids) =>
                        ids.includes(work.id)
                          ? ids.filter((id) => id !== work.id)
                          : [...ids, work.id],
                      )
                    }
                  />
                  {work.title}
                </label>
              ))}
          </div>
          <small>
            {workIds.length} seeds selected ·{" "}
            <a href="/discover">Find / import papers</a>
          </small>
          {library.error && <ErrorNotice error={library.error} />}
        </>
      )}
      <label>
        {mode === "topic" ? "Topic" : "Focused topic (optional override)"}
        <textarea
          required={mode === "topic"}
          minLength={2}
          maxLength={500}
          rows={3}
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          placeholder={
            mode === "topic"
              ? "e.g. Uncertainty-aware active mapping for subterranean robots"
              : "Leave empty to synthesize from the seed papers"
          }
        />
      </label>
      {mode === "papers" && (
        <button
          type="button"
          className="button secondary"
          onClick={() => setTopic("")}
        >
          Infer a revised focus from all selected seeds
        </button>
      )}
      <label>
        Morning search hour
        <select
          value={hour}
          onChange={(event) => setHour(Number(event.target.value))}
        >
          {Array.from({ length: 12 }, (_, i) => (
            <option key={i} value={i}>
              {String(i).padStart(2, "0")}:00
            </option>
          ))}
        </select>
      </label>
      <label>
        Timezone
        <input
          required
          value={timezone}
          onChange={(event) => setTimezone(event.target.value)}
          placeholder="America/New_York"
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />{" "}
        Enable daily discovery
      </label>
      <small>
        Searches run while the API server is running, with catch-up after
        downtime. Seed focus synthesis uses your local model; uploaded PDFs stay
        local.
      </small>
      {error && <ErrorNotice error={error} />}
      <button
        className="button primary"
        disabled={disabled || pending || (mode === "papers" && !workIds.length)}
      >
        {pending ? "Preparing collection…" : "Save and build collection"}
      </button>
    </form>
  );
}
