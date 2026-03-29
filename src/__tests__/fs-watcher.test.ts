/**
 * Unit tests for fs-watcher.ts
 *
 * Tests the pure helpers (shouldIgnore) and the pub/sub layer
 * (subscribeToFileEvents + broadcast) without touching the real filesystem
 * or starting a chokidar watcher.
 */

// Mock chokidar (ESM-only module) and fs/paths before any imports
jest.mock("chokidar", () => ({ watch: jest.fn() }));
jest.mock("@/lib/paths", () => ({
  getOpenClawHome: jest.fn().mockReturnValue("/fake/home"),
  getDefaultWorkspace: jest.fn().mockResolvedValue("/fake/workspace"),
}));

import { shouldIgnore, subscribeToFileEvents, broadcast } from "@/lib/fs-watcher";
import type { AuditEvent } from "@/lib/fs-watcher";

// ── shouldIgnore ──────────────────────────────────────────────────────────────

describe("shouldIgnore", () => {
  // Paths that should be silently skipped
  const ignoredPaths = [
    "/workspace/node_modules/lodash/index.js",
    "/workspace/.git/COMMIT_EDITMSG",
    "/workspace/.next/server/app/page.js",
    "/workspace/dist/bundle.js",
    "/workspace/build/output.js",
    "/workspace/memory/audit.jsonl",
    "/workspace/.DS_Store",
    "/workspace/notes.md~",      // editor temp (~ suffix)
    "/workspace/foo.swp",        // vim swap file
    "/workspace/foo.tmp",        // temp file
  ];

  it.each(ignoredPaths)("ignores %s", (path) => {
    expect(shouldIgnore(path)).toBe(true);
  });

  // Paths that should trigger events
  const watchedPaths = [
    "/workspace/MEMORY.md",
    "/workspace/SOUL.md",
    "/workspace/src/components/timeline-view.tsx",
    "/workspace/src/lib/git-manager.ts",
    "/workspace/notes.md",
    "/workspace/.env",
    "/workspace/package.json",
    "/workspace/docs/design.md",
  ];

  it.each(watchedPaths)("watches %s", (path) => {
    expect(shouldIgnore(path)).toBe(false);
  });

  it("ignores paths with node_modules anywhere in the path", () => {
    expect(shouldIgnore("/deep/nested/node_modules/.bin/ts-node")).toBe(true);
  });

  it("does not ignore a path that merely contains 'build' as a word", () => {
    // 'build' regex is /build\// — needs trailing slash
    expect(shouldIgnore("/workspace/rebuild.sh")).toBe(false);
  });
});

// ── subscribeToFileEvents + broadcast ─────────────────────────────────────────

function makeEvent(type: AuditEvent["type"] = "file_edited", path = "MEMORY.md"): AuditEvent {
  return { ts: new Date().toISOString(), type, path, agent: "system" };
}

describe("subscribeToFileEvents", () => {
  it("delivers broadcast events to a subscriber", () => {
    const received: AuditEvent[] = [];
    const unsub = subscribeToFileEvents((e) => received.push(e));

    const event = makeEvent("file_created", "SOUL.md");
    broadcast(event);

    expect(received).toHaveLength(1);
    expect(received[0]).toBe(event);
    unsub();
  });

  it("stops delivering events after unsubscribe", () => {
    const received: AuditEvent[] = [];
    const unsub = subscribeToFileEvents((e) => received.push(e));

    broadcast(makeEvent("file_edited", "first.md"));
    unsub();
    broadcast(makeEvent("file_edited", "second.md"));

    expect(received).toHaveLength(1);
    expect(received[0].path).toBe("first.md");
  });

  it("multiple subscribers all receive the same event", () => {
    const a: AuditEvent[] = [];
    const b: AuditEvent[] = [];

    const unsubA = subscribeToFileEvents((e) => a.push(e));
    const unsubB = subscribeToFileEvents((e) => b.push(e));

    const event = makeEvent("file_deleted", "todo.md");
    broadcast(event);

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]).toBe(event);
    expect(b[0]).toBe(event);

    unsubA();
    unsubB();
  });

  it("unsubscribing one subscriber does not affect others", () => {
    const a: AuditEvent[] = [];
    const b: AuditEvent[] = [];

    const unsubA = subscribeToFileEvents((e) => a.push(e));
    const unsubB = subscribeToFileEvents((e) => b.push(e));

    broadcast(makeEvent("file_created", "first.md"));
    unsubA();
    broadcast(makeEvent("file_created", "second.md"));

    expect(a).toHaveLength(1);  // only received before unsub
    expect(b).toHaveLength(2);  // received both
    unsubB();
  });

  it("a throwing subscriber does not prevent other subscribers from receiving", () => {
    const received: AuditEvent[] = [];

    const unsubBad = subscribeToFileEvents(() => {
      throw new Error("subscriber crash");
    });
    const unsubGood = subscribeToFileEvents((e) => received.push(e));

    expect(() => broadcast(makeEvent("file_edited", "crash-test.md"))).not.toThrow();
    expect(received).toHaveLength(1);

    unsubBad();
    unsubGood();
  });

  it("calling unsubscribe twice is idempotent", () => {
    const received: AuditEvent[] = [];
    const unsub = subscribeToFileEvents((e) => received.push(e));

    unsub();
    unsub(); // second call should be safe

    broadcast(makeEvent());
    expect(received).toHaveLength(0);
  });

  it("delivers all three AuditEventType variants", () => {
    const types: AuditEvent["type"][] = [];
    const unsub = subscribeToFileEvents((e) => types.push(e.type));

    broadcast(makeEvent("file_created"));
    broadcast(makeEvent("file_edited"));
    broadcast(makeEvent("file_deleted"));

    expect(types).toEqual(["file_created", "file_edited", "file_deleted"]);
    unsub();
  });
});
