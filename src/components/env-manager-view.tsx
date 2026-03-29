"use client";

/**
 * EnvManagerView — Vercel-style environment variable manager.
 *
 * Lists env vars from ~/.openclaw/.env and workspace/.env
 * Values masked by default; click eye icon to reveal.
 * Add / edit / delete via the API.
 */

import { useState, useCallback, useEffect } from "react";
import {
  Eye,
  EyeOff,
  Pencil,
  Trash2,
  Plus,
  Check,
  X,
  RefreshCw,
  KeyRound,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionBody, SectionHeader, SectionLayout } from "@/components/section-layout";
import { LoadingState } from "@/components/ui/loading-state";

// ── Types ─────────────────────────────────────────────────────────────────────

type EnvSource = "openclaw" | "workspace";

type EnvVar = {
  key: string;
  source: EnvSource;
  filePath: string;
  masked: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<EnvSource, string> = {
  openclaw: "~/.openclaw/.env",
  workspace: "workspace/.env",
};

const SOURCE_BADGE: Record<EnvSource, string> = {
  openclaw:
    "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  workspace:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
};

// ── Row component ─────────────────────────────────────────────────────────────

function EnvRow({
  envVar,
  onUpdate,
  onDelete,
}: {
  envVar: EnvVar;
  onUpdate: (key: string, value: string, source: EnvSource) => Promise<void>;
  onDelete: (key: string) => Promise<void>;
}) {
  const [revealed, setRevealed] = useState(false);
  const [revealedValue, setRevealedValue] = useState<string | null>(null);
  const [loadingReveal, setLoadingReveal] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleReveal = useCallback(async () => {
    if (revealed) {
      setRevealed(false);
      setRevealedValue(null);
      return;
    }
    setLoadingReveal(true);
    try {
      const res = await fetch(`/api/env/${encodeURIComponent(envVar.key)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { value: string };
      setRevealedValue(data.value);
      setRevealed(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingReveal(false);
    }
  }, [revealed, envVar.key]);

  const handleEdit = () => {
    setEditValue(revealedValue ?? "");
    setEditing(true);
    setError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onUpdate(envVar.key, editValue, envVar.source);
      setRevealedValue(editValue);
      setEditing(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    try {
      await onDelete(envVar.key);
    } catch (e) {
      setError(String(e));
      setDeleting(false);
    }
  };

  const displayValue = editing
    ? null
    : revealed && revealedValue !== null
      ? revealedValue
      : envVar.masked;

  return (
    <div
      className={cn(
        "group flex items-center gap-3 border-b border-stone-100 px-5 py-3 last:border-0 dark:border-stone-800/60",
        deleting && "opacity-50"
      )}
    >
      {/* Key */}
      <span className="w-56 shrink-0 truncate font-mono text-sm font-medium text-stone-800 dark:text-stone-200">
        {envVar.key}
      </span>

      {/* Value */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {editing ? (
          <input
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") setEditing(false);
            }}
            className="flex-1 rounded border border-stone-300 bg-white px-2.5 py-1 font-mono text-sm text-stone-800 outline-none focus:border-stone-400 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-200"
          />
        ) : (
          <span
            className={cn(
              "flex-1 truncate font-mono text-sm",
              revealed ? "text-stone-700 dark:text-stone-300" : "tracking-widest text-stone-400 dark:text-stone-600"
            )}
          >
            {displayValue}
          </span>
        )}

        {/* Reveal toggle */}
        {!editing && (
          <button
            onClick={handleReveal}
            disabled={loadingReveal}
            className="shrink-0 text-stone-400 opacity-0 transition-opacity group-hover:opacity-100 hover:text-stone-600 dark:hover:text-stone-300"
            title={revealed ? "Hide value" : "Reveal value"}
          >
            {loadingReveal ? (
              <span className="animate-pulse text-[10px]">…</span>
            ) : revealed ? (
              <EyeOff className="h-3.5 w-3.5" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>

      {/* Source badge */}
      <span
        className={cn(
          "shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium",
          SOURCE_BADGE[envVar.source]
        )}
      >
        {SOURCE_LABELS[envVar.source]}
      </span>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1">
        {editing ? (
          <>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex h-6 w-6 items-center justify-center rounded text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setEditing(false)}
              className="flex h-6 w-6 items-center justify-center rounded text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <>
            <button
              onClick={handleEdit}
              className="flex h-6 w-6 items-center justify-center rounded text-stone-400 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800 dark:hover:text-stone-300"
              title="Edit"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded text-stone-400 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10",
                confirmDelete && "bg-red-50 text-red-500 opacity-100 dark:bg-red-500/10"
              )}
              title={confirmDelete ? "Click again to confirm delete" : "Delete"}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </>
        )}
      </div>

      {/* Error */}
      {error && (
        <span className="ml-2 text-xs text-red-500">{error}</span>
      )}
    </div>
  );
}

// ── Add form ─────────────────────────────────────────────────────────────────

function AddEnvVar({
  onAdd,
  onCancel,
}: {
  onAdd: (key: string, value: string, source: EnvSource) => Promise<void>;
  onCancel: () => void;
}) {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [source, setSource] = useState<EnvSource>("workspace");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!key.trim()) {
      setError("Key is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onAdd(key.trim(), value, source);
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  return (
    <div className="border-t border-stone-200 bg-stone-50/50 px-5 py-4 dark:border-stone-700 dark:bg-stone-800/20">
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="KEY_NAME"
          value={key}
          onChange={(e) => setKey(e.target.value.toUpperCase())}
          className="w-52 rounded border border-stone-300 bg-white px-2.5 py-1.5 font-mono text-sm text-stone-800 outline-none placeholder:text-stone-400 focus:border-stone-400 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-200"
          autoFocus
        />
        <input
          type="text"
          placeholder="value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") onCancel();
          }}
          className="flex-1 rounded border border-stone-300 bg-white px-2.5 py-1.5 font-mono text-sm text-stone-800 outline-none placeholder:text-stone-400 focus:border-stone-400 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-200"
        />
        <select
          value={source}
          onChange={(e) => setSource(e.target.value as EnvSource)}
          className="rounded border border-stone-300 bg-white px-2 py-1.5 text-xs text-stone-600 outline-none dark:border-stone-600 dark:bg-stone-900 dark:text-stone-300"
        >
          <option value="workspace">workspace/.env</option>
          <option value="openclaw">~/.openclaw/.env</option>
        </select>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 rounded bg-stone-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-700 disabled:opacity-50 dark:bg-stone-200 dark:text-stone-900 dark:hover:bg-stone-300"
        >
          <Check className="h-3 w-3" />
          {saving ? "Saving…" : "Add"}
        </button>
        <button
          onClick={onCancel}
          className="flex h-7 w-7 items-center justify-center rounded text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function EnvManagerView() {
  const [vars, setVars] = useState<EnvVar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const fetchVars = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/env", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { vars: EnvVar[] };
      setVars(data.vars ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVars();
  }, [fetchVars]);

  const handleUpdate = useCallback(
    async (key: string, value: string, source: EnvSource) => {
      const res = await fetch(`/api/env/${encodeURIComponent(key)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value, source }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
    },
    []
  );

  const handleDelete = useCallback(async (key: string) => {
    const res = await fetch(`/api/env/${encodeURIComponent(key)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    setVars((prev) => prev.filter((v) => v.key !== key));
  }, []);

  const handleAdd = useCallback(
    async (key: string, value: string, source: EnvSource) => {
      const res = await fetch("/api/env", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value, source }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setAdding(false);
      await fetchVars();
    },
    [fetchVars]
  );

  // Group by source
  const grouped = vars.reduce<Record<EnvSource, EnvVar[]>>(
    (acc, v) => {
      acc[v.source] = [...(acc[v.source] ?? []), v];
      return acc;
    },
    { openclaw: [], workspace: [] }
  );

  return (
    <SectionLayout>
      <SectionHeader
        title="Environment Variables"
        description="Manage .env files in ~/.openclaw and workspace. Values are masked by default."
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={fetchVars}
              className="flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 shadow-sm transition hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-1.5 rounded-md border border-stone-800 bg-stone-800 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-stone-700 dark:border-stone-200 dark:bg-stone-200 dark:text-stone-900 dark:hover:bg-stone-300"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Variable
            </button>
          </div>
        }
      />

      <SectionBody>
        {loading && <LoadingState label="Loading env vars…" />}
        {error && (
          <p className="text-sm text-red-500">{error}</p>
        )}

        {!loading && !error && (
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto">
            {(["workspace", "openclaw"] as EnvSource[]).map((source) => {
              const sourceVars = grouped[source] ?? [];
              return (
                <div
                  key={source}
                  className="overflow-hidden rounded-lg border border-stone-200 bg-white dark:border-stone-700/60 dark:bg-stone-900/30"
                >
                  {/* Group header */}
                  <div className="flex items-center gap-2 border-b border-stone-100 bg-stone-50 px-5 py-2.5 dark:border-stone-800/60 dark:bg-stone-800/30">
                    <KeyRound className="h-3.5 w-3.5 text-stone-400" />
                    <span className="font-mono text-xs font-medium text-stone-600 dark:text-stone-300">
                      {SOURCE_LABELS[source]}
                    </span>
                    <span className="ml-auto text-[11px] text-stone-400">
                      {sourceVars.length} {sourceVars.length === 1 ? "variable" : "variables"}
                    </span>
                  </div>

                  {/* Rows */}
                  {sourceVars.length === 0 ? (
                    <div className="px-5 py-4 text-sm text-stone-400">
                      No variables — file may not exist yet.
                    </div>
                  ) : (
                    <div>
                      {sourceVars.map((v) => (
                        <EnvRow
                          key={`${v.source}:${v.key}`}
                          envVar={v}
                          onUpdate={handleUpdate}
                          onDelete={handleDelete}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Add form */}
            {adding && (
              <AddEnvVar
                onAdd={handleAdd}
                onCancel={() => setAdding(false)}
              />
            )}

            {vars.length === 0 && !adding && (
              <div className="py-8 text-center text-sm text-stone-400">
                No env vars found. Add one to get started.
              </div>
            )}
          </div>
        )}
      </SectionBody>
    </SectionLayout>
  );
}
