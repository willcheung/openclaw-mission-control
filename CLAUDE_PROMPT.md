# Mission Control Build Prompt

You are building **Mission Control** — the system of record for AI agent action. Open-source dashboard for OpenClaw. Core promise: *If an agent did it, Mission Control knows.*

## Specs

Read all files in `~/.openclaw/workspace/mission-control/` before writing code:
- `REQUIREMENTS.md` — **authoritative.** All features, priorities, constraints.
- `ARCHITECTURE.md` — tech stack, schemas, API endpoints.
- `IMPLEMENTATION.md` — phased build plan with checklists.
- `CODE-REVIEW.md` — patterns to steal from competing projects.

REQUIREMENTS.md is the contract. ARCHITECTURE.md and IMPLEMENTATION.md are reference — revise them if you see a better approach after studying the codebase.

## Start

1. Clone `https://github.com/robsannaa/openclaw-mission-control`
2. Study the codebase
3. Build Phase 0, verify it works, then Phase 1
4. **After every change: run the build and verify it passes.** No type errors.
5. Update ARCHITECTURE.md and IMPLEMENTATION.md if you revise the design

## Rules

- No database. No external data transmission. Local-only.
- TypeScript strict mode. pnpm.
- All file ops must validate paths (no traversal).
- Env var values NEVER logged.

## OpenClaw data locations

- Sessions: `~/.openclaw/agents/*/sessions/*.jsonl`
- Workspace: `~/.openclaw/workspace/`
- Gateway: `http://127.0.0.1:18789`
- Env vars: `OPENCLAW_HOME`, `OPENCLAW_WORKSPACE`, `OPENCLAW_GATEWAY_URL`, `OPENCLAW_GATEWAY_TOKEN`
