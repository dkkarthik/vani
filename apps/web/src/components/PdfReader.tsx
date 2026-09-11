import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "./pdf-text-layer.css";
import type { PassageSelector } from "@vani/shared";
import { request } from "../api";
import { ErrorNotice } from "./ui";
GlobalWorkerOptions.workerSrc = workerUrl;
export function PdfReader({
  attachmentId,
  initialPage,
  focus,
}: {
  attachmentId: string;
  initialPage?: number;
  focus?: any;
}) {
  const client = useQueryClient(),
    canvas = useRef<HTMLCanvasElement>(null),
    layer = useRef<HTMLDivElement>(null),
    frame = useRef<HTMLDivElement>(null),
    restored = useRef(false),
    drag = useRef<{ x: number; y: number } | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy>(),
    [page, setPage] = useState(initialPage ?? 1),
    [zoom, setZoom] = useState(1),
    [size, setSize] = useState({ width: 612, height: 792 }),
    [error, setError] = useState<unknown>(),
    [search, setSearch] = useState(""),
    [mode, setMode] = useState<"text" | "area">("text"),
    [selection, setSelection] = useState<PassageSelector | null>(null),
    [comment, setComment] = useState(""),
    [tags, setTags] = useState(""),
    [type, setType] = useState("highlight"),
    [notice, setNotice] = useState("");
  const data = useQuery({
    queryKey: ["document", attachmentId],
    queryFn: () => request<any>(`/attachments/${attachmentId}/document`),
  });
  const mutation = useMutation({
    mutationFn: ({
      path,
      body,
      method = "POST",
    }: {
      path: string;
      body?: unknown;
      method?: string;
    }) =>
      request<any>(path, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["document", attachmentId] });
      client.invalidateQueries({ queryKey: ["evidence"] });
    },
  });
  useEffect(() => {
    const task = getDocument({
      url: `/api/v1/attachments/${attachmentId}/content`,
    });
    let live = true;
    task.promise
      .then((document) => {
        if (live) setPdf(document);
      })
      .catch((e) => {
        if (live) setError(e);
      });
    return () => {
      live = false;
      void task.destroy();
    };
  }, [attachmentId]);
  useEffect(() => {
    if (!data.data || restored.current) return;
    restored.current = true;
    if (!initialPage) setPage(data.data.position?.page ?? 1);
    setZoom(data.data.position?.zoom ?? 1);
    if (!data.data.index)
      mutation.mutate({ path: `/attachments/${attachmentId}/index` });
  }, [data.data, attachmentId, initialPage]);
  useEffect(() => {
    if (focus?.selector.page) setPage(focus.selector.page);
    else if (initialPage) setPage(initialPage);
    setSelection(null);
  }, [focus?.id, initialPage]);
  useEffect(() => {
    if (!pdf || !canvas.current || !layer.current) return;
    let cancelled = false,
      render: any,
      textLayer: TextLayer | undefined;
    setSelection(null);
    (async () => {
      if (page > pdf.numPages)
        throw new Error(
          "The saved page is unavailable in this document. Open the original or choose a valid page.",
        );
      const p = await pdf.getPage(page);
      if (cancelled) return;
      const viewport = p.getViewport({ scale: zoom });
      setSize({ width: viewport.width, height: viewport.height });
      const c = canvas.current!;
      c.width = viewport.width;
      c.height = viewport.height;
      layer.current!.replaceChildren();
      frame.current?.style.setProperty("--scale-factor", String(zoom));
      frame.current?.style.setProperty("--total-scale-factor", String(zoom));
      render = p.render({ canvas: c, viewport });
      await render.promise;
      if (cancelled) return;
      textLayer = new TextLayer({
        textContentSource: await p.getTextContent(),
        container: layer.current!,
        viewport,
      });
      await textLayer.render();
      setError(undefined);
    })().catch((e) => {
      if (!cancelled) setError(e);
    });
    return () => {
      cancelled = true;
      render?.cancel();
      textLayer?.cancel();
    };
  }, [pdf, page, zoom]);
  useEffect(() => {
    if (!restored.current || !pdf || page > pdf.numPages) return;
    const timer = setTimeout(
      () =>
        request(`/attachments/${attachmentId}/position`, {
          method: "PUT",
          body: JSON.stringify({ page, zoom }),
        }).catch(setError),
      350,
    );
    return () => clearTimeout(timer);
  }, [attachmentId, page, zoom, pdf]);
  const hash = data.data?.attachment.object_hash;
  const rect = (r: DOMRect) => {
    const b = frame.current!.getBoundingClientRect();
    const x = Math.max(0, (r.left - b.left) / b.width),
      y = Math.max(0, (r.top - b.top) / b.height);
    return {
      x,
      y,
      width: Math.min(1 - x, r.width / b.width),
      height: Math.min(1 - y, r.height / b.height),
    };
  };
  const selectText = () => {
    if (mode !== "text" || !hash) return;
    const s = window.getSelection();
    if (
      !s?.rangeCount ||
      !s.toString().trim() ||
      !frame.current?.contains(s.anchorNode) ||
      !frame.current.contains(s.focusNode)
    )
      return;
    const range = s.getRangeAt(0),
      rects = Array.from(range.getClientRects())
        .map(rect)
        .filter((r) => r.width > 0 && r.height > 0);
    if (!rects.length) return;
    setSelection({ hash, page, quote: s.toString(), rects });
    setType("highlight");
  };
  const hits =
    data.data?.index?.pages.filter(
      (p: any) =>
        search.trim() && p.text.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  const annotations = data.data?.annotations ?? [];
  const overlay = (r: any, key: string, color: string, active = false) => (
    <span
      key={key}
      className={active ? "pdf-mark active" : "pdf-mark"}
      style={{
        left: r.x * 100 + "%",
        top: r.y * 100 + "%",
        width: r.width * 100 + "%",
        height: r.height * 100 + "%",
        backgroundColor: color,
      }}
    />
  );
  return (
    <section className="pdf-reader">
      <div className="pdf-controls">
        <button
          className="button secondary"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          Previous page
        </button>
        <label>
          Page
          <input
            aria-label="PDF page"
            type="number"
            min={1}
            max={pdf?.numPages ?? 2000}
            value={page}
            onChange={(e) =>
              setPage(
                Math.max(
                  1,
                  Math.min(pdf?.numPages ?? 2000, Number(e.target.value) || 1),
                ),
              )
            }
          />
        </label>
        <span>of {pdf?.numPages ?? "…"}</span>
        <button
          className="button secondary"
          disabled={!pdf || page >= pdf.numPages}
          onClick={() => setPage(page + 1)}
        >
          Next page
        </button>
        <label>
          Zoom
          <select
            aria-label="Zoom"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          >
            {[0.5, 0.75, 1, 1.25, 1.5, 2, 3].map((z) => (
              <option key={z} value={z}>
                {Math.round(z * 100)}%
              </option>
            ))}
          </select>
        </label>
        <a
          className="button secondary"
          href={`/api/v1/attachments/${attachmentId}/content`}
          target="_blank"
          rel="noreferrer"
        >
          Open original PDF
        </a>
      </div>
      {Boolean(error || data.error || mutation.error) && (
        <ErrorNotice error={error || data.error || mutation.error} />
      )}
      {focus && (
        <p
          className={
            focus.anchor.status === "exact" ? "anchor-exact" : "review-warnings"
          }
        >
          Passage anchor: {focus.anchor.status} — {focus.anchor.reason}
        </p>
      )}
      <div className="pdf-controls">
        <label>
          Search this PDF
          <input value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <span>{hits.length} matching pages</span>
        <button
          className="button secondary"
          disabled={mutation.isPending}
          onClick={() =>
            mutation.mutate({ path: `/attachments/${attachmentId}/index` })
          }
        >
          Retry text extraction
        </button>
        <span>
          Text:{" "}
          {data.data?.index?.state ??
            (mutation.isPending ? "indexing" : "not indexed")}
        </span>
      </div>
      {data.data?.index?.error && (
        <p className="review-warnings">{data.data.index.error}</p>
      )}
      {search && (
        <div className="pdf-hits">
          {hits.slice(0, 100).map((hit: any) => (
            <button
              className="button secondary"
              key={hit.page}
              onClick={() => setPage(hit.page)}
            >
              Page {hit.page}:{" "}
              {hit.text.slice(
                Math.max(
                  0,
                  hit.text.toLowerCase().indexOf(search.toLowerCase()) - 40,
                ),
                hit.text.toLowerCase().indexOf(search.toLowerCase()) + 120,
              )}
            </button>
          ))}
        </div>
      )}
      <div className="pdf-controls">
        <button
          className={mode === "text" ? "button primary" : "button secondary"}
          onClick={() => setMode("text")}
        >
          Select text
        </button>
        <button
          className={mode === "area" ? "button primary" : "button secondary"}
          onClick={() => setMode("area")}
        >
          Select area
        </button>
        <span>
          {mode === "area"
            ? "Drag a rectangle over the page."
            : "Select a passage, then save a highlight or comment."}
        </span>
      </div>
      <div className="pdf-scroll">
        <div
          className="pdf-page-frame"
          ref={frame}
          style={{ width: size.width, height: size.height }}
          onMouseUp={selectText}
        >
          <canvas ref={canvas} aria-label={`PDF page ${page}`} />
          <div className="textLayer" ref={layer} />
          <div className="pdf-marks">
            {annotations
              .filter((a: any) => a.page_start === page)
              .flatMap((a: any) =>
                a.selector.rects.map((r: any, i: number) =>
                  overlay(r, a.id + i, a.color, a.id === focus?.id),
                ),
              )}
            {selection?.rects.map((r, i) =>
              overlay(r, "selection" + i, "#4aafd7", true),
            )}
          </div>
          {mode === "area" && (
            <div
              className="area-selector"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                const b = frame.current!.getBoundingClientRect();
                drag.current = {
                  x: (e.clientX - b.left) / b.width,
                  y: (e.clientY - b.top) / b.height,
                };
                setSelection(null);
              }}
              onPointerMove={(e) => {
                if (!drag.current || !hash) return;
                const b = frame.current!.getBoundingClientRect(),
                  x = Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)),
                  y = Math.max(0, Math.min(1, (e.clientY - b.top) / b.height)),
                  start = drag.current;
                setSelection({
                  hash,
                  page,
                  quote: "",
                  rects: [
                    {
                      x: Math.min(x, start.x),
                      y: Math.min(y, start.y),
                      width: Math.abs(x - start.x),
                      height: Math.abs(y - start.y),
                    },
                  ],
                });
                setType("area");
              }}
              onPointerUp={() => {
                drag.current = null;
              }}
            />
          )}
        </div>
      </div>
      {selection && (
        <form
          className="review-panel stack-form"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate(
              {
                path: `/attachments/${attachmentId}/annotations`,
                body: {
                  type,
                  body: comment,
                  tags: tags
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean),
                  selector: selection,
                },
              },
              {
                onSuccess: () => {
                  setSelection(null);
                  setComment("");
                  setNotice("Annotation saved.");
                },
              },
            );
          }}
        >
          <h3>Save selected evidence</h3>
          <blockquote>{selection.quote || "Area selection"}</blockquote>
          <label>
            Annotation type
            <select
              aria-label="Annotation type"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              {(selection.quote
                ? ["highlight", "comment"]
                : ["area", "comment"]
              ).map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            Comment
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </label>
          <label>
            Evidence tags (comma separated)
            <input value={tags} onChange={(e) => setTags(e.target.value)} />
          </label>
          <button
            className="button primary"
            disabled={mutation.isPending || !data.data?.index?.page_count}
          >
            Save annotation
          </button>
        </form>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="review-panel">
        <h3>Annotations in this document</h3>
        {annotations.map((a: any) => (
          <article className="decision-row" key={a.id}>
            <Link to={`/passages/${a.id}`}>
              Page {a.page_start} · {a.annotation_type}
            </Link>
            <blockquote>{a.selector.quote}</blockquote>
            <p>{a.body_markdown}</p>
            <div>
              <button
                className="button secondary"
                onClick={() => {
                  navigator.clipboard
                    .writeText(new URL("/passages/" + a.id, location.href).href)
                    .then(() => setNotice("Passage link copied."))
                    .catch(setError);
                }}
              >
                Copy passage link
              </button>
              <button
                className="button secondary"
                onClick={() =>
                  mutation.mutate(
                    { path: `/passages/${a.id}/note` },
                    { onSuccess: () => setNotice("Linked note created.") },
                  )
                }
              >
                Create linked note
              </button>
              <Link className="button secondary" to="/evidence">
                Edit in evidence workspace
              </Link>
              <button
                className="button secondary"
                onClick={() =>
                  mutation.mutate({
                    path: `/annotations/${a.id}`,
                    method: "DELETE",
                    body: { revision: a.version },
                  })
                }
              >
                Delete annotation
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
