# Mission Control — Handoff Document

Last updated: 2026-03-28

---

## Where the Code Lives

| Location | Contents |
|---|---|
| `/Users/will/.openclaw/workspace/mission-control-repo/` | The Next.js app (fork + our additions) |
| `/Users/will/.openclaw/workspace/mission-control/` | Spec docs (REQUIREMENTS.md, ARCHITECTURE.md, IMPLEMENTATION.md, this file) |

To run the dev server:
```bash
cd /Users/will/.openclaw/workspace/mission-control-repo
npm run dev        # http://localhost:3000
npm test           # 105 unit tests
npm run test:e2e   # Playwright (requires dev server running)
```

---

## What's Built (Current State)

### Done ✅
| Item | Files |
|---|---|
| Session JSONL reader + API | `src/app/api/sessions/history/route.ts`, `.../events/route.ts` |
| Activity Timeline UI | `src/components/timeline-view.tsx` |
| — Agent filter, text search, date range filter | (in timeline-view) |
| — Virtual scrolling for large sessions | @tanstack/react-virtual |
| — Expandable thinking, tool calls, diffs | EventCard in timeline-view |
| Filesystem watcher | `src/lib/fs-watcher.ts` |
| SSE event stream | `src/app/api/events/stream/route.ts` |
| Recent audit events API | `src/app/api/events/route.ts` |
| Live session list updates (SSE → timeline) | `src/components/timeline-view.tsx` — `useEffect` + `EventSource` + debounce |
| Live status indicator | `timeline-view.tsx` header — green/amber/red dot with `data-live-status` attr |
| Git integration | `src/lib/git-manager.ts` |
| Git API routes | `src/app/api/git/` (status, log, diff, commit, rollback) |
| Auto-commit on startup | `instrumentation.ts` → `startAutoCommit()` |
| Env vars manager (lib) | `src/lib/env-manager.ts` |
| Env vars API | `src/app/api/env/route.ts`, `.../[key]/route.ts` |
| Env vars UI | `src/components/env-manager-view.tsx` |
| Docs quick-access (MEMORY.md, SOUL.md, etc.) | `src/components/docs-view.tsx` — pinned section |
| Sidebar nav entries | `src/components/sidebar.tsx` — timeline + env |
| Unit tests: env-manager | `src/__tests__/env-manager.test.ts` (23 tests) |
| Unit tests: session reader | `src/__tests__/session-reader.test.ts` (12 tests) |
| Unit tests: path safety | `src/__tests__/path-safety.test.ts` (10 tests) |
| Unit tests: git-manager | `src/__tests__/git-manager.test.ts` (47 tests) |
| Unit tests: fs-watcher | `src/__tests__/fs-watcher.test.ts` (23 tests) |
| Unit tests: timeline SSE filter | `src/__tests__/timeline-sse.test.ts` (17 tests) |
| E2E tests: timeline | `e2e/timeline.spec.ts` (5 tests) |
| E2E tests: env manager | `e2e/env-manager.spec.ts` (5 tests) |

### Partially Done (API built, UI not wired)
- **Git diff UI** — all API routes work, no `DiffView` component yet
- **Git history in timeline** — commits visible via API, not surfaced in timeline UI

---

## What's Next

### Next Up: Phase 2.1 — Task Board

This is the highest-priority unbuilt feature. See `REQUIREMENTS.md §3` and `IMPLEMENTATION.md §2.1` for full spec.

**Key decisions to make first:**
1. **Storage format:** `todo.json` (structured) or `TODO.md` (markdown)? REQUIREMENTS.md says support both. Recommend starting with `todo.json` since it's easier to sync and agent-writable.
2. **Drag-and-drop library:** dnd-kit (spec says this). Already thinking of adding it as a dependency.

**What to build:**
```
src/lib/todo-manager.ts          — read/write todo.json
src/app/api/tasks/route.ts       — GET list, POST create
src/app/api/tasks/[id]/route.ts  — PUT update, DELETE
src/components/task-board-view.tsx — Kanban UI (4 columns)
src/__tests__/todo-manager.test.ts
e2e/task-board.spec.ts
```

**Schema (from REQUIREMENTS.md):**
```typescript
type Task = {
  id: string;           // uuid
  title: string;
  description?: string;
  status: "backlog" | "in_progress" | "review" | "done";
  priority: "low" | "medium" | "high" | "critical";
  assignee?: string;
  due_date?: string;    // ISO 8601
  tags?: string[];
  auto_created?: boolean;
  auto_reason?: string;
  created_at: string;
  updated_at: string;
  in_progress_at?: string;
  previous_in_progress_at?: string;
};
```

**Sidebar nav:** needs a new "Tasks" entry pointing to `/tasks` — follow the same pattern as the timeline/env entries added to `sidebar.tsx`.

### After Task Board: Phase 3 (Metrics + Agents + Health)

Lower priority. See IMPLEMENTATION.md §3 for details. Main items:
- `GET /api/stats` for Calmart product catalog metrics
- KPI card grid + Recharts trend charts
- Sub-agent visibility panel
- System health diagnostics (gateway, disk, CPU)

### Quick Wins (can do any time)
- ~~**Wire SSE → timeline**~~ ✅ Done — `EventSource` subscription in `TimelineView`, debounced 500ms, with live status indicator.
- **DiffView component:** Build a `<DiffView>` that calls `GET /api/git/diff` and renders colored +/- lines. Can embed in timeline EventCards for file edits.
- **Env var validation warnings:** In `env-manager-view.tsx`, add yellow warning badges for common issues (e.g., `OPENAI_API_KEY` present but `ANTHROPIC_API_KEY` missing, keys that look like they have wrong format).

---

## Architecture Decisions Made

| Decision | What was decided | Why |
|---|---|---|
| Framework | Keep Next.js (not rewrite to Vite+Express) | Fork was too mature to rewrite; App Router works well |
| Session API path | `/api/sessions/history` (not `/api/sessions`) | History is read-only; avoids conflict with fork's existing `/api/sessions` for live agent sessions |
| Path safety | base64url-encode file paths as IDs, validate against allowed base + `.jsonl` extension | Prevents path traversal; clean API |
| Env file writes | Direct `fs/promises` (not shell `export`) | Server-side only, no shell injection risk |
| Git ops | `simple-git` library (not shell exec) | Structured, no injection risk |
| Auto-commit interval | 30 minutes default | Conservative; agent sessions rarely need faster than this |
| Virtual scroll heights | Estimated per event type (model_change=28px, user=80px, assistant=90+) | Avoids measuring all elements upfront |

---

## Known Issues / Tech Debt

- `ARCHITECTURE.md` directory structure is stale (shows Express routes, not Next.js App Router). The actual structure is `/src/app/api/...`. Low priority to fix.
- `fs-watcher.ts` singleton state (`watcher`, `watchedRoot`, `auditLogPath`) doesn't reset between hot reloads in dev. Harmless but slightly noisy in logs.
- `startAutoCommit` guard (`if (autoCommitTimer) return`) means calling it a second time after `stopAutoCommit` + restart is idempotent — correct behavior, but the guard check in `git-manager.ts` uses module-level state that persists across requests.
- The `subscribers` Set in `fs-watcher.ts` is module-level — in production this is fine, but in tests you need to unsub after each test (all current tests do this correctly).

---

## Test Coverage

```
src/__tests__/env-manager.test.ts    23 tests  — parseDotenv, serializeDotenv, maskValue
src/__tests__/session-reader.test.ts 12 tests  — parseEvent, JSONL parsing
src/__tests__/path-safety.test.ts    10 tests  — safeResolvePath, validateKey
src/__tests__/git-manager.test.ts    47 tests  — buildAutoCommitMessage, getGitStatus,
                                                  getGitLog, getFileDiff, commitWorkspace,
                                                  rollbackToCommit, auto-commit timer
src/__tests__/fs-watcher.test.ts     23 tests  — shouldIgnore, subscribeToFileEvents,
                                                  broadcast, error isolation
e2e/timeline.spec.ts                  5 tests  — loads, empty state, filter, search, detail
e2e/env-manager.spec.ts               5 tests  — loads, source groups, add form, dismiss, masked
```

Run: `cd /Users/will/.openclaw/workspace/mission-control-repo && npm test`
