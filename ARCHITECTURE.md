# Mission Control — Architecture Spec

## Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Framework | Next.js 15 + TypeScript | robsannaa's fork uses Next.js App Router. Already working — no reason to rewrite. |
| Styling | Tailwind CSS + shadcn/ui | Consistent, accessible components. Already in fork. |
| Charts | Recharts or Tremor | Lightweight, React-native charting for metrics. |
| Backend | Next.js API routes | File reads, gateway calls, and JSONL parsing all server-side via route handlers. |
| File watching | chokidar | Battle-tested Node.js file watcher. Added for filesystem audit log. |
| Git integration | simple-git (Node.js) | Programmatic git operations for workspace versioning. |
| Markdown | react-markdown + remark | Render .md files with preview. |
| Code editing | Monaco Editor | VS Code-grade editing. Already in fork (@monaco-editor/react). |
| Real-time | WebSocket (OpenClaw gateway) + SSE | Gateway already supports WS. Use it for live updates. |
| Build | Next.js (webpack mode) | `npm run build` — webpack flag already set in fork's package.json. |
| Package manager | npm | robsannaa's fork uses npm (package-lock.json present). |

**Note:** ARCHITECTURE.md originally specified Vite + Express. After studying the fork (which is a full Next.js app with Monaco, gateway integration, and extensive API routes already working), keeping Next.js is the right call. The fork is too mature to rewrite.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Browser (React)                       │
│  ┌─────────┬──────────┬──────────┬───────┬───────────┐  │
│  │Activity │  Tasks   │ Files    │ Env   │ Metrics   │  │
│  │Timeline │  Board   │ Explorer │ Vars  │ Dashboard │  │
│  └────┬────┴────┬─────┴────┬─────┴───┬───┴─────┬─────┘  │
│       │         │          │         │         │        │
│  ┌────┴─────────┴──────────┴─────────┴─────────┴─────┐  │
│  │              API Client (fetch/WS)                  │  │
│  └─────────────────────┬──────────────────────────────┘  │
└────────────────────────┼─────────────────────────────────┘
                         │ HTTP + WebSocket
┌────────────────────────┼─────────────────────────────────┐
│                  Mission Control API                      │
│  ┌─────────────────────┴──────────────────────────────┐  │
│  │              Data Abstraction Layer                 │  │
│  ├──────────┬──────────┬──────────┬──────────┬────────┤  │
│  │ Sessions │  Files   │   Git    │ Metrics  │ Events │  │
│  │ Reader   │  Manager │  Manager │  Aggr.   │ Logger │  │
│  ├──────────┴──────────┴──────────┴──────────┴────────┤  │
│  │              Filesystem Watcher                     │  │
│  └────────────────────────────────────────────────────┘  │
└───────┬────────────┬──────────────┬──────────────────────┘
        │            │              │
   ┌────┴───┐  ┌─────┴────┐  ┌─────┴──────────┐
   │Session │  │Workspace │  │  OpenClaw       │
   │JSONL   │  │Files     │  │  Gateway API    │
   │Files   │  │(md,env)  │  │  (WS + HTTP)    │
   └────────┘  └──────────┘  └────────────────┘
```

---

## Directory Structure

```
mission-control/
├── src/
│   ├── api/                    # Express server
│   │   ├── index.ts            # Server entry point
│   │   ├── routes/
│   │   │   ├── sessions.ts     # Session/timeline endpoints
│   │   │   ├── files.ts        # File explorer & editor
│   │   │   ├── tasks.ts        # To-do board CRUD
│   │   │   ├── env.ts          # Environment variables
│   │   │   ├── metrics.ts      # Business metrics
│   │   │   ├── agents.ts       # Sub-agent management
│   │   │   ├── git.ts          # Git history & operations
│   │   │   └── health.ts       # System health & diagnostics
│   │   └── middleware/
│   │       └── auth.ts         # Local-only auth (token-based)
│   ├── data/                   # Data abstraction layer
│   │   ├── session-reader.ts   # Parse session JSONL files
│   │   ├── file-manager.ts     # Read/write workspace files
│   │   ├── git-manager.ts      # Git operations via simple-git
│   │   ├── metrics-aggregator.ts # Collect & aggregate business metrics
│   │   ├── event-logger.ts     # Write to audit.jsonl
│   │   ├── todo-manager.ts     # Read/write TODO.md / todo.json
│   │   └── env-manager.ts      # Read/write .env files
│   ├── watchers/
│   │   ├── fs-watcher.ts       # chokidar filesystem watcher
│   │   └── git-auto-commit.ts  # Scheduled git commits
│   ├── components/             # React components
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx
│   │   │   ├── Header.tsx
│   │   │   └── CommandPalette.tsx  # Cmd+K
│   │   ├── timeline/
│   │   │   ├── ActivityFeed.tsx
│   │   │   ├── EventCard.tsx
│   │   │   ├── SessionReplay.tsx
│   │   │   └── EventDetail.tsx    # Full trace expand
│   │   ├── tasks/
│   │   │   ├── TaskBoard.tsx
│   │   │   ├── TaskColumn.tsx
│   │   │   └── TaskCard.tsx
│   │   ├── files/
│   │   │   ├── FileExplorer.tsx
│   │   │   ├── FileEditor.tsx     # Monaco
│   │   │   ├── MarkdownPreview.tsx
│   │   │   └── DiffView.tsx
│   │   ├── env/
│   │   │   └── EnvManager.tsx     # Vercel-style
│   │   ├── agents/
│   │   │   ├── AgentList.tsx
│   │   │   └── SubAgentDetail.tsx
│   │   ├── metrics/
│   │   │   ├── KPIGrid.tsx
│   │   │   ├── TrendChart.tsx
│   │   │   └── GoalTracker.tsx
│   │   └── health/
│   │       └── SystemStatus.tsx
│   ├── hooks/
│   │   ├── useWebSocket.ts     # Gateway WS connection
│   │   ├── usePolling.ts       # Fallback polling
│   │   └── useEvents.ts        # Real-time event stream
│   ├── plugins/
│   │   ├── plugin-loader.ts   # Discover, validate, and load plugins
│   │   ├── plugin-registry.ts # Track installed plugins, permissions, state
│   │   ├── plugin-sandbox.tsx # Error-isolated rendering container
│   │   ├── plugin-api.ts      # Hooks exposed to plugins (data, events, storage)
│   │   └── permissions.ts     # Permission checking and enforcement
│   ├── lib/
│   │   ├── openclaw.ts         # Gateway API client
│   │   ├── paths.ts            # Resolved OpenClaw paths
│   │   └── constants.ts
│   └── types/
│       ├── session.ts          # Session JSONL event types
│       ├── task.ts
│       ├── metrics.ts
│       └── events.ts           # Audit event schema
├── public/
├── package.json
├── vite.config.ts
├── tailwind.config.ts
└── README.md
```

---

## Key Data Schemas

### Session Event (from OpenClaw JSONL)

```typescript
interface SessionEvent {
  type: 'session' | 'message' | 'model_change' | 'thinking_level_change' | 'custom' | 'tool_call' | 'tool_result';
  id: string;
  parentId: string | null;
  timestamp: string; // ISO 8601
  // ... type-specific fields
}
```

### Audit Event (our filesystem watcher)

```typescript
interface AuditEvent {
  ts: string;           // ISO 8601
  type: 'file_created' | 'file_edited' | 'file_deleted';
  path: string;         // Relative to workspace
  size_before?: number;
  size_after?: number;
  agent?: string;       // 'cal', 'human', 'system'
  session_id?: string;  // Link to session if available
}
```

### Task

```typescript
interface Task {
  id: string;           // UUID
  title: string;
  description?: string;
  status: 'backlog' | 'in_progress' | 'review' | 'done';
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  assignee: string;     // 'cal', 'will', agent name
  due_date?: string;
  tags: string[];
  auto_created: boolean;       // Did the agent create this task itself?
  auto_reason?: string;        // Why the agent created it
  in_progress_at?: string;     // When moved to in_progress
  previous_in_progress_at?: string; // Previous in_progress timestamp (cycle time)
  created_at: string;
  updated_at: string;
  source_session_id?: string;  // Link to originating session event
}
```

### Business Metric

```typescript
interface MetricPoint {
  ts: string;
  metric: string;       // e.g., 'tweets_posted', 'signups', 'engagement_rate'
  value: number;
  metadata?: Record<string, any>;
}

interface MetricSource {
  name: string;
  type: 'api' | 'file' | 'csv' | 'json';
  config: Record<string, any>;
  metrics: string[];    // Metric names this source provides
}
```

---

## API Endpoints

### Sessions & Timeline

```
GET    /api/sessions                    # List all sessions
GET    /api/sessions/:id                # Get session details
GET    /api/sessions/:id/events         # Get events for a session (paginated)
GET    /api/events                      # Unified event feed (all sessions, paginated)
GET    /api/events/search?q=...         # Full-text search across events
```

### Files

```
GET    /api/files                       # List workspace files (tree)
GET    /api/files/*path                 # Read file contents
PUT    /api/files/*path                 # Write file contents
POST   /api/files/*path/diff            # Get git diff for a file
GET    /api/files/*/history             # Git commit history for a file
```

### Tasks

```
GET    /api/tasks                       # List all tasks
POST   /api/tasks                       # Create task
PUT    /api/tasks/:id                   # Update task
DELETE /api/tasks/:id                   # Delete task
PUT    /api/tasks/:id/move              # Move to different column
```

### Environment Variables

```
GET    /api/env                         # List all env vars (values masked)
GET    /api/env/:key                    # Get single env var (unmasked)
PUT    /api/env/:key                    # Set env var
DELETE /api/env/:key                    # Delete env var
POST   /api/env/import                  # Bulk import
GET    /api/env/export                  # Export all
```

### Metrics

```
GET    /api/metrics                     # Get all metric sources
GET    /api/metrics/:name               # Get metric data (with ?from=&to=)
POST   /api/metrics/sources             # Add metric source
GET    /api/metrics/goals               # Get goal tracking data
```

### Agents

```
GET    /api/agents                      # List all agents
GET    /api/agents/:id/subagents        # List sub-agents
GET    /api/agents/:id/subagents/:sid   # Get sub-agent detail
DELETE /api/agents/:id/subagents/:sid   # Kill sub-agent
```

### Git

```
GET    /api/git/log                     # Recent commits
GET    /api/git/diff?ref=...            # Diff between refs
POST   /api/git/commit                  # Manual commit
POST   /api/git/rollback?ref=...        # Rollback to commit
```

### Health

```
GET    /api/health                      # System health check
GET    /api/health/gateway              # Gateway connectivity
GET    /api/health/browser              # Chrome debug port
GET    /api/health/cron                 # Cron job status
```

### Plugins

```
GET    /api/plugins                     # List installed plugins
POST   /api/plugins/install             # Install plugin (from local path or URL)
DELETE /api/plugins/:id                 # Uninstall plugin
GET    /api/plugins/:id                 # Get plugin details + manifest
PUT    /api/plugins/:id/config          # Update plugin settings
GET    /api/plugins/:id/storage         # Get plugin's scoped storage
PUT    /api/plugins/:id/storage         # Update plugin's scoped storage
```

### Approvals

```
GET    /api/approvals                   # List actions pending approval (confidence < threshold)
PUT    /api/approvals/:id               # Approve/reject an action (body: { status: "approved" | "rejected" })
GET    /api/approvals/history           # Full approval history
```

### Budget & Cost

```
GET    /api/costs/summary               # Aggregate cost by agent/provider/model
GET    /api/costs/trends?from=&to=      # Cost over time (daily/weekly/monthly)
GET    /api/costs/budget                # Current budget settings + utilization
PUT    /api/costs/budget                # Update budget (monthly limit per agent)
```

### Goals

```
GET    /api/goals                       # List all goals (tree structure)
POST   /api/goals                       # Create goal
PUT    /api/goals/:id                   # Update goal (progress, target, deadline)
DELETE /api/goals/:id                   # Delete goal
GET    /api/goals/:id/children          # Get child goals
```

---

## Real-Time Updates

Two channels:

1. **OpenClaw Gateway WebSocket** — Subscribe to agent events in real-time. The gateway already pushes session events over WS. We tap into this stream.

2. **Filesystem Watcher (SSE)** — The server watches workspace files via chokidar and pushes file change events to the browser via Server-Sent Events. This catches changes made outside the dashboard (agent writes, direct file edits).

```typescript
// WebSocket: agent activity
ws://localhost:PORT/ws/agent-events

// SSE: file changes
GET /api/events/stream  →  text/event-stream
```

---

## Security Model

- **Local-only by default.** Dashboard binds to 127.0.0.1.
- **Optional auth token.** If exposed via Tailscale/reverse proxy, require a bearer token.
- **Path validation.** All file operations restricted to workspace directory. No path traversal.
- **Env var protection.** Values never included in API responses unless explicitly requested. Never logged.
- **No remote data.** Zero telemetry, no analytics, no phone-home.

---

## Storage Strategy

### Phase 1: Filesystem Only

| Data | Location | Format |
|------|----------|--------|
| Sessions | `~/.openclaw/agents/*/sessions/*.jsonl` | JSONL (OpenClaw native) |
| Tasks | `~/.openclaw/workspace/todo.json` | JSON |
| Audit log | `~/.openclaw/workspace/memory/audit.jsonl` | JSONL |
| Business metrics | `~/.openclaw/workspace/memory/metrics/` | JSONL per metric |
| Env vars | `~/.openclaw/.env`, workspace `.env` | dotenv |
| Git history | workspace `.git/` | Git |

### Phase 2: Optional SQLite

Add SQLite for:
- Aggregated metrics (daily rollups)
- Search index for events
- Caching parsed session data (sessions can be large)

Triggered by config flag: `storage.mode: "files" | "sqlite"`.

### Phase 3: Optional Postgres

For multi-user/multi-agent deployments. Same abstraction layer, different backend.

---

## Path Resolution

The dashboard needs to find OpenClaw data regardless of where it's installed:

```typescript
const paths = {
  openclawHome: process.env.OPENCLAW_HOME || path.join(os.homedir(), '.openclaw'),
  workspace: process.env.OPENCLAW_WORKSPACE || path.join(paths.openclawHome, 'workspace'),
  sessions: path.join(paths.openclawHome, 'agents'),
  gatewayUrl: process.env.OPENCLAW_GATEWAY_URL || 'http://127.0.0.1:18789',
};
```

Matches robsannaa's environment variable convention.
