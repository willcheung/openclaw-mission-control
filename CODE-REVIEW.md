# Mission Control — Code Review: Abhi & Paperclip

Analysis of what's worth stealing from each codebase for our Mission Control build.

---

## abhi1693/openclaw-mission-control

**Stack:** Next.js frontend + Python (FastAPI/SQLModel) backend + PostgreSQL
**Size:** 386 frontend files, full backend with 25+ DB migrations
**Verdict:** Well-built enterprise ops dashboard. Heavy for our needs, but excellent patterns to borrow.

### ✅ Worth Stealing

**1. Activity Event Model** (`backend/app/models/activity_events.py`)
- Clean, minimal event schema: `id, event_type, message, agent_id, task_id, board_id, created_at`
- **Steal:** Use this as inspiration for our audit event schema. The linking between events, agents, and tasks is exactly right.
- **Effort:** Already designed — just reference.

**2. Task Model** (`backend/app/models/tasks.py`)
- Solid task fields: `title, description, status, priority, due_at, in_progress_at, assigned_agent_id, auto_created, auto_reason`
- `auto_created` + `auto_reason` is clever — tracks whether the agent created the task itself and why
- `previous_in_progress_at` — tracks how long a task was previously in progress (cycle time)
- **Steal:** Adopt the `auto_created`/`auto_reason` pattern. Add `previous_in_progress_at` for time tracking.
- **Effort:** Add 3 fields to our task schema.

**3. Approval Flow** (`backend/app/models/approvals.py`)
- Approval model with: `action_type, payload (JSON), confidence (float), rubric_scores (JSON), status (pending/approved/rejected)`
- Confidence scoring + rubric is unique — the agent rates its own confidence before requesting approval
- **Steal:** The confidence concept. When our agent posts a tweet, logs confidence. When it makes a significant file edit, logs confidence. The dashboard can surface low-confidence actions for review.
- **Effort:** Medium — add confidence field to audit events, create approval view in dashboard.

**4. Board Memory** (`backend/app/models/board_memory.py`)
- Persistent memory attached to a project/board: `content, tags (JSON array), is_chat, source`
- Tags enable filtering memory by topic
- **Steal:** The concept of tagged memory entries. Our agent's daily notes could be tagged (tweet, research, bug, idea) for better filtering in the dashboard.
- **Effort:** Low — add tags to our daily note format.

**5. Activity Feed UI** (`frontend/src/components/activity/ActivityFeed.tsx`)
- Generic, typed feed component: `ActivityFeed<TItem>` with `renderItem` prop
- Clean empty/loading/error states
- **Steal:** The generic feed pattern. Use it as our timeline base.
- **Effort:** Low — it's a simple pattern.

**6. SSE Streaming with Backoff** (`frontend/src/app/activity/page.tsx`)
- Exponential backoff for SSE reconnection: `baseMs: 1000, factor: 2, jitter: 0.2, maxMs: 5min`
- `MAX_FEED_ITEMS: 300` with pagination at 200
- **Steal:** The reconnection strategy. Production-ready SSE handling.
- **Effort:** Low — copy the backoff config.

**7. Webhook System** (board webhooks + payloads)
- Boards can have webhooks that fire on events, with full payload history
- **Steal:** Interesting for Phase 3 — let users set up webhooks on agent events (e.g., "notify me on Slack when Cal posts a tweet").
- **Effort:** Medium — not Phase 1.

### ❌ Avoid

- **PostgreSQL + Alembic migrations** — We chose no-DB. Their migration history (25+ files) shows the pain we're avoiding.
- **Clerk auth** — Overkill for local-only. We need simple bearer token at most.
- **Organization/tenant model** — Multi-org tenancy adds complexity we don't need yet.
- **Next.js App Router** — Heavy for a dashboard. Vite + React Router is simpler and faster.

---

## paperclipai/paperclip

**Stack:** React + Vite + TypeScript (ui/) + Express + Drizzle ORM + PostgreSQL (server/) + monorepo with packages
**Size:** 693 frontend files, massive server with 80+ service files, embedded Postgres
**Verdict:** The most ambitious and well-architected of the three. A complete company orchestration platform. Lots to learn from, but fundamentally different scope.

### ✅ Worth Stealing

**1. Adapter Pattern** (`ui/src/adapters/`)
- Registry of UI adapter modules: Claude, Codex, Gemini, OpenCode, Cursor, OpenClaw Gateway, HTTP
- Each adapter: `type, label, parseStdoutLine, ConfigFields, buildAdapterConfig`
- Already has an `openclaw-gateway` adapter that parses OpenClaw's stdout format
- **Steal:** The adapter concept. For our multi-agent support, we could use adapters to normalize different agent types. The OpenClaw adapter already exists and handles stdout parsing.
- **Effort:** Medium — adapt their adapter interface for our session JSONL reader.

**2. Budget & Cost Tracking** (`ui/src/components/BillerSpendCard.tsx`, `BudgetPolicyCard.tsx`)
- Per-agent cost breakdown by provider (Anthropic, OpenAI, Google)
- Monthly budget with utilization percentage, hard_stop/warning/healthy status
- `formatCents()`, `formatTokens()` utility functions
- QuotaBar component with visual thresholds
- **Steal:** The cost card UI pattern and budget visualization. OpenClaw tracks token usage — we can surface it.
- **Effort:** Medium — need to aggregate token data from sessions.

**3. Plugin System** (`ui/src/plugins/`)
- Full plugin architecture: bridge runtime, slot system, dynamic loading
- Plugins register UI slots that get rendered inline with error isolation
- Plugin-to-host communication via HTTP REST
- **Steal:** The SLOT concept for extensibility. Not the full plugin system (too complex for Phase 1), but the idea that dashboard sections can be extended.
- **Effort:** High for full system. Low for just the slot concept.

**4. Live Updates** (`ui/src/context/LiveUpdatesProvider.tsx`, `server/src/realtime/live-events-ws.ts`)
- WebSocket-based live event streaming with company-scoped subscriptions
- Client-side toast notifications for events with cooldown (10s window, max 3 toasts)
- Query invalidation on live events (TanStack Query integration)
- Server-side: WS upgrade with JWT auth, company-scoped event subscriptions
- **Steal:** The live update architecture. Our dashboard should push real-time events via WS from the OpenClaw gateway + SSE from our file watcher.
- **Effort:** Medium — the OpenClaw gateway already supports WS.

**5. Agent Properties Panel** (`ui/src/components/AgentProperties.tsx`)
- Clean property display: status badge, role, title, adapter type, session ID, last error
- Reports-to chain (org chart linking)
- **Steal:** The properties panel pattern for our sub-agent detail view.
- **Effort:** Low.

**6. Kanban Board** (`ui/src/components/KanbanBoard.tsx`)
- Built-in Kanban component
- Priority icons, status badges, inline editing
- **Steal:** Evaluate for our task board. May be worth using directly or as reference.
- **Effort:** Low if we adapt it.

**7. Goal Tree** (`ui/src/components/GoalTree.tsx`, `GoalProperties.tsx`)
- Hierarchical goal tracking with parent/child relationships
- **Steal:** For our goal tracking feature (revenue targets, follower goals). Simple tree structure.
- **Effort:** Medium.

**8. Command Palette** (`ui/src/components/CommandPalette.tsx`)
- Built-in Cmd+K command palette
- **Steal:** Essential UX feature. Use their implementation as reference.
- **Effort:** Low.

**9. Markdown Editor** (`ui/src/components/MarkdownEditor.tsx`)
- In-browser markdown editing with preview
- **Steal:** Use for editing workspace .md files (SOUL.md, MEMORY.md, etc.)
- **Effort:** Low — likely a library we can drop in.

**10. Secrets/Env Management** (`server/src/secrets/`)
- `local-encrypted-provider.ts` — encrypts secrets at rest
- `provider-registry.ts` — pluggable secret providers
- **Steal:** The encrypted storage concept for env vars. Our env manager should encrypt sensitive values.
- **Effort:** Medium — need encryption key management.

### ❌ Avoid

- **Monorepo complexity** — packages/shared, packages/db, packages/adapter-*, etc. Over-engineered for our scope.
- **PostgreSQL + Drizzle** — Same as abhi. We're file-first.
- **Multi-company isolation** — Not needed yet.
- **Plugin worker manager** — Plugins spawning workers is enterprise-level. Skip.
- **Better Auth** — Full auth system overkill for local dashboard.

---

## Priority Steal List

| # | What | Source | Effort | Phase |
|---|------|--------|--------|-------|
| 1 | SSE reconnection with backoff | abhi activity page | Low | 1 |
| 2 | Generic ActivityFeed component pattern | abhi ActivityFeed.tsx | Low | 1 |
| 3 | Task model with auto_created/auto_reason | abhi tasks.py | Low | 2 |
| 4 | Command palette (Cmd+K) | paperclip CommandPalette.tsx | Low | 2 |
| 5 | Agent properties panel pattern | paperclip AgentProperties.tsx | Low | 3 |
| 6 | Kanban board component | paperclip KanbanBoard.tsx | Low | 2 |
| 7 | Markdown editor for .md files | paperclip MarkdownEditor.tsx | Low | 1 |
| 8 | Live updates (WS + SSE) architecture | paperclip LiveUpdatesProvider.tsx | Medium | 1 |
| 9 | Budget/cost visualization | paperclip BillerSpendCard.tsx | Medium | 3 |
| 10 | Approval flow with confidence scoring | abhi approvals.py | Medium | 3 |
| 11 | Encrypted env var storage | paperclip secrets/ | Medium | 2 |
| 12 | Adapter pattern for multi-agent support | paperclip adapters/ | Medium | 3 |
| 13 | Goal tree for KPI tracking | paperclip GoalTree.tsx | Medium | 3 |
| 14 | Tagged memory entries | abhi board_memory.py | Low | 2 |
| 15 | Webhook system for event notifications | abhi webhooks | Medium | 4 |

---

## Anti-Patterns to Avoid

1. **Database-first design** — Both abhi and paperclip start with a DB. We start with files. Don't let their schema influence us to add a DB prematurely.
2. **Multi-tenancy complexity** — Both have org/company scoping everywhere. We're single-user. Don't add tenant_id to every model "just in case."
3. **Full auth systems** — Clerk (abhi) and Better Auth (paperclip) are overkill. Simple bearer token or no auth.
4. **Monorepo** — Paperclip's 5-package monorepo is great for a team but adds friction for a solo project. Single repo, single package.
5. **Next.js** — Abhi uses it, but it's SSR-oriented. Our dashboard is a local SPA. Vite is the right call.
