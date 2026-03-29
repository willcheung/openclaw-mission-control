# OpenClaw Mission Control

**The open-source audit log and system of record for OpenClaw agents.**

OpenClaw Mission Control is a self-hosted AI agent audit log and activity tracker for [OpenClaw](https://github.com/openclaw). It answers the question you'll inevitably ask: *what did my agent actually do?*

![Self-Hosted](https://img.shields.io/badge/Self--Hosted-Local_AI-f59e0b?style=flat-square) ![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square) ![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square) ![Tests](https://img.shields.io/badge/Tests-105_passing-22c55e?style=flat-square)

---

## What It Does

Running autonomous AI agents means giving up direct visibility into what's happening. Mission Control gives it back.

- **Activity Timeline** — replay any agent session event by event: messages, thinking traces, tool calls, diffs, model switches; **live-updates automatically** when sessions change
- **Filesystem Audit Log** — every file create/edit/delete in your workspace is recorded to `memory/audit.jsonl` and streamed live over SSE
- **Git Auto-Commit** — workspace changes are committed automatically every 30 minutes with descriptive messages; roll back to any point
- **Environment Variables** — read and write `.env` files directly from the browser, values masked by default
- **File Explorer** — browse, edit, and search all workspace files; critical files (MEMORY.md, SOUL.md, HEARTBEAT.md, etc.) are one click away
- **Cmd+K Search** — semantic search across your entire workspace
- Full **agent management**, **chat**, **cron jobs**, **usage tracking**, **memory**, **models**, **terminal**, and **health diagnostics**

Everything runs on your machine. No cloud, no accounts, no telemetry.

---

## Why OpenClaw Mission Control

**You should never have to ask "what did my agent do?"**

Most agent dashboards show you status. OpenClaw Mission Control shows you *history* — the complete, unambiguous record of what was decided, why, and what changed as a result. It's built for solo founders and small teams running OpenClaw who need accountability without complexity.

**Zero additional infrastructure.** No database, no external services. Mission Control reads directly from OpenClaw's session files, workspace, and gateway API. If Mission Control goes down, your agents keep running untouched.

**Local-first.** Everything stays on your machine. Point it at a different OpenClaw setup with a single env var.

---

## Core Features

### Activity Timeline (`/timeline`)

A full chronological session browser. Select any session from the list and replay it event by event.

- Scans `~/.openclaw/agents/*/sessions/*.jsonl` — covers main agent and all sub-agents (Claude Code, Codex, etc.)
- **Live updates** — subscribes to the SSE event stream; when any `.jsonl` file changes the session list refreshes automatically (debounced 500ms). A status indicator in the header shows `Live`, `Connecting…`, or `Disconnected`
- **Filter by:** agent, date range, text search
- **Event types:** user/assistant messages, thinking traces (collapsible), tool calls with args (expandable), tool results with diffs, model changes
- Virtual scrolling via `@tanstack/react-virtual` — handles 1000+ event sessions without jank
- Paginated loading (100 events/page) with load-more

### Filesystem Watcher

Starts automatically when the server boots. No configuration.

- Watches your workspace directory via chokidar
- Writes structured audit events to `memory/audit.jsonl`
- Streams change events to the browser in real time over SSE (`GET /api/events/stream`)
- Ignores noise: `node_modules`, `.git`, `.next`, `dist`, build artifacts, editor temp files

### Git Integration

Auto-commits uncommitted workspace changes every 30 minutes.

```
GET  /api/git           — current branch, dirty flag, ahead/behind
GET  /api/git/log       — recent commit history
GET  /api/git/diff      — file diffs (supports file + ref params)
POST /api/git/commit    — manual commit with optional message
POST /api/git/rollback  — revert to any commit ref
```

### Environment Variables (`/env`)

Vercel-style editor for `.env` files — no terminal required.

- Reads and writes `~/.openclaw/.env` and workspace `.env` directly
- Values masked by default; click the eye icon to reveal
- Inline edit, add, and delete; grouped by source
- Values are never logged or included in audit events

### Document Explorer (`/docs`)

Browse all workspace files with a Monaco editor and live Markdown preview. A **Quick Access** panel is pinned above the file list for instant access to MEMORY.md, SOUL.md, HEARTBEAT.md, AGENTS.md, USER.md, and TODO.md.

---

## Quick Start

### Prerequisites

[OpenClaw](https://github.com/openclaw) must be installed and running.

```bash
openclaw --version   # verify
```

### Install

```bash
cd ~/.openclaw
git clone <this-repo> mission-control
cd mission-control
./setup.sh
```

Open `http://localhost:3333`.

**Other ways to start:**

```bash
PORT=8080 ./setup.sh              # different port
./setup.sh --dev --no-service     # dev mode, no background service
npm install && npm run dev        # manual
```

> OpenClaw Mission Control automatically finds your `~/.openclaw` directory. Nothing to configure.

---

## Development

```bash
npm run dev          # start dev server at http://localhost:3000
npm test             # 105 unit tests (Jest + ts-jest)
npm run test:e2e     # Playwright e2e (requires running dev server)
npm run test:coverage
npm run build        # production build
```

### Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── sessions/history/   — session listing + event pagination
│   │   ├── events/             — audit log + SSE stream
│   │   ├── git/                — status, log, diff, commit, rollback
│   │   ├── env/                — env var CRUD
│   │   └── docs/               — file explorer read/write
│   └── (pages)/
├── components/
│   ├── timeline-view.tsx       — activity timeline UI
│   ├── env-manager-view.tsx    — env vars UI
│   └── docs-view.tsx           — file explorer UI
└── lib/
    ├── fs-watcher.ts           — chokidar watcher + SSE pub/sub
    ├── git-manager.ts          — simple-git operations + auto-commit
    ├── env-manager.ts          — .env file parser/serializer
    └── paths.ts                — OpenClaw home/workspace detection
```

---

## Configuration

Everything is auto-detected. Override with environment variables if needed:

| Variable | Default | Description |
|---|---|---|
| `OPENCLAW_HOME` | `~/.openclaw` | OpenClaw data directory |
| `OPENCLAW_BIN` | Auto-detected | Path to the `openclaw` binary |
| `OPENCLAW_WORKSPACE` | Auto-detected | Default workspace folder |
| `OPENCLAW_TRANSPORT` | `auto` | Gateway transport: `auto`, `http`, or `cli` |
| `OPENCLAW_GATEWAY_URL` | `http://127.0.0.1:18789` | Gateway address |
| `OPENCLAW_GATEWAY_TOKEN` | _(empty)_ | Bearer token for authenticated gateway access |

---

## Remote Access

```bash
ssh -N -L 3333:127.0.0.1:3333 user@your-server
```

Then open `http://localhost:3333` locally.

---

## FAQ

<details>
<summary><strong>"OpenClaw not found"</strong></summary>

```bash
OPENCLAW_BIN=$(which openclaw) npm run dev
```

Or [install OpenClaw](https://docs.openclaw.ai/install) first.
</details>

<details>
<summary><strong>Does this send data anywhere?</strong></summary>

No. Mission Control only talks to your local OpenClaw installation. No analytics, no tracking, no cloud calls.
</details>

<details>
<summary><strong>Multiple OpenClaw setups?</strong></summary>

```bash
OPENCLAW_HOME=/path/to/other/.openclaw npm run dev -- --port 3001
```
</details>

---

## License

MIT

---

_Built on top of the [openclaw-mission-control](https://github.com/robsannaa/openclaw-mission-control) open-source base._
