# Mission Control — Implementation Plan

## Phase 0: Foundation (Days 1-2) ✅

### 0.1 Fork & Setup ✅
- [x] Fork robsannaa/openclaw-mission-control
- [x] Understand existing codebase — identified what to keep, replace, extend
- [x] Set up project structure per ARCHITECTURE.md (Next.js App Router, not Vite)
- [x] Tailwind + existing component system retained

### 0.2 Path Resolution & OpenClaw Detection ✅
- [x] `paths.ts` — auto-detect OpenClaw home, workspace, gateway (exists in fork)
- [x] Session JSONL file discovery via `/api/sessions/history`
- [x] Startup watcher via `instrumentation.ts` + `fs-watcher.ts`
- [x] Git auto-commit via `git-manager.ts` + `startAutoCommit()`

**Deliverable:** Dashboard starts, finds OpenClaw data, shows basic status.

---

## Phase 1: Core — Activity Timeline & File Explorer (Days 3-7) ✅

### 1.1 Session Reader ✅
- [x] Build `session-reader.ts` — parse JSONL files, extract structured events (in-route)
- [x] Handle all event types: message, tool_call, model_change, thinking, custom
- [x] Paginated reading (don't load entire session into memory)
- [x] Session listing API: `GET /api/sessions/history`
- [x] Session events API: `GET /api/sessions/history/events`

### 1.2 Activity Timeline UI ✅
- [x] `timeline-view.tsx` — session list + event feed
- [x] `EventCard` — compact event display (timestamp, type icon, summary)
- [x] Expandable full trace (thinking → tool calls → diffs)
- [x] Session detail with back navigation
- [x] Filters: date range, agent filter, text search
- [x] Virtual scrolling for performance (@tanstack/react-virtual)

### 1.3 File Explorer & Editor ✅
- [x] `docs-view.tsx` — tree view of workspace (exists in fork)
- [x] Monaco editor + Markdown preview (exists in fork)
- [x] File read/write API (exists in fork)
- [x] Path validation (no traversal attacks) — `path-safety.test.ts`
- [x] Quick-access sidebar for critical files (MEMORY.md, SOUL.md, etc.) — pinned section in docs-view
- [x] Semantic search across workspace (Cmd+K) — search-modal.tsx + /api/search

**Deliverable:** Full activity timeline + file editing. This is the "system of record" MVP.

---

## Phase 2: Task Board, Env Manager & Plugin Foundation (Days 8-12)

### 2.1 Task Board
- [ ] Design `todo.json` schema (see ARCHITECTURE.md)
- [ ] Build `todo-manager.ts` — read/write tasks
- [ ] `TaskBoard.tsx` — Kanban with 4 columns
- [ ] Drag-and-drop (dnd-kit)
- [ ] Task CRUD: create, edit, delete from UI
- [ ] Task fields: title, description, priority, assignee, due date, tags
- [ ] `auto_created` + `auto_reason` fields for agent-created tasks
- [ ] `in_progress_at` + `previous_in_progress_at` for time tracking
- [ ] "Create task from event" action in timeline
- [ ] Real-time sync: agent writes to todo.json → dashboard updates

### 2.2 Environment Variables Manager ✅
- [x] Build `env-manager.ts` — read/write .env files
- [x] `env-manager-view.tsx` — Vercel-style UI
- [x] Values masked by default, reveal on click
- [x] Add/edit/delete env vars
- [x] Group by source (OpenClaw config, workspace .env)
- [x] **Security:** Never log env var values. Never include in audit trail.
- [ ] Validation warnings for common misconfigurations
- [ ] Import/export functionality

### 2.3 Plugin System Foundation
- [ ] Design manifest.json schema (see REQUIREMENTS.md for full spec)
- [ ] Build `plugin-loader.ts` — scan plugins directory, validate manifests
- [ ] Build `plugin-registry.ts` — track installed plugins
- [ ] Build `plugin-sandbox.tsx` — error-isolated React rendering container
- [ ] Build `plugin-api.ts` — inject data hooks into plugin context
- [ ] Build `permissions.ts` — enforce permission model (read:files, network, etc.)
- [ ] Sidebar integration: auto-register plugin pages in nav
- [ ] Hot reload: detect new/changed plugins
- [ ] Plugin settings UI (scoped key-value storage)

**Deliverable:** Task management + env management + plugin foundation. Dashboard is now extensible.

---

## Phase 3: Business Metrics & Agent Visibility (Days 11-14)

### 3.1 Business Metrics Dashboard
- [ ] Build `metrics-aggregator.ts` — pluggable metric sources
- [ ] Implement Calmart API source (product catalog, signups)
- [ ] Implement tweet log source (engagement metrics)
- [ ] `KPIGrid.tsx` — top-level KPI cards
- [ ] `TrendChart.tsx` — line charts for metric trends (Recharts)
- [ ] `GoalTracker.tsx` — progress bars against targets
- [ ] Configurable metric sources via UI
- [ ] Date range picker for all charts

### 3.2 Sub-Agent Delegation View
- [ ] `AgentList.tsx` — list all agents and their sub-agents
- [ ] `SubAgentDetail.tsx` — status, task, token usage, timeline
- [ ] Kill sub-agent from UI
- [ ] Token cost tracking per sub-agent
- [ ] Link sub-agent sessions to main timeline

### 3.3 System Health
- [ ] `SystemStatus.tsx` — gateway, browser, cron, disk/CPU
- [ ] Gateway connectivity check
- [ ] Browser debug port health check
- [ ] Cron job listing with last/next run times
- [ ] One-click diagnostics

**Deliverable:** Full business visibility. This is the "CEO dashboard" MVP.

---

## Phase 4: Filesystem Watcher & Git Integration (Days 15-17) ✅

### 4.1 Filesystem Watcher ✅
- [x] `fs-watcher.ts` — chokidar watching workspace directory
- [x] Write audit events to `memory/audit.jsonl`
- [x] Ignore patterns: node_modules, .git, .next, dist, build, audit.jsonl, .DS_Store, temp files
- [x] SSE endpoint (`GET /api/events/stream`) for real-time file change push to browser
- [x] Recent audit events (`GET /api/events`) — newest-first, configurable limit
- [x] File change events wired into activity timeline UI — `EventSource` subscription with debounce + live status indicator

### 4.2 Git Integration ✅
- [x] `git-manager.ts` — `startAutoCommit()` scheduled commits (30-min default)
- [x] Commit messages: auto-generated summary of changed files
- [x] `GET /api/git` — status + log
- [x] `GET /api/git/log` — recent commit history with limit param
- [x] `GET /api/git/diff` — file diffs (file + ref params)
- [x] `POST /api/git/commit` — manual commit with optional message
- [x] `POST /api/git/rollback` — revert to any commit ref
- [ ] DiffView UI component (API done, UI not built)
- [ ] Git history visible in activity timeline UI

**Deliverable:** Complete audit trail. Every change tracked, versioned, and visible.

---

## Phase 5: Polish & Productization (Days 18-21)

### 5.1 Real-Time Updates
- [ ] WebSocket subscription to OpenClaw gateway for live events
- [ ] SSE for file change push
- [ ] Optimistic UI updates for task/env edits
- [ ] Connection status indicator

### 5.2 Reports
- [ ] Daily standup summary generator
- [ ] Weekly review template
- [ ] Export as markdown
- [ ] Business report with KPIs + recommendations

### 5.3 UX Polish
- [ ] Command palette (Cmd+K) for quick navigation
- [ ] Keyboard shortcuts throughout
- [ ] Dark/light mode
- [ ] Responsive layout
- [ ] Error boundaries per section (robsannaa already does this)
- [ ] Loading states and skeleton screens

### 5.4 Documentation & Open Source Prep
- [ ] README with screenshots, install instructions, architecture overview
- [ ] CONTRIBUTING.md
- [ ] LICENSE (MIT)
- [ ] GitHub Actions CI (lint, type-check, build)
- [ ] Demo data / screenshots for landing page

**Deliverable:** Shippable product. Ready to open source or sell.

---

## Effort Estimates

| Phase | Duration | Complexity | Dependencies |
|-------|----------|------------|-------------|
| Phase 0: Foundation | 2 days | Low | None |
| Phase 1: Timeline + Files | 5 days | High | Phase 0 |
| Phase 2: Tasks + Env + Plugins | 5 days | Medium-High | Phase 0 |
| Phase 3: Metrics + Agents + Health | 4 days | Medium | Phase 1 |
| Phase 4: Watcher + Git | 3 days | Medium | Phase 1 |
| Phase 5: Polish | 4 days | Medium | All |
| **Total** | **~23 days** | | |

---

## Risk & Mitigation

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Session JSONL format changes | High (breaks parser) | Version detection, graceful degradation, fallback to raw view |
| Large session files cause performance issues | Medium | Paginated reading, virtual scrolling, lazy loading |
| Gateway API changes | Medium | Abstract behind client layer, version detection |
| Monaco editor bundle size | Low | Lazy load, code splitting |
| Git conflicts from auto-commit | Low | Commit only when clean, use agent-identifying messages |
