/**
 * GET /api/sessions/history/events?id=<base64url-path>&page=0&pageSize=100
 *
 * Reads a JSONL session file and returns paginated events.
 * The `id` param is a base64url-encoded absolute file path.
 *
 * Security: validates the resolved path stays inside ~/.openclaw/agents/
 */

import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join, resolve } from "path";
import { getOpenClawHome } from "@/lib/paths";

export const dynamic = "force-dynamic";

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 100;

// ── Types matching OpenClaw JSONL schema ─────────────────────────────────────

type RawEvent = Record<string, unknown>;

type ParsedEvent = {
  raw: RawEvent;
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string | null;
  // Derived / enriched fields for UI
  role?: string;
  textContent?: string;
  thinking?: string;
  toolCalls?: ToolCallSummary[];
  toolResults?: ToolResultSummary[];
  modelId?: string;
  provider?: string;
  usage?: TokenUsage;
  diff?: string;
};

type ToolCallSummary = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

type ToolResultSummary = {
  toolCallId: string;
  toolName: string;
  content: string;
  diff?: string;
};

type TokenUsage = {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  total: number;
};

// ── Path safety ──────────────────────────────────────────────────────────────

function safeResolvePath(encodedId: string): string | null {
  let decoded: string;
  try {
    decoded = Buffer.from(encodedId, "base64url").toString("utf-8");
  } catch {
    return null;
  }

  const home = getOpenClawHome();
  const allowedBase = join(home, "agents");
  const resolved = resolve(decoded);

  // Must be inside ~/.openclaw/agents/ and end in .jsonl
  if (!resolved.startsWith(allowedBase + "/")) return null;
  if (!resolved.endsWith(".jsonl")) return null;

  return resolved;
}

// ── Event parsing ────────────────────────────────────────────────────────────

function parseEvent(raw: RawEvent): ParsedEvent {
  const type = String(raw.type ?? "unknown");
  const id = String(raw.id ?? `${type}-${Math.random()}`);
  const parentId = raw.parentId != null ? String(raw.parentId) : null;
  const timestamp = typeof raw.timestamp === "string" ? raw.timestamp : null;

  const event: ParsedEvent = { raw, type, id, parentId, timestamp };

  if (type === "message") {
    const msg = raw.message as Record<string, unknown> | undefined;
    if (!msg) return event;

    event.role = String(msg.role ?? "unknown");

    const content = msg.content;
    if (Array.isArray(content)) {
      const textParts: string[] = [];
      const toolCalls: ToolCallSummary[] = [];
      const toolResults: ToolResultSummary[] = [];

      for (const part of content as Record<string, unknown>[]) {
        if (part.type === "text" && typeof part.text === "string") {
          textParts.push(part.text);
        } else if (part.type === "thinking" && typeof part.thinking === "string") {
          event.thinking = part.thinking;
        } else if (part.type === "toolCall") {
          toolCalls.push({
            id: String(part.id ?? ""),
            name: String(part.name ?? ""),
            args: (part.arguments as Record<string, unknown>) ?? {},
          });
        } else if (part.type === "toolResult") {
          // inline tool result
          const resultContent = part.content;
          let contentStr = "";
          if (Array.isArray(resultContent)) {
            contentStr = (resultContent as Record<string, unknown>[])
              .filter((c) => c.type === "text")
              .map((c) => String(c.text ?? ""))
              .join("\n");
          } else if (typeof resultContent === "string") {
            contentStr = resultContent;
          }
          const details = part.details as Record<string, unknown> | undefined;
          toolResults.push({
            toolCallId: String(part.toolCallId ?? part.id ?? ""),
            toolName: String(part.toolName ?? part.name ?? ""),
            content: contentStr,
            diff: typeof details?.diff === "string" ? details.diff : undefined,
          });
        }
      }

      if (textParts.length) event.textContent = textParts.join("\n");
      if (toolCalls.length) event.toolCalls = toolCalls;
      if (toolResults.length) event.toolResults = toolResults;

      // tool_result role (separate message with role: toolResult)
    } else if (msg.role === "toolResult") {
      const contentArr = msg.content as Record<string, unknown>[] | undefined;
      if (Array.isArray(contentArr)) {
        event.textContent = contentArr
          .filter((c) => c.type === "text")
          .map((c) => String(c.text ?? ""))
          .join("\n");
      }
      const details = msg.details as Record<string, unknown> | undefined;
      if (typeof details?.diff === "string") event.diff = details.diff;

      event.toolResults = [
        {
          toolCallId: String(msg.toolCallId ?? ""),
          toolName: String(msg.toolName ?? ""),
          content: event.textContent ?? "",
          diff: event.diff,
        },
      ];
    }

    // Usage (present on assistant messages)
    const usage = msg.usage as Record<string, unknown> | undefined;
    if (usage) {
      event.usage = {
        input: Number(usage.input ?? 0),
        output: Number(usage.output ?? 0),
        cacheRead: Number(usage.cacheRead ?? 0),
        cacheWrite: Number(usage.cacheWrite ?? 0),
        total: Number(usage.totalTokens ?? usage.total ?? 0),
      };
      event.modelId = typeof msg.model === "string" ? msg.model : undefined;
      event.provider = typeof msg.provider === "string" ? msg.provider : undefined;
    }
  } else if (type === "model_change") {
    event.modelId = typeof raw.modelId === "string" ? raw.modelId : undefined;
    event.provider = typeof raw.provider === "string" ? raw.provider : undefined;
  } else if (type === "tool_call") {
    // Some formats emit standalone tool_call events
    event.toolCalls = [
      {
        id: String(raw.id ?? ""),
        name: String(raw.name ?? ""),
        args: (raw.arguments as Record<string, unknown>) ?? {},
      },
    ];
  } else if (type === "tool_result") {
    const content = raw.content;
    let contentStr = "";
    if (Array.isArray(content)) {
      contentStr = (content as Record<string, unknown>[])
        .filter((c) => c.type === "text")
        .map((c) => String(c.text ?? ""))
        .join("\n");
    } else if (typeof content === "string") {
      contentStr = content;
    }
    event.toolResults = [
      {
        toolCallId: String(raw.toolCallId ?? ""),
        toolName: String(raw.toolName ?? ""),
        content: contentStr,
      },
    ];
  }

  return event;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const encodedId = searchParams.get("id");
  if (!encodedId) {
    return NextResponse.json({ error: "id param required" }, { status: 400 });
  }

  const filePath = safeResolvePath(encodedId);
  if (!filePath) {
    return NextResponse.json({ error: "invalid or unsafe path" }, { status: 400 });
  }

  const page = Math.max(0, parseInt(searchParams.get("page") ?? "0", 10));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(searchParams.get("pageSize") ?? String(DEFAULT_PAGE_SIZE), 10))
  );

  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err) {
    return NextResponse.json({ error: `Cannot read file: ${String(err)}` }, { status: 404 });
  }

  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const allEvents: ParsedEvent[] = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as RawEvent;
      allEvents.push(parseEvent(obj));
    } catch {
      // skip malformed lines
    }
  }

  const total = allEvents.length;
  const start = page * pageSize;
  const end = Math.min(start + pageSize, total);
  const pageEvents = allEvents.slice(start, end);

  return NextResponse.json({
    total,
    page,
    pageSize,
    hasMore: end < total,
    events: pageEvents,
  });
}
