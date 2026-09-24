import {
  externalPaperUrl,
  paperReference,
  type PaperReference,
} from "@vani/shared";

export function PaperCitation({
  paper,
  reference,
}: {
  paper: any;
  reference?: PaperReference;
}) {
  const ref = reference ?? paperReference(paper);
  const pdf =
    ref.pdfLinks.find(
      (p) =>
        p.kind === "local" &&
        /^\/api\/v1\/attachments\/[\da-f-]{36}\/content$/i.test(p.url),
    ) ??
    ref.pdfLinks.find((p) => p.kind === "source" && externalPaperUrl(p.url));
  const record = externalPaperUrl(ref.recordUrl);
  return (
    <div className="paper-citation">
      <p aria-label="Bibliographic citation">
        {ref.text}{" "}
        {ref.identifiers.map(
          (identifier) =>
            externalPaperUrl(identifier.url) && (
              <a
                key={identifier.url}
                href={identifier.url}
                target="_blank"
                rel="noreferrer"
              >
                {identifier.label}
              </a>
            ),
        )}
      </p>
      {!!ref.missing.length && (
        <small>
          Metadata incomplete: {ref.missing.join(", ")} unavailable.
        </small>
      )}
      <div className="paper-access">
        {pdf ? (
          <a
            className="button"
            href={pdf.url}
            target="_blank"
            rel="noreferrer"
            title={
              pdf.kind === "local"
                ? "Open the saved PDF"
                : "Open the source PDF; publisher access may be required"
            }
          >
            View PDF ({pdf.kind === "local" ? "local copy" : "source"})
          </a>
        ) : (
          <span>PDF link unavailable</span>
        )}
        {record && (
          <a href={record} target="_blank" rel="noreferrer">
            Paper record
          </a>
        )}
      </div>
    </div>
  );
}
