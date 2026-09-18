import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { request } from "../api";
import { ErrorNotice } from "./ui";
type UpdateStatus = {
  supported: boolean;
  available: boolean;
  installed?: string;
  latest?: string;
  checkedAt?: string;
  checkError?: string;
  reason?: string;
  installRoot?: string;
  job: { state?: string; message?: string; target?: string };
};
const busy = (state?: string) =>
  ["queued", "downloading", "installing"].includes(state ?? "");
export function useUpdates() {
  return useQuery({
    queryKey: ["system-updates"],
    queryFn: () => request<UpdateStatus>("/system/updates"),
    refetchInterval: (query) =>
      busy(query.state.data?.job.state) ? 3000 : 60000,
    retry: false,
  });
}
export function UpdateNotice() {
  const { data } = useUpdates();
  if (
    !data?.available &&
    !busy(data?.job.state) &&
    data?.job.state !== "failed"
  )
    return null;
  return (
    <Link className="button secondary" to="/settings">
      {busy(data?.job.state)
        ? "VANI updating…"
        : data?.job.state === "failed"
          ? "Update needs attention"
          : "VANI update available"}
    </Link>
  );
}
export function Updates() {
  const client = useQueryClient();
  const status = useUpdates();
  const [requested, setRequested] = useState(false);
  const action = useMutation({
    mutationFn: ({ path, commit }: { path: string; commit?: string }) =>
      request<UpdateStatus>(`/system/updates/${path}`, {
        method: "POST",
        headers: { "X-VANI-Update": "1" },
        body: JSON.stringify(commit ? { commit } : {}),
      }),
    onSuccess: (data) => {
      client.setQueryData(["system-updates"], data);
      if (busy(data.job.state)) setRequested(true);
    },
  });
  const data = status.data;
  const running = busy(data?.job.state);
  return (
    <section className="settings-card">
      <h2>VANI updates</h2>
      <p>
        Checks GitHub main periodically. Updates install only when you click the
        button.
      </p>
      {data && (
        <p>
          Installed: {data.installed?.slice(0, 8) ?? "development checkout"} ·
          Latest: {data.latest?.slice(0, 8) ?? "not checked"}
        </p>
      )}
      {data?.checkedAt && (
        <p>Last checked: {new Date(data.checkedAt).toLocaleString()}</p>
      )}
      {data?.reason && <p>{data.reason}</p>}
      {data?.checkError && <p role="alert">{data.checkError}</p>}
      {status.error &&
        (running || requested ? (
          <p role="status">
            VANI is disconnected during the update. This page will keep trying
            to reconnect. If it stays offline, inspect{" "}
            {data?.installRoot ?? "your installation directory"}/logs/update.log
            and rerun the installer using the same installation path.
          </p>
        ) : (
          <ErrorNotice error={status.error} />
        ))}
      {action.error && <ErrorNotice error={action.error} />}
      {data?.supported && (
        <>
          <button
            className="button secondary"
            disabled={running || action.isPending}
            onClick={() => action.mutate({ path: "check" })}
          >
            Check for updates
          </button>{" "}
          <button
            className="button primary"
            disabled={!data.available || running || action.isPending}
            onClick={() => {
              setRequested(true);
              action.mutate({ path: "install", commit: data.latest });
            }}
          >
            Update VANI
          </button>
          <p>
            Updating interrupts active processing and restarts VANI. Your
            database is backed up; papers, settings and downloaded models are
            retained.
          </p>
        </>
      )}
      {data?.job.message && <p role="status">{data.job.message}</p>}
      {data?.job.state === "complete" && (
        <button
          className="button primary"
          onClick={() => window.location.reload()}
        >
          Reload VANI
        </button>
      )}
      {data?.job.state === "failed" && (
        <p>
          Log: {data.installRoot}/logs/update.log. Recovery: run the normal
          installer from your source checkout with the same --install-dir.
        </p>
      )}
    </section>
  );
}
