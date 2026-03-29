/**
 * Unit tests for the SSE session-refresh filter logic in timeline-view.
 *
 * isSessionFileEvent decides whether a workspace file-change event should
 * trigger a session list refresh. It must fire for .jsonl files (session
 * data) and stay silent for everything else.
 *
 * Note: the watcher already suppresses audit.jsonl writes via shouldIgnore,
 * so that path will never reach the SSE stream — no special-casing needed here.
 */

import { isSessionFileEvent } from "@/components/timeline-view";

describe("isSessionFileEvent", () => {
  // Paths that SHOULD trigger a refresh
  const sessionPaths = [
    "agents/main/sessions/abc123.jsonl",
    "agents/claude-code/sessions/xyz.jsonl",
    "agents/codex/sessions/2025-01-15T10:00:00Z.jsonl",
    "sessions/bare.jsonl",   // minimal valid path
    "foo.jsonl",              // top-level .jsonl
  ];

  it.each(sessionPaths)("triggers refresh for %s", (path) => {
    expect(isSessionFileEvent(path)).toBe(true);
  });

  // Paths that should NOT trigger a refresh
  const nonSessionPaths = [
    "MEMORY.md",
    "SOUL.md",
    "src/components/timeline-view.tsx",
    "package.json",
    ".env",
    "scripts/deploy.sh",
    "sessions/notes.txt",          // .txt not .jsonl
    "logs/app.log",
    "foo.jsonl.bak",               // .bak suffix — not .jsonl
    "",                             // empty string
  ];

  it.each(nonSessionPaths)("does not trigger refresh for %s", (path) => {
    expect(isSessionFileEvent(path)).toBe(false);
  });

  it("is case-sensitive — .JSONL does not match", () => {
    expect(isSessionFileEvent("session.JSONL")).toBe(false);
  });

  it("requires the full .jsonl suffix, not just containment", () => {
    expect(isSessionFileEvent("jsonl-notes.md")).toBe(false);
    expect(isSessionFileEvent("my.jsonl.md")).toBe(false);
  });
});
