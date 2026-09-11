import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "../api";
import { ErrorNotice } from "./ui";
export function CollectionKeywords({ id }: { id: string }) {
  const [word, setWord] = useState(""),
    qc = useQueryClient();
  const focus = useQuery({
    queryKey: ["collection-keywords", id],
    queryFn: () =>
      request<{ keywords: string[]; version: number; edited: boolean }>(
        `/collections/${id}/keywords`,
      ),
  });
  const edit = useMutation({
    mutationFn: (keywords: string[]) =>
      request(`/collections/${id}/keywords`, {
        method: "PATCH",
        body: JSON.stringify({ version: focus.data!.version, keywords }),
      }),
    onSuccess: async () => {
      setWord("");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["collection-keywords", id] }),
        qc.invalidateQueries({ queryKey: ["collections"] }),
        qc.invalidateQueries({ queryKey: ["collection-members", id] }),
      ]);
    },
  });
  return (
    <section className="review-panel">
      <h2>Collection keywords</h2>
      <p>
        These keywords drive automatic searches. Removing one stops using it as
        a reason to add papers; papers matching the remaining keywords can still
        appear. Existing papers stay in the collection.
      </p>
      {focus.error && <ErrorNotice error={focus.error} />}{" "}
      {edit.error && <ErrorNotice error={edit.error} />}
      {focus.data && (
        <>
          <div
            className="toolbar"
            style={{ justifyContent: "flex-start", flexWrap: "wrap", gap: 8 }}
          >
            {focus.data.keywords.map((k) => (
              <button
                className="button secondary"
                aria-label={"Remove keyword " + k}
                key={k}
                disabled={edit.isPending}
                onClick={() =>
                  edit.mutate(focus.data!.keywords.filter((w) => w !== k))
                }
              >
                {k} ×
              </button>
            ))}
          </div>
          {!focus.data.keywords.length && (
            <p>
              No active keywords. Add keywords and enable discovery to start
              searching.
            </p>
          )}
          <form
            className="toolbar"
            onSubmit={(e) => {
              e.preventDefault();
              if (word.trim())
                edit.mutate([...focus.data!.keywords, word.trim()]);
            }}
          >
            <label className="k-field">
              <span>Add keyword</span>
              <input
                aria-label="Add collection keyword"
                value={word}
                onChange={(e) => setWord(e.target.value)}
                maxLength={80}
              />
            </label>
            <button
              className="button secondary"
              disabled={
                edit.isPending ||
                word.trim().length < 2 ||
                focus.data.keywords.length >= 30
              }
            >
              Add keyword
            </button>
          </form>
          <small>
            {focus.data.edited
              ? "Your edited keyword list is preserved when the collection focus changes."
              : "Keywords derived from the collection focus."}{" "}
            Removing all keywords pauses discovery.
          </small>
        </>
      )}
    </section>
  );
}
