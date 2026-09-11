import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { request } from "../api";
export const get = (path: string) => request<any>("/knowledge" + path);
export const send = (path: string, body?: unknown, method = "POST") =>
  request<any>("/knowledge" + path, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
export function useK(path: string, enabled = true) {
  return useQuery({
    queryKey: ["knowledge", path],
    queryFn: () => get(path),
    enabled,
  });
}
export function useAction() {
  const qc = useQueryClient(),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return {
    error,
    message,
    busy,
    run: async (fn: () => Promise<unknown>, success = "Saved.") => {
      setError("");
      setMessage("");
      setBusy(true);
      try {
        await fn();
        await qc.invalidateQueries({ queryKey: ["knowledge"] });
        await qc.invalidateQueries({ queryKey: ["notes"] });
        setMessage(success);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
  };
}
export function Feedback({ action }: { action: ReturnType<typeof useAction> }) {
  return (
    <>
      <p role="alert">{action.error}</p>
      <p role="status">{action.busy ? "Working…" : action.message}</p>
    </>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="k-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Choice({
  label,
  value,
  onChange,
  items,
  empty = "Choose…",
  multiple = false,
}: {
  label: string;
  value: any;
  onChange: (v: any) => void;
  items: any[];
  empty?: string;
  multiple?: boolean;
}) {
  return (
    <Field label={label}>
      <select
        aria-label={label}
        multiple={multiple}
        value={value}
        onChange={(e) =>
          onChange(
            multiple
              ? Array.from(e.target.selectedOptions, (o) => o.value)
              : e.target.value,
          )
        }
      >
        {!multiple && <option value="">{empty}</option>}
        {items.map((i) => (
          <option value={i.id ?? i} key={i.id ?? i}>
            {i.label ?? i.title ?? i.name ?? i}
          </option>
        ))}
      </select>
    </Field>
  );
}
export function RefPicker({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: any;
  onChange: (v: any) => void;
  options: any;
}) {
  const key =
    { work: "works", note: "notes", entity: "entities", passage: "passages" }[
      value.kind as string
    ] ?? "works";
  return (
    <div className="k-ref-picker">
      <Choice
        label={label + " type"}
        value={value.kind}
        items={["work", "passage", "note", "entity"]}
        onChange={(kind) => onChange({ kind, id: "" })}
      />
      <Choice
        label={label}
        value={value.id}
        items={options?.[key] ?? []}
        onChange={(id) => onChange({ ...value, id })}
      />
    </div>
  );
}
export function Source({ value }: { value: any }) {
  return value.unavailable ? (
    <span>{value.label}</span>
  ) : (
    <Link to={value.url ?? "/"}>{value.label}</Link>
  );
}
export function Json({ value }: { value: any }) {
  return <pre>{JSON.stringify(value, null, 2)}</pre>;
}
export function Download({ text, name }: { text: string; name: string }) {
  return (
    <button
      className="button secondary"
      onClick={() => {
        const u = URL.createObjectURL(
          new Blob([text], { type: "text/markdown" }),
        );
        const a = document.createElement("a");
        a.href = u;
        a.download = name;
        a.click();
        URL.revokeObjectURL(u);
      }}
    >
      Download Markdown
    </button>
  );
}
