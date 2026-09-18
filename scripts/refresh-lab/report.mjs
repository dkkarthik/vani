const norm = (s) =>
  String(s || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
const doi = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "")
    .trim();
const samePaper = (a, b) =>
  a.doi && b.doi
    ? doi(a.doi) === doi(b.doi)
    : Boolean(norm(a.title)) && norm(a.title) === norm(b.title);
export function makeReport(data) {
  const candidates = data.candidates.map((c) => ({
    ...c,
    knownMember: data.members.some(
      (m) => m.id === c.work_id || samePaper(c.paper, m),
    ),
    seedMatch: data.members.some(
      (m) =>
        data.focus.profile.anchors.some((a) => a.workId === m.id) &&
        (m.id === c.work_id || samePaper(c.paper, m)),
    ),
    retrievalReason: c.paths
      .map(
        (p) =>
          `${p.channel}: ${p.query || p.filter || p.discoveredVia || "citation expansion"}`,
      )
      .join("; "),
  }));
  const expected = data.expected.map((e) => {
    const matches = candidates.filter((c) =>
      e.doi && c.paper.doi
        ? doi(e.doi) === doi(c.paper.doi)
        : norm(e.title) === norm(c.paper.title),
    );
    const seed = data.members.some(
      (m) =>
        data.focus.profile.anchors.some((a) => a.workId === m.id) &&
        (e.doi && m.doi
          ? doi(e.doi) === doi(m.doi)
          : norm(e.title) === norm(m.title)),
    );
    return {
      ...e,
      seed,
      found: matches.length > 0,
      candidateIds: matches.map((c) => c.id),
    };
  });
  const evaluable = expected.filter((e) => !e.seed),
    latest = data.runs[0];
  return {
    ...data,
    candidates,
    expected,
    generatedAt: new Date().toISOString(),
    summary: {
      retrieved: candidates.length,
      seedMatches: candidates.filter((c) => c.seedMatch).length,
      newCandidateRecords: candidates.filter((c) => !c.knownMember).length,
      accepted: candidates.filter((c) => c.accepted).length,
      judged: candidates.filter((c) => c.feedback?.label).length,
      stageCounts: candidates.reduce(
        (a, c) => ({
          ...a,
          [`${c.stage}/${c.state}`]: (a[`${c.stage}/${c.state}`] || 0) + 1,
        }),
        {},
      ),
      expectedFound: evaluable.filter((e) => e.found).length,
      expectedTotal: evaluable.length,
    },
    limitations: [
      "Retrieved candidates are not automatically accepted collection members.",
      "New candidate records exclude matched existing members; unresolved preprint/publication versions may still be counted separately.",
      "Metadata-only candidates have no verified semantic relevance. Scores are not calibrated probabilities.",
      "Expected-paper matches use exact normalized DOI/title; unresolved versions may require manual review. This is not global literature recall.",
      ...(!data.focus.profile.anchors.length
        ? ["No explicit seed anchors are configured."]
        : []),
      ...(latest?.error ? [`Latest run error: ${latest.error}`] : []),
      ...(latest?.status === "paused"
        ? [
            "Refresh is paused. Fix the reported source/model issue and press refresh to resume.",
          ]
        : []),
    ],
  };
}
export function markdownReport(r) {
  const line = (s) => String(s || "").replace(/[\r\n]+/g, " ");
  return [
    `# Refresh review: ${line(r.collection.name)}`,
    `Generated: ${r.generatedAt}`,
    `Question: ${line(r.focus.profile.question)}`,
    `Public queries: ${r.focus.profile.publicQueries.map(line).join("; ")}`,
    "",
    `Retrieved records: ${r.summary.retrieved}; seed matches: ${r.summary.seedMatches}; new candidate records: ${r.summary.newCandidateRecords}; accepted: ${r.summary.accepted}; human-reviewed: ${r.summary.judged}`,
    `Expected-paper hits: ${r.summary.expectedFound}/${r.summary.expectedTotal} (seeds excluded).`,
    "",
    ...r.limitations.map((s) => "- " + s),
    "",
    "## Run diagnostics",
    "```json",
    JSON.stringify(
      r.runs.map((x) => ({
        id: x.id,
        status: x.status,
        phase: x.phase,
        error: x.error,
        counters: x.counters,
        coverage: x.coverage,
      })),
      null,
      2,
    ),
    "```",
    "",
    "## Candidates",
    ...r.candidates.flatMap((c, i) => [
      `### ${i + 1}. ${line(c.paper.title)}`,
      `ID: ${c.id}`,
      `DOI: ${line(c.paper.doi)}`,
      `Stage: ${c.stage}/${c.state}; proximity: ${c.proximity}`,
      `Existing collection paper: ${c.seedMatch ? "seed match" : c.knownMember ? "member match" : "not matched"}`,
      `Retrieved via: ${line(c.retrievalReason)}`,
      `Assessment: ${JSON.stringify(c.assessment)}`,
      `Human feedback: ${JSON.stringify(c.feedback)}`,
      "",
    ]),
    "## Expected or missed papers",
    ...r.expected.map(
      (e) =>
        `- ${line(e.title)} — ${e.seed ? "seed (excluded)" : e.found ? "retrieved" : "not retrieved"}: ${line(e.reason)}`,
    ),
    "",
  ].join("\n");
}

export function compareReports(before, after) {
  if (before.collection.id !== after.collection.id)
    throw Error("Compare snapshots of the same collection.");
  const key = (c) =>
    c.identity ||
    (c.paper.doi ? "doi:" + doi(c.paper.doi) : "title:" + norm(c.paper.title));
  const old = new Map(before.candidates.map((c) => [key(c), c]));
  const current = new Map(after.candidates.map((c) => [key(c), c]));
  return {
    collection: after.collection.name,
    before: before.generatedAt,
    after: after.generatedAt,
    focusChanged:
      JSON.stringify(before.focus.profile) !==
      JSON.stringify(after.focus.profile),
    expectedSetChanged:
      JSON.stringify(before.expected.map((e) => [e.title, e.doi, e.seed])) !==
      JSON.stringify(after.expected.map((e) => [e.title, e.doi, e.seed])),
    beforeSummary: before.summary,
    afterSummary: after.summary,
    newlyRetrieved: [...current]
      .filter(([k]) => !old.has(k))
      .map(([, c]) => ({ identity: key(c), title: c.paper.title })),
    noLongerPresent: [...old]
      .filter(([k]) => !current.has(k))
      .map(([, c]) => ({ identity: key(c), title: c.paper.title })),
    changed: [...current]
      .filter(
        ([k, c]) =>
          old.has(k) &&
          JSON.stringify([c.stage, c.state, c.proximity, c.feedback]) !==
            JSON.stringify([
              old.get(k).stage,
              old.get(k).state,
              old.get(k).proximity,
              old.get(k).feedback,
            ]),
      )
      .map(([k, c]) => ({
        identity: k,
        title: c.paper.title,
        before: {
          stage: old.get(k).stage,
          state: old.get(k).state,
          feedback: old.get(k).feedback,
        },
        after: { stage: c.stage, state: c.state, feedback: c.feedback },
      })),
    limitation:
      "Descriptive comparison only. Different focus, models or expected-paper sets are not a controlled quality experiment. No policy is updated.",
  };
}
