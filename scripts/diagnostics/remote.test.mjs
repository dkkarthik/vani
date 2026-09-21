/* global Response */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collect, summarize } from "./remote.mjs";
test("distinguishes membership, candidates, stage counts and failure reasons", () => {
  const s = summarize(
    {
      focus: { version: 2, profile: { mode: "review" } },
      counts: [{ stage: "D2", state: "failed", count: 1 }],
      candidates: [
        { title: "Paper", state: "failed", last_error: "bad quote" },
      ],
      runs: [],
    },
    { items: [{ id: "seed", title: "Seed" }] },
  );
  assert.equal(s.members.length, 1);
  assert.equal(s.candidatesCaptured, 1);
  assert.equal(s.errors["bad quote"], 1);
  assert.match(s.admission, /explicit acceptance/);
});
test("collects all pages using only GET and writes private local artifacts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vani-diag-"));
  const calls = [];
  const core = {
    focus: { profile: { mode: "review" } },
    counts: [{ count: 2 }],
    candidates: [{ id: "one", title: "One" }],
    runs: [],
  };
  try {
    const result = await collect(
      "http://fixture:3000",
      directory,
      async (url, opts) => {
        assert.equal(opts.method, "GET");
        calls.push(url.pathname + url.search);
        const path = url.pathname;
        const body = path.endsWith("/collections")
          ? { items: [{ id: "abc", name: "Fixture" }] }
          : path.endsWith("/members")
            ? { items: [] }
            : path.endsWith("/core")
              ? {
                  ...core,
                  candidates: url.search
                    ? [{ id: "two", title: "Two" }]
                    : core.candidates,
                }
              : {};
        return Response.json(body);
      },
    );
    assert.equal(result.collections[0].candidatesCaptured, 2);
    assert.equal(result.collections[0].complete, true);
    assert.ok(calls.includes("/api/v1/collections/abc/core?offset=1"));
    assert.equal(
      JSON.parse(await readFile(join(directory, "summary.json"))).readOnly,
      true,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
