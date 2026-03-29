# Mission Control — Requirements Document

## Overview

**Mission Control is the system of record for AI agent action.**

Logging. Observability. Visibility. Every action traced, every decision explained, every outcome measured. If an agent did it, Mission Control knows.

It's a CEO tool, not a dev tool — designed for solo founders and small teams running autonomous AI agents who need to understand, manage, and trust their agent's work. The core promise: **you should never have to ask "what did my agent do?"**

**Target users:** Solo founders, indie hackers, and small teams running OpenClaw (or compatible agent frameworks) who want transparency and control without complexity.

**Starting point:** Fork of [robsannaa/openclaw-mission-control](https://github.com/robsannaa/openclaw-mission-control) — zero-database, reads directly from OpenClaw's filesystem and gateway API.

---

## Core Principles

1. **Zero additional infrastructure** — No database, no external services. Reads from OpenClaw's existing data (session JSONL files, workspace files, gateway API). Data abstraction layer allows optional DB (SQLite) for scale.
2. **Full transparency** — Every agent action traceable from trigger to outcome. See prompts, thinking, tool calls, and results.
3. **Editable** — Users can edit workspace files, to-dos, and env vars directly from the dashboard. Changes sync back to the filesystem immediately.
4. **Product-ready** — Clean enough to open source or sell. Pluggable architecture, standard event schemas, multi-agent support.
5. **Local-first, self-hosted** — Everything runs on the user's machine. No data leaves. No accounts required.

---

## Feature Requirements

### 1. Agent Activity Timeline (System of Record)

**What:** A chronological feed of everything the agent has done, ingested from OpenClaw's session JSONL files.

**Requirements:**
- Parse `~/.openclaw/agents/*/sessions/*.jsonl` files automatically (covers main agent + ALL sub-agents including Claude Code, Codex, etc.)
- Display events in a scrollable timeline with timestamps
- **Sub-agent sessions are first-class citizens** — Mission Control itself being built by a sub-agent (Claude Code) should be visible in the timeline. The dashboard must track who spawned whom, what task was delegated, and the outcome.
- Event types to display:
  - Messages sent/received (input/output pairs)
  - Tool calls (which tool, parameters, results — expandable)
  - Model changes (which model, when)
  - Thinking/reasoning traces (when available)
  - File edits (what changed, diff view)
  - Session start/end
- Filter by: date range, event type, session, agent
- Search across all events (full text)
- Expand any event to see full trace (prompt → thinking → tool calls → output)
- Session browser: list all sessions, click into any one for full replay

**Priority:** P0 — This is the core differentiator.

---

### 2. Business Metrics Dashboard

**What:** Track business outcomes alongside agent activity. The "so what?" layer.

**Requirements:**
- Pluggable metrics sources (APIs, CSVs, JSON files)
- Built-in support for:
  - Calmart.ai product catalog (https://calmart.ai/api/products)
  - Tweet engagement metrics (from tweet logs)
  - Signup/conversion tracking
- KPI cards: signups today/week, tweets posted, engagement rate, revenue
- Trend charts: metrics over time (7d, 30d, 90d)
- Goal tracking with progress bars (configurable targets)
- Custom metric definitions (users can add their own data sources)

**Priority:** P2 — Core for product positioning as a "business dashboard."

---

### 3. Task Board (To-Do List)

**What:** Kanban-style task management that syncs with the agent's workspace.

**Requirements:**
- Read/write `TODO.md` (or structured `todo.json`) from the workspace
- Columns: Backlog, In Progress, Review, Done
- Drag-and-drop between columns
- Add/edit/delete tasks directly in the UI
- Task fields: title, description, priority (P0-P3), assignee (agent/human), due date, tags
- **Agent-created tasks:** `auto_created` flag + `auto_reason` (why the agent created it)
- **Time tracking:** `in_progress_at` + `previous_in_progress_at` (cycle time measurement)
- Agent can update tasks via file writes; dashboard reflects changes in real-time
- Task creation from activity timeline (right-click event → "create task from this")
- Filter by: assignee, priority, tag, date

**Priority:** P0 — Requested by user, core to daily workflow.

---

### 4. Sub-Agent Delegation View

**What:** Visibility into agent spawning, delegation, and results.

**Requirements:**
- List all active and completed sub-agent sessions
- Show: parent agent, task/delegation prompt, status (running/completed/failed), start time, duration
- Click into any sub-agent session to see its full activity trace
- Resource tracking: token usage per sub-agent, cumulative cost
- Kill/terminate sub-agents from the dashboard
- Real-time status updates (polling or WebSocket from gateway)
- **Spawn chain visibility:** Show the full chain of who spawned whom (e.g., Will → Cal → Claude Code). This is critical — if Cal delegates to Claude Code to build Mission Control, that delegation and all its work must be visible and traceable.

**Priority:** P1 — Important for multi-agent setups. Also: Mission Control should be able to observe its own creation.

---

### 5. Workspace File Explorer & Editor

**What:** Browse and edit agent workspace files directly from the dashboard.

**Requirements:**
- File tree view of the workspace directory
- Synced with workspace directory in near real-time
- Quick access to critical files (MEMORY.md, SOUL.md, HEARTBEAT.md, AGENTS.md, TODO.md, USER.md)
- Click to view any file with syntax highlighting
- Edit mode with save (writes directly to filesystem)
- Diff view: see what changed in a file (using git history)
- Semantic search across workspace files (Cmd+K) — reuse OpenClaw's memory search
- **Tagged memory entries:** daily notes and memory files support tags (tweet, research, bug, idea) for better filtering
- File change history (from git or filesystem watcher)
- Markdown preview for .md files
- Logs user changes to files and actions

**Priority:** P0 — Requested by user.

---

### 6. Environment Variables Manager

**What:** Vercel-style UI for viewing and managing environment variables / API keys.

**Requirements:**
- Read/write `.env` files in `~/.openclaw/` and workspace
- Display all env vars with values masked by default (••••••)
- Click to reveal individual values
- Add/edit/delete env vars
- Group by source (OpenClaw config, workspace .env, system)
- Validation: warn about common misconfigurations
- Import/export env vars (for backup/migration)
- **Encrypted storage:** sensitive values encrypted at rest (AES-256)
- Never log env var values in activity timeline

**Priority:** P0 — Requested by user.

---

### 7. Filesystem Watcher & Git Integration

**What:** Automatic logging and version control for all workspace changes.

**Requirements:**
- Background filesystem watcher (chokidar/fswatch) monitoring the workspace directory
- Log every file create/edit/delete to `memory/audit.jsonl`:
  ```json
  {"ts":"2026-03-28T14:25:00Z","type":"file_edited","path":"IDENTITY.md","size_before":450,"size_after":447,"agent":"cal"}
  ```
- Git auto-commit: commit workspace changes on a schedule (configurable, default: every 30 min or on significant changes)
- Show recent git history in the dashboard (commit log, diffs)
- Rollback: revert to any previous commit from the UI
- File change feed in the activity timeline
- Configurable watch paths (exclude node_modules, .git, etc.)

**Priority:** P0 — Proposed by Cal, strengthens the system of record.

---

### 8. Content & Social Pipeline

**What:** Track social media activity and content calendar for the agent.

**Requirements:**
- Read tweet logs (`memory/tweet_log.csv` or structured events)
- Display: tweets posted, engagement metrics (likes, retweets, replies, impressions)
- Content calendar view: scheduled vs posted content
- Engagement trends over time
- Filter by: date, engagement level, content type
- Link to original tweets

**Priority:** P2 — Nice to have, specific to our use case. Generalize for product.

---

### 9. System Health & Diagnostics

**What:** Dashboard health checks and system monitoring.

**Requirements:**
- Gateway status (connected/disconnected, latency)
- Browser health (Chrome debug port alive?)
- Cron jobs: list, status, last run, next run
- Agent status: active sessions, last heartbeat, model in use
- Disk/memory/CPU usage of the host
- One-click diagnostics (borrow from robsannaa's Doctor feature)
- Alert configuration: notify on failures

**Priority:** P1 — Already partially exists in robsannaa's fork.

---

### 10. Reports & Summaries

**What:** Auto-generated and manual reports on agent activity and business metrics.

**Requirements:**
- Daily standup summary (auto-generated from daily notes)
- Weekly review (structured from memory files)
- Custom date range reports
- Export as markdown or PDF
- Scheduled report generation (cron-triggered)
- Business report: KPIs, trends, recommendations

**Priority:** P2 — Can be added after core is stable.

---

## Non-Functional Requirements

- **Performance:** Dashboard loads in <2s. Activity timeline paginated/lazy-loaded (session JSONL files can be large).
- **Security:** Env vars never exposed in logs. Activity timeline respects file permissions. No remote data transmission.
- **Accessibility:** Keyboard-navigable. Screen reader compatible for key views.
- **Responsive:** Works on desktop and tablet. Mobile for viewing (not editing).
- **Extensibility:** Plugin system for adding custom pages. Error-isolated per plugin. For example, P2 dashboard and social media calendar can be plugins based on agent use case
- **Real-time:** SSE reconnection with exponential backoff (1s base, 2x factor, 0.2 jitter, 5min max). Live updates via WebSocket + SSE.
- **Multi-agent:** Support multiple agents on the same OpenClaw instance. Each agent's data isolated but comparable.

---

## Data Abstraction Layer

All data access goes through a thin abstraction layer:

```
┌─────────────────────────────────────┐
│           Dashboard UI              │
├─────────────────────────────────────┤
│        Data Abstraction Layer       │
│  (sessions, files, metrics, events) │
├──────────┬──────────┬───────────────┤
│ File     │ Git      │ Optional      │
│ Reader   │ History  │ SQLite (for   │
│ (JSONL,  │ (audit)  │ aggregation)  │
│ MD, env) │          │               │
└──────────┴──────────┴───────────────┘
```

**Phase 1:** All reads from filesystem (JSONL files, workspace files, git). No database.
**Phase 2:** Optional SQLite for aggregated metrics, search indexing, and historical queries.
**Phase 3:** Optional Postgres for multi-user, multi-agent deployments.

The abstraction layer means the UI never cares where data comes from. Swap storage backends without touching frontend code.

---

### 11. Plugin System — Custom Pages & Extensions

**What:** Users (and other OpenClaw agents) can add custom pages and dashboard extensions via a plugin system designed to scale into a full marketplace ecosystem.

**Requirements:**
- Plugin = a folder with a `manifest.json` + React component
- Manifest format (designed for marketplace compatibility from day one):
  ```json
  {
    "id": "com.example.sales-dashboard",
    "name": "Sales Dashboard",
    "version": "1.0.0",
    "description": "Track sales KPIs from your agent activity",
    "author": "Jane Doe",
    "license": "MIT",
    "icon": "BarChart3",
    "page": "Sales",
    "slots": ["sidebar", "widget"],
    "permissions": ["read:files", "read:sessions"],
    "dependencies": {},
    "marketplace": {
      "price": 0,
      "category": "metrics",
      "tags": ["sales", "kpi", "dashboard"]
    }
  }
  ```
- Dashboard scans plugins directory at startup, auto-registers pages in sidebar nav
- Plugins rendered in sandboxed routes (isolated from core)
- **Plugin API** — hooks injected into plugin context:
  - Data hooks: sessions, files, metrics, tasks (scoped by permissions)
  - Workspace file reader (read workspace files)
  - Sidebar nav slot (register a page)
  - Dashboard widget slot (add custom metric cards, charts to any view)
  - Event bus (subscribe to agent events in real-time)
  - Storage API (key-value store scoped to the plugin — for settings, cached data)
- **Permissions model** (designed for marketplace trust):
  - `read:files` — read workspace files
  - `write:files` — write workspace files (requires explicit user consent)
  - `read:sessions` — read session/timeline data
  - `read:metrics` — read business metrics
  - `read:tasks` — read/write tasks
  - `network` — make external API calls (requires explicit user consent)
  - Each permission requested at install time. User must approve.
- **Security sandbox:**
  - Error boundary per plugin (one crash doesn't break dashboard)
  - No access to env vars (ever)
  - No access to other plugins' storage
  - Scope-limited file system access (can't escape workspace)
  - External network calls only with `network` permission + user approval
- Plugin directory: `~/.openclaw/workspace/plugins/` (auto-detected)
- Hot reload: detect new/changed plugins and reload without restart
- **Versioning:** Plugins declare dependencies on Mission Control version range. Semver compatible.
- **Isolation:** Each plugin gets its own React context, scoped CSS, isolated state. No global side effects.

**Example plugin structure:**
```
plugins/
  my-custom-page/
    manifest.json      # Full manifest with permissions, marketplace metadata
    index.tsx          # React component with injected data hooks
    README.md          # Documentation
    assets/            # Optional static assets
```

**Priority:** P1 — Key differentiator. Architecture must support marketplace from day one, even though marketplace is Phase 3.

---

### 12. Approval Flow with Confidence Scoring

**What:** When the agent takes significant actions, it logs a confidence score. Low-confidence actions surface in the dashboard for human review.

**Requirements:**
- Agent logs confidence (0.0-1.0) alongside audit events for significant actions
- Dashboard shows an "Approvals" view filtering low-confidence actions
- Human can approve, reject, or request changes
- Approval history tracked with timestamps and decisions
- Configurable confidence threshold (default: surface anything below 0.7)
- Actions requiring approval: tweets, file edits to critical files, external API calls

**Priority:** P2 — Builds trust. Valuable for product positioning.

---

### 13. Budget & Cost Tracking

**What:** Visualize token usage and costs per agent, per model, over time.

**Requirements:**
- Aggregate token usage from session JSONL files
- Per-agent cost breakdown by provider (Anthropic, OpenAI, Google, etc.)
- Monthly budget with utilization percentage
- Status indicators: healthy / warning / hard_stop
- Quota bar visualization with visual thresholds
- Cost trends over time (daily, weekly, monthly)

**Priority:** P2 — Important for multi-agent cost management.

---

### 14. Goal Tracking Tree

**What:** Hierarchical goal tracking with progress indicators for business KPIs.

**Requirements:**
- Parent/child goal relationships (Company → Product → Metric)
- Progress bars per goal
- Link goals to metrics sources (auto-update from data)
- Configurable targets and deadlines
- Goal history: when was it set, when was it hit, milestones

**Priority:** P2 — Bridges business metrics to strategy.

---

## Out of Scope (for now)

- Multi-user authentication/authorization (single user, local-only)
- Cloud deployment / SaaS hosting
- Agent configuration management (use OpenClaw CLI for that)
- Custom model/provider configuration (use OpenClaw config)
- Mobile app
- Plugin marketplace (Phase 3 — architecture must support it, but marketplace itself is later)

---

## Phase 3 — Plugin Marketplace

### Business Model

**Dashboard: free and open source. Marketplace: the business.**

- Plugin marketplace where creators sell dashboard extensions, metric integrations, templates, and themes
- Revenue share: 70/30 (creator gets 70%, platform gets 30%) — matching industry standard (Notion, VS Code, Figma)
- We also sell first-party plugins (premium metric packs, enterprise templates)
- Marketplace drives distribution: every plugin install is a Mission Control user

### What People Would Sell

| Category | Examples |
|----------|---------|
| **Dashboard pages** | Sales dashboard, customer support tracker, dev metrics |
| **Metric sources** | Stripe, GitHub, Linear, Jira, Notion integrations |
| **Agent templates** | Pre-configured SOUL.md + skills + monitoring presets |
| **Themes** | Custom color schemes, layouts, branding |
| **Compliance** | Audit log exporters (SOC2, HIPAA, GDPR formats) |
| **Automation** | Auto-approve rules, notification workflows, report generators |

### Marketplace Requirements

- Browse/search plugins by category, popularity, rating
- One-click install from dashboard (downloads to plugins directory)
- Plugin reviews and ratings
- Version management (update, rollback)
- Plugin preview (screenshots, demo)
- Creator dashboard (analytics, earnings, version management)
- Payment processing (Stripe)
- License enforcement (paid plugins require license key)
- Security review process (plugins are vetted before listing, or marked "unverified")

### Architecture for Marketplace (design now, build later)

The plugin system in Phase 1 must be architected so marketplace is a natural extension:

1. **Manifest IDs are globally unique** (`com.creator.plugin-name`) — enables namespace resolution, dedup, updates
2. **Permissions model** — users approve what each plugin can do. Marketplace displays permissions at install. Critical for trust.
3. **Scoped plugin storage** — each plugin has isolated key-value storage. No touching other plugins' data.
4. **Version ranges** — plugins declare compatible Mission Control versions. Marketplace enforces compatibility.
5. **Plugin API is stable and documented** — marketplace creators build against a contract. We can't break it without major versioning.
6. **Sandboxed rendering** — plugins can't access the DOM outside their container. CSS scoped. No global state mutations. Critical when running untrusted code.
7. **Network permissions** — external API calls require explicit `network` permission. Marketplace plugins that need it must declare which domains they call.

### Success Metrics

- Dashboard installs: track GitHub stars/forks after open sourcing
- Time to value: user installs and sees meaningful data in <5 minutes
- Daily usage: Will (and beta users) check it daily for at least 2 weeks
- Agent traceability: any action can be traced back to its full context within 3 clicks
- Marketplace: 50+ plugins within 6 months of launch
- Marketplace revenue: $1K MRR within 3 months of marketplace launch
