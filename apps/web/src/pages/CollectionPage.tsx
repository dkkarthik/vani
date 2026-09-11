import { AddCollectionPaper } from "../components/AddCollectionPaper";
import { request } from "../api";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CollectionWork, DiscoverySeed } from "@vani/shared";
import { Download, FolderPlus, Inbox, Search } from "lucide-react";
import { api } from "../api";
import { useWorkspace } from "../context";
import {
  EmptyState,
  ErrorNotice,
  Loading,
  Modal,
  PageHeader,
  VerificationBadge,
} from "../components/ui";
import { CollectionSeedForm } from "../components/CollectionSeedForm";
import { FirstPassReport } from "../components/FirstPassReport";

export function CollectionPage() {
  const client = useQueryClient();
  const { collectionId, setCollectionId, selected, toggle } = useWorkspace();
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showSeed, setShowSeed] = useState(false);
  const [name, setName] = useState("");
  const [report, setReport] = useState<CollectionWork>();
  const [onlyNew, setOnlyNew] = useState(false);
  // Preserve NEW badges for this visit after acknowledging their successful display.
  const visit = useRef<{
    id?: string;
    newIds: Set<string>;
    acknowledged: Set<string>;
  }>({ newIds: new Set(), acknowledged: new Set() });
  if (visit.current.id !== collectionId)
    visit.current = {
      id: collectionId,
      newIds: new Set(),
      acknowledged: new Set(),
    };
  const collections = useQuery({
    queryKey: ["collections"],
    queryFn: api.collections,
    refetchInterval: 15000,
  });
  const works = useQuery({
    queryKey: ["collection-members", collectionId],
    queryFn: () => api.collectionMembers(collectionId!),
    enabled: Boolean(collectionId),
    refetchInterval: 15000,
  });
  const active = collections.data?.items.find(
    (collection) => collection.id === collectionId,
  );
  if (!works.isFetching)
    for (const work of works.data?.items ?? [])
      if (work.isNew) visit.current.newIds.add(work.id);
  const filtered = (works.data?.items ?? []).filter(
    (work) =>
      (!onlyNew || visit.current.newIds.has(work.id)) &&
      (work.title.toLowerCase().includes(search.toLowerCase()) ||
        work.authors.some((author) =>
          author.family.toLowerCase().includes(search.toLowerCase()),
        )),
  );
  const visibleIds = filtered.map((work) => work.id).join(",");
  useEffect(() => {
    if (!collectionId || !visibleIds || works.isFetching) return;
    const state = visit.current;
    const ids = visibleIds
      .split(",")
      .filter((id) => !state.acknowledged.has(id));
    if (!ids.length) return;
    const acknowledge = () => {
      if (document.visibilityState === "hidden") return;
      ids.forEach((id) => state.acknowledged.add(id));
      void api
        .seen(collectionId, ids)
        .then(() => client.invalidateQueries({ queryKey: ["collections"] }))
        .catch(() => ids.forEach((id) => state.acknowledged.delete(id)));
    };
    acknowledge();
    document.addEventListener("visibilitychange", acknowledge);
    return () => document.removeEventListener("visibilitychange", acknowledge);
  }, [collectionId, visibleIds, works.dataUpdatedAt, works.isFetching, client]);
  const save = useMutation({
    mutationFn: async (seed: DiscoverySeed) => {
      let id = collectionId;
      if (showCreate) {
        const created = await api.createCollection({ name: name.trim() });
        id = created.id;
        setCollectionId(id);
        setShowCreate(false);
        setShowSeed(true);
      }
      if (!id) throw new Error("Choose a collection first");
      return api.configureDiscovery(id, seed);
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["collections"] });
      client.invalidateQueries({ queryKey: ["collection-members"] });
      setShowSeed(false);
    },
    onError: () => client.invalidateQueries({ queryKey: ["collections"] }),
  });
  const createEmpty = useMutation({
    mutationFn: () => api.createCollection({ name: name.trim() }),
    onSuccess: async (c) => {
      setCollectionId(c.id);
      setShowCreate(false);
      setShowSeed(false);
      await client.invalidateQueries({ queryKey: ["collections"] });
    },
  });
  const enrichmentRetry = useMutation({
    mutationFn: (id: string) =>
      request(`/works/${id}/enrichment/retry`, { method: "POST", body: "{}" }),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["collection-members"] }),
  });
  const refresh = useMutation({
    mutationFn: () => api.refreshCollection(collectionId!),
    onSuccess: () => client.invalidateQueries({ queryKey: ["collections"] }),
  });
  const retry = useMutation({
    mutationFn: (workId: string) => api.retryFirstPass(collectionId!, workId),
    onSuccess: () => {
      setReport(undefined);
      client.invalidateQueries({ queryKey: ["collection-members"] });
    },
  });
  const status = useMutation({
    mutationFn: ({ workId, value }: { workId: string; value: string }) =>
      api.updateStatus(collectionId!, workId, value),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: ["collection-members", collectionId],
      }),
  });
  async function exportCollection() {
    if (!collectionId) return;
    const response = await api.exportBibtex(collectionId);
    if (!response.ok) return;
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = `${active?.name ?? "vani"}.bib`;
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="page collection-page">
      <PageHeader
        eyebrow="Research workspace"
        title={active?.name ?? "Collections"}
        description={
          active?.description ||
          "A living collection of related papers and evidence-backed first passes."
        }
        actions={
          <>
            <button
              className="button secondary"
              onClick={() => {
                setName("");
                save.reset();
                setShowCreate(true);
              }}
            >
              <FolderPlus size={16} />
              New collection
            </button>
            <button
              className="button primary"
              disabled={!collectionId}
              onClick={exportCollection}
            >
              <Download size={16} />
              Export BibTeX
            </button>
          </>
        }
      />
      {collectionId && (
        <section className="discovery-summary">
          <div>
            <strong>
              {active?.discovery?.topic || "Seed this collection"}
            </strong>
            <p>
              {active?.discovery
                ? `${active.discovery.enabled ? "Daily" : "Paused"} · ${String(active.discovery.hour).padStart(2, "0")}:00 ${active.discovery.timezone} · seeded from ${active.discovery.mode}`
                : "Choose a topic or seed papers to start daily discovery."}
            </p>
            <small>
              Last search:{" "}
              {active?.lastDiscoveryAt
                ? new Date(active.lastDiscoveryAt).toLocaleString()
                : "Not yet"}{" "}
              · Next:{" "}
              {active?.discovery?.enabled && active.nextDiscoveryAt
                ? new Date(active.nextDiscoveryAt).toLocaleString()
                : "Not scheduled"}
            </small>
            {active?.discovery?.topicNotice && (
              <p role="status">{active.discovery.topicNotice}</p>
            )}
            {active?.discoveryError && (
              <p role="alert">{active.discoveryError}</p>
            )}
          </div>
          <button
            className="button secondary"
            onClick={() => {
              save.reset();
              setShowSeed(true);
            }}
          >
            {active?.discovery ? "Edit discovery" : "Configure discovery"}
          </button>
          <button
            className="button secondary"
            disabled={!active?.discovery?.enabled || refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            Search now
          </button>
        </section>
      )}
      {collectionId && active?.collectionType !== "saved_search" && (
        <AddCollectionPaper
          key={collectionId}
          collectionId={collectionId}
          onSeed={() => {
            save.reset();
            setShowSeed(true);
          }}
        />
      )}
      {enrichmentRetry.error && <ErrorNotice error={enrichmentRetry.error} />}
      {refresh.isSuccess && (
        <p role="status">Search queued; the worker checks every minute.</p>
      )}
      {refresh.error && <ErrorNotice error={refresh.error} />}{" "}
      {status.error && <ErrorNotice error={status.error} />}
      <div className="stats-row">
        <div>
          <strong>{active?.memberCount ?? 0}</strong>
          <span>papers</span>
        </div>
        <div>
          <strong>{visit.current.newIds.size}</strong>
          <span>new this visit</span>
        </div>
        <div>
          <strong>
            {works.data?.items.filter(
              (work) => work.firstPass?.status === "full_text",
            ).length ?? 0}
          </strong>
          <span>full-text first passes</span>
        </div>
        <div>
          <strong>{selected.length}</strong>
          <span>selected</span>
        </div>
      </div>
      <div className="toolbar">
        <label className="search-field">
          <Search size={16} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter by title or author…"
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={onlyNew}
            onChange={(event) => setOnlyNew(event.target.checked)}
          />{" "}
          New since last visit
        </label>
      </div>
      {works.isLoading ? (
        <Loading />
      ) : works.error ? (
        <ErrorNotice error={works.error} />
      ) : !filtered.length ? (
        <EmptyState
          icon={<Inbox />}
          title={
            collectionId
              ? "No matching papers yet"
              : "Create your first collection"
          }
          body="Start with a focused topic or a few seed papers. Discovery and first passes run in the background."
        />
      ) : (
        <div
          className="paper-table"
          role="table"
          aria-label="Collection papers"
        >
          <div className="paper-row paper-head" role="row">
            <span />
            <span>Paper</span>
            <span>Year</span>
            <span>Status</span>
            <span>Verification</span>
            <span>Key</span>
            <span />
          </div>
          {filtered.map((work) => (
            <div
              className={`paper-row ${visit.current.newIds.has(work.id) ? "new-paper" : ""}`}
              role="row"
              key={work.id}
            >
              <input
                aria-label={`Select ${work.title}`}
                type="checkbox"
                checked={selected.some((item) => item.id === work.id)}
                onChange={() => toggle(work)}
              />
              <div>
                {visit.current.newIds.has(work.id) && (
                  <span className="new-badge">NEW</span>
                )}{" "}
                <a href={`/read/${work.id}`} className="paper-title">
                  {work.title}
                </a>
                <small>
                  {work.authors.map((author) => author.family).join(", ")} ·{" "}
                  {work.venue}
                </small>
                <button
                  className="first-pass-link"
                  onClick={() => {
                    retry.reset();
                    setReport(work);
                  }}
                >
                  First pass ·{" "}
                  {work.firstPass?.status.replaceAll("_", " ") ??
                    "not generated"}
                </button>
                {work.enrichment && (
                  <div>
                    <small>
                      PDF: {work.enrichment.pdf_status} · Summary:{" "}
                      {work.enrichment.status}
                    </small>
                    {work.enrichment.pdf_error && !work.enrichment.summary && (
                      <p>{work.enrichment.pdf_error}</p>
                    )}
                    {work.enrichment.summary && (
                      <>
                        <p className="novelty-preview">
                          <strong>Primary contribution: </strong>
                          {work.enrichment.summary.text}
                        </p>
                        <small>
                          {work.enrichment.summary.coverage} ·{" "}
                          {work.enrichment.summary.status}
                        </small>
                        <details>
                          <summary>
                            Contribution evidence and processing details
                          </summary>
                          {work.enrichment.summary.evidence.map((e, i) => (
                            <blockquote key={i}>
                              {e.quote}{" "}
                              <a
                                href={`/read/${work.id}${e.page ? `?attachment=${e.attachmentId}&page=${e.page}` : ""}`}
                              >
                                {e.label}
                              </a>
                            </blockquote>
                          ))}
                          {work.enrichment.pdf_error && (
                            <p>{work.enrichment.pdf_error}</p>
                          )}
                          {work.enrichment.summary.limitations?.map((l) => (
                            <p key={l}>{l}</p>
                          ))}
                        </details>
                      </>
                    )}
                    {work.enrichment.status !== "queued" && (
                      <button
                        className="first-pass-link"
                        disabled={enrichmentRetry.isPending}
                        onClick={() => enrichmentRetry.mutate(work.id)}
                      >
                        Retry PDF and summary
                      </button>
                    )}
                  </div>
                )}
                {!work.enrichment?.summary && work.firstPass && (
                  <p className="novelty-preview">
                    {work.firstPass.contributions}
                  </p>
                )}
              </div>
              <span>{work.year ?? "—"}</span>
              <select
                aria-label={`Reading status for ${work.title}`}
                value={work.status}
                onChange={(event) =>
                  status.mutate({ workId: work.id, value: event.target.value })
                }
              >
                {[
                  "inbox",
                  "to_read",
                  "skimming",
                  "reading",
                  "read",
                  "foundational",
                  "cited",
                  "rejected",
                  "archived",
                ].map((value) => (
                  <option key={value} value={value}>
                    {value.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
              <VerificationBadge status={work.verificationStatus} />
              <code>{work.citationKey}</code>
              <span />
            </div>
          ))}
        </div>
      )}
      {(showCreate || showSeed) && (
        <Modal
          title={showCreate ? "New living collection" : "Collection discovery"}
          onClose={() => {
            if (!save.isPending) {
              setShowCreate(false);
              setShowSeed(false);
            }
          }}
        >
          {showCreate && (
            <label className="collection-name">
              Collection name
              <input
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
                placeholder="e.g. Active subterranean mapping"
              />
            </label>
          )}
          {showCreate ? (
            <>
              <p>
                Create the collection, then upload a PDF, paste a paper link, or
                configure a topic.
              </p>
              {createEmpty.error && <ErrorNotice error={createEmpty.error} />}
              <button
                className="button primary"
                disabled={!name.trim() || createEmpty.isPending}
                onClick={() => createEmpty.mutate()}
              >
                Create collection
              </button>
            </>
          ) : (
            <CollectionSeedForm
              initial={showCreate ? undefined : active?.discovery}
              onSave={(seed) => {
                if (showCreate && !name.trim()) return;
                save.mutate(seed);
              }}
              pending={save.isPending}
              disabled={showCreate && !name.trim()}
              error={save.error}
            />
          )}
        </Modal>
      )}
      {report && (
        <Modal title={report.title} onClose={() => setReport(undefined)}>
          <FirstPassReport report={report.firstPass} />
          {retry.error && <ErrorNotice error={retry.error} />}
          <button
            className="button secondary"
            disabled={retry.isPending || !active?.discovery?.enabled}
            onClick={() => retry.mutate(report.id)}
          >
            Retry first pass
          </button>
        </Modal>
      )}
    </div>
  );
}
