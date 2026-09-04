import type { FirstPass } from "@vani/shared";

export function FirstPassReport({ report }: { report?: FirstPass }) {
  if (!report)
    return (
      <p>
        First pass queued. A configured local model or API key is needed for
        synthesis.
      </p>
    );
  return (
    <section className="first-pass-report">
      <p className="eyebrow">
        Keshav first pass · {report.status.replaceAll("_", " ")}
      </p>
      <h3>One big novelty — provisional</h3>
      <p>{report.novelty}</p>
      <dl>
        {(
          [
            "category",
            "context",
            "correctness",
            "contributions",
            "clarity",
          ] as const
        ).map((key) => (
          <div key={key}>
            <dt>{key.charAt(0).toUpperCase() + key.slice(1)}</dt>
            <dd>{report[key]}</dd>
          </div>
        ))}
      </dl>
      <p>Coverage: {report.coverage.join(", ")}</p>
      {report.evidence.map((item, index) => (
        <blockquote key={index}>
          “{item.quote}”{" "}
          <a href={`/read/${item.workId}`}>{item.section} · source paper</a>
        </blockquote>
      ))}
      <ul>
        {report.limitations.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
      <small>
        {report.provider} · {new Date(report.createdAt).toLocaleString()}
      </small>
    </section>
  );
}
