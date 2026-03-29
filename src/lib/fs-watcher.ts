/**
 * fs-watcher.ts
 *
 * Filesystem watcher for the OpenClaw workspace directory.
 * Watches for file creates/edits/deletes, writes audit events to
 * memory/audit.jsonl, and publishes change events to SSE subscribers.
 *
 * Started once in instrumentation.ts (Next.js server startup hook).
 * NEVER started in browser context — server-only.
 */

import { watch, FSWatcher } from "chokidar";
import { appendFile, mkdir } from "fs/promises";
import { join, relative, resolve } from "path";
import { getOpenClawHome, getDefaultWorkspace } from "@/lib/paths";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AuditEventType = "file_created" | "file_edited" | "file_deleted";

export type AuditEvent = {
  ts: string; // ISO 8601
  type: AuditEventType;
  path: string; // relative to workspace
  agent: "system";
};

// ── SSE subscriber registry ───────────────────────────────────────────────────

type Subscriber = (event: AuditEvent) => void;
const subscribers = new Set<Subscriber>();

export function subscribeToFileEvents(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function broadcast(event: AuditEvent): void {
  for (const fn of subscribers) {
    try {
      fn(event);
    } catch {
      // subscriber errors must not crash the watcher
    }
  }
}

// ── Audit log writer ──────────────────────────────────────────────────────────

let auditLogPath: string | null = null;

async function getAuditLogPath(): Promise<string> {
  if (auditLogPath) return auditLogPath;
  const home = getOpenClawHome();
  const memoryDir = join(home, "workspace", "memory");
  await mkdir(memoryDir, { recursive: true });
  auditLogPath = join(memoryDir, "audit.jsonl");
  return auditLogPath;
}

async function appendAuditEvent(event: AuditEvent): Promise<void> {
  try {
    const logPath = await getAuditLogPath();
    await appendFile(logPath, JSON.stringify(event) + "\n", "utf-8");
  } catch {
    // Audit log write failure must not crash the watcher
  }
}

// ── Path helpers ──────────────────────────────────────────────────────────────

// Patterns to ignore — never emit events for these
const IGNORE_PATTERNS = [
  /node_modules/,
  /\.git\//,
  /\.next\//,
  /dist\//,
  /build\//,
  /audit\.jsonl$/, // avoid feedback loop
  /\.DS_Store$/,
  /~$/,           // editor temp files
  /\.swp$/,
  /\.tmp$/,
];

export function shouldIgnore(path: string): boolean {
  return IGNORE_PATTERNS.some((re) => re.test(path));
}

// ── Watcher singleton ─────────────────────────────────────────────────────────

let watcher: FSWatcher | null = null;
let watchedRoot: string | null = null;

export async function startWatcher(): Promise<void> {
  if (watcher) return; // already running

  const workspace = await getDefaultWorkspace();
  watchedRoot = resolve(workspace);

  watcher = watch(watchedRoot, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    ignored: (path: string) => shouldIgnore(path),
  });

  const emit = async (type: AuditEventType, absolutePath: string) => {
    if (shouldIgnore(absolutePath)) return;
    const rel = relative(watchedRoot!, absolutePath).replace(/\\/g, "/");
    const event: AuditEvent = {
      ts: new Date().toISOString(),
      type,
      path: rel,
      agent: "system",
    };
    await appendAuditEvent(event);
    broadcast(event);
  };

  watcher
    .on("add", (p) => emit("file_created", p))
    .on("change", (p) => emit("file_edited", p))
    .on("unlink", (p) => emit("file_deleted", p))
    .on("error", (err) => console.error("[fs-watcher] error:", err));

  console.log(`[fs-watcher] watching ${watchedRoot}`);
}

export function stopWatcher(): Promise<void> {
  if (!watcher) return Promise.resolve();
  const w = watcher;
  watcher = null;
  return w.close();
}

export function getWatchedRoot(): string | null {
  return watchedRoot;
}
