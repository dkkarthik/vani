import { test } from "node:test";
import assert from "node:assert/strict";
import { makeReport, markdownReport, compareReports } from "./report.mjs";
const input = () => ({
  collection: { id: "c", name: "Test" },
  focus: {
    profile: {
      question: "Robot learning",
      publicQueries: ["robot learning"],
      anchors: [{ workId: "seed" }],
    },
  },
  runs: [
    { status: "paused", phase: "ranking", error: "Local model unavailable" },
  ],
  members: [{ id: "seed", title: "Seed", doi: "10.1/seed" }],
  expected: [
    { title: "Seed", doi: "10.1/seed" },
    {
      title: "Expected",
      doi: "https://doi.org/10.1/PAPER",
      reason: "same task",
    },
    { title: "Missing", reason: "baseline" },
  ],
  invocations: [],
  candidates: [
    {
      id: "p",
      paper: { title: "Expected", doi: "10.1/paper" },
      stage: "D0",
      state: "pending",
      proximity: "unassessed",
      paths: [{ channel: "crossref", query: "robot learning" }],
      feedback: {},
      assessment: {},
      accepted: false,
    },
  ],
});
test("reports retrieved papers separately from admission and excludes seeds from expected coverage", () => {
  const r = makeReport(input());
  assert.equal(r.summary.retrieved, 1);
  assert.equal(r.summary.accepted, 0);
  assert.equal(r.summary.expectedFound, 1);
  assert.equal(r.summary.expectedTotal, 2);
  assert.equal(r.summary.judged, 0);
  assert.match(r.limitations.join(" "), /paused/);
  assert.match(markdownReport(r), /crossref: robot learning/);
});
test("human review and stages survive snapshots; incompatible DOIs are not title matches", () => {
  const data = input();
  data.candidates[0].feedback = {
    label: "related",
    reason: "same control task",
  };
  data.expected[1].doi = "10.1/other";
  const r = makeReport(data);
  assert.equal(r.summary.expectedFound, 0);
  assert.equal(r.summary.judged, 1);
  assert.equal(r.summary.stageCounts["D0/pending"], 1);
  assert.match(markdownReport(r), /same control task/);
  assert.match(markdownReport(r), /Local model unavailable/);
});

test("snapshot comparison separates new retrieval from feedback and flags a changed evaluation set", () => {
  const before = makeReport(input()),
    data = input();
  data.candidates[0].feedback = { label: "related" };
  data.expected.push({ title: "Additional expected", reason: "baseline" });
  const after = makeReport(data),
    comparison = compareReports(before, after);
  assert.equal(comparison.newlyRetrieved.length, 0);
  assert.equal(comparison.changed.length, 1);
  assert.equal(comparison.expectedSetChanged, true);
  assert.throws(
    () => compareReports(before, { ...after, collection: { id: "different" } }),
    /same collection/,
  );
});

test("rediscovered uploaded seeds are visible but excluded from new candidate counts", () => {
  const data = input();
  data.members[0].doi = null;
  data.candidates.push({
    ...data.candidates[0],
    id: "seed-hit",
    paper: { title: "SEED", doi: "10.1/published-seed" },
  });
  const r = makeReport(data);
  assert.equal(r.summary.retrieved, 2);
  assert.equal(r.summary.seedMatches, 1);
  assert.equal(r.summary.newCandidateRecords, 1);
  assert.equal(r.candidates[1].seedMatch, true);
  assert.match(markdownReport(r), /Existing collection paper: seed match/);
  data.members[0].doi = "10.1/different";
  assert.equal(makeReport(data).summary.seedMatches, 0);
});
