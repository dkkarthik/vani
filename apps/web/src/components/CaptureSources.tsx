import { useQuery } from "@tanstack/react-query";
import type { CaptureResult } from "@vani/shared";

export function CaptureSources({ workId }: { workId: string }) {
  const sources = useQuery({
    queryKey: ["capture-sources", workId],
    queryFn: async () => {
      const response = await fetch(`/api/v1/works/${workId}/captures`);
      if (!response.ok) throw new Error("Could not load captured sources.");
      return response.json() as Promise<{ items: CaptureResult[] }>;
    },
  });
  if (sources.error)
    return <p role="status">Captured sources could not be loaded.</p>;
  if (!sources.data?.items.length) return null;
  return (
    <section className="capture-sources">
      <h3>Captured sources</h3>
      {sources.data.items.map((source) => (
        <article key={source.id}>
          <a href={source.sourceUrl} target="_blank" rel="noopener noreferrer">
            {new URL(source.sourceUrl).hostname} ↗
          </a>
          <small>
            {new Date(source.createdAt).toLocaleString()} ·{" "}
            {source.pdfStatus === "saved"
              ? "PDF saved"
              : source.pdfStatus === "failed"
                ? "Metadata saved; PDF unavailable"
                : source.pdfStatus === "pending"
                  ? "PDF capture pending"
                  : "Metadata saved"}
          </small>
          {source.pdfMessage && <p>{source.pdfMessage}</p>}
        </article>
      ))}
    </section>
  );
}
