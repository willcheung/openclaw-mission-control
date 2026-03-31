"use client";

/**
 * TimelineView — Activity Timeline (System of Record)
 *
 * Reads JSONL session files directly from ~/.openclaw/agents/
 * and renders a full chronological event feed: messages, thinking,
 * tool calls, model changes, file diffs.
 */

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Cpu,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Search,
  Filter,
  FileText,
  FilePlus,
  FileEdit,
  FolderSearch,
  Terminal,
  User,
  Bot,
  ChevronLeft,
  Database,
  Brain,
  CalendarRange,
  Globe,
  Eye,
  MousePointerClick,
  Camera,
  Keyboard,
  Download,
  ImageIcon,
  Users,
  ListTree,
  Activity,
  CheckSquare,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { stripAnsi } from "@/lib/ansi";
import { SectionBody, SectionHeader, SectionLayout } from "@/components/section-layout";
import { LoadingState } from "@/components/ui/loading-state";

// ── SSE helpers ───────────────────────────────────────────────────────────────

/**
 * Returns true if a workspace-relative file path belongs to a session JSONL
 * file — i.e. a change to this file should trigger a session list refresh.
 * Exported for unit testing.
 */
export function isSessionFileEvent(path: string): boolean {
  return path.endsWith(".jsonl");
}

// ── Types ─────────────────────────────────────────────────────────────────────

type SessionMeta = {
  id: string;
  agent: string;
  sessionId: string;
  filename: string;
  sizeBytes: number;
  mtimeMs: number;
  firstEventTs: string | null;
  lastEventTs: string | null;
  model: string | null;
  eventCount: number;
  summary: string | null;
  toolNames: string[] | null;
};

type ActivityEvent = {
  id: string;
  type: "cron" | "session" | "log" | "system";
  timestamp: number;
  title: string;
  detail?: string;
  status?: "ok" | "error" | "info" | "warning";
  source?: string;
};

type TimelineItem =
  | { kind: "session"; data: SessionMeta; sortTs: number }
  | { kind: "activity"; data: ActivityEvent; sortTs: number };

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

type ParsedEvent = {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string | null;
  role?: string;
  textContent?: string;
  thinking?: string;
  toolCalls?: ToolCallSummary[];
  toolResults?: ToolResultSummary[];
  modelId?: string;
  provider?: string;
  usage?: TokenUsage;
  diff?: string;
  raw: Record<string, unknown>;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(ts: string | null): string {
  if (!ts) return "—";
  const diff = Date.now() - new Date(ts).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatTs(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(2)}MB`;
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + "…";
}

function agentBadgeClass(agent: string): string {
  const map: Record<string, string> = {
    main: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
    "claude-code": "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300",
    codex: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  };
  return map[agent] ?? "bg-stone-100 text-stone-600 dark:bg-stone-700/60 dark:text-stone-300";
}

// ── Session List Item ────────────────────────────────────────────────────────

function SessionListItem({
  session: s,
  selected,
  onSelect,
}: {
  session: SessionMeta;
  selected: boolean;
  onSelect: () => void;
}) {
  const MAX_TOOLS = 4;
  const tools = s.toolNames ?? [];
  const shown = tools.slice(0, MAX_TOOLS);
  const overflow = tools.length - MAX_TOOLS;

  return (
    <button
      onClick={onSelect}
      className={cn(
        "flex flex-col gap-1 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-stone-100 dark:hover:bg-stone-800/60",
        selected && "bg-stone-100 ring-1 ring-stone-200 dark:bg-stone-800/60 dark:ring-stone-700"
      )}
    >
      {/* Row 1: agent badge + session id + time */}
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium",
            agentBadgeClass(s.agent)
          )}
        >
          {s.agent}
        </span>
        <span className="truncate font-mono text-xs text-stone-500 dark:text-stone-400">
          {s.sessionId.slice(0, 8)}
        </span>
        <span className="ml-auto shrink-0 text-[11px] text-stone-400 dark:text-stone-500">
          {timeAgo(s.lastEventTs ?? (s.mtimeMs ? new Date(s.mtimeMs).toISOString() : null))}
        </span>
      </div>

      {/* Row 2: summary */}
      {s.summary && (
        <p className="line-clamp-2 text-xs leading-relaxed text-stone-600 dark:text-stone-400">
          {s.summary}
        </p>
      )}

      {/* Row 3: model + tool pills + size + events */}
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-stone-400 dark:text-stone-500">
        {s.model && <span>{s.model}</span>}
        {shown.map((t) => {
          const { color } = toolMeta(t);
          return (
            <span
              key={t}
              className={cn(
                "inline-flex items-center rounded-full bg-stone-100 px-1.5 py-0.5 font-mono text-[10px] dark:bg-stone-700/50",
                color
              )}
            >
              {t}
            </span>
          );
        })}
        {overflow > 0 && (
          <span className="text-[10px] text-stone-400 dark:text-stone-500">+{overflow}</span>
        )}
        <span>{formatBytes(s.sizeBytes)}</span>
        <span>~{s.eventCount} lines</span>
      </div>
    </button>
  );
}

// ── Activity Card ────────────────────────────────────────────────────────────

function ActivityCard({ event }: { event: ActivityEvent }) {
  const statusColors: Record<string, string> = {
    ok: "border-l-emerald-500 bg-emerald-50/30 dark:bg-emerald-500/5",
    error: "border-l-red-500 bg-red-50/30 dark:bg-red-500/5",
    warning: "border-l-amber-500 bg-amber-50/30 dark:bg-amber-500/5",
    info: "border-l-sky-500 bg-sky-50/30 dark:bg-sky-500/5",
  };

  const typeIcons: Record<string, LucideIcon> = {
    cron: CalendarRange,
    session: Activity,
    log: Terminal,
    system: Database,
  };

  const Icon = typeIcons[event.type] ?? Activity;
  const colorClass = event.status ? statusColors[event.status] ?? "border-l-stone-300 dark:border-l-stone-600" : "border-l-stone-300 dark:border-l-stone-600";

  return (
    <div className={cn("flex items-start gap-3 rounded-lg border-l-2 px-3.5 py-2.5", colorClass)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-stone-400 dark:text-stone-500" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-stone-700 dark:text-stone-200">{event.title}</span>
          {event.status && (
            <span className={cn(
              "rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase",
              event.status === "ok" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
              event.status === "error" && "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
              event.status === "warning" && "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
              event.status === "info" && "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
            )}>
              {event.status}
            </span>
          )}
          <span className="ml-auto shrink-0 text-[11px] text-stone-400 dark:text-stone-500">
            {timeAgo(new Date(event.timestamp).toISOString())}
          </span>
        </div>
        {event.detail && (
          <p className="mt-0.5 line-clamp-1 text-xs text-stone-500 dark:text-stone-400">{event.detail}</p>
        )}
      </div>
    </div>
  );
}

// ── Tool icon / color lookup ───────────────────────────────────────────────────

type ToolMeta = { icon: LucideIcon; color: string };

function toolMeta(name: string): ToolMeta {
  const n = name.toLowerCase();

  // Terminal / shell execution
  if (/^(exec|bash|shell|run_command|execute|terminal|run_terminal|computer)$/.test(n) ||
      /\b(exec|bash|shell)\b/.test(n))
    return { icon: Terminal, color: "text-amber-600 dark:text-amber-400" };

  // File write / create
  if (/^(write|write_file|create_file|save_file|file_write|str_replace_editor)$/.test(n) ||
      /\b(write|create)\b/.test(n))
    return { icon: FilePlus, color: "text-emerald-600 dark:text-emerald-400" };

  // File edit / patch
  if (/^(edit|edit_file|patch|str_replace|replace|update_file|file_edit)$/.test(n) ||
      /\b(edit|patch|replace)\b/.test(n))
    return { icon: FileEdit, color: "text-blue-600 dark:text-blue-400" };

  // File read / view
  if (/^(read|read_file|view|cat|file_read|open_file)$/.test(n) ||
      /\b(read|view)\b/.test(n))
    return { icon: FileText, color: "text-stone-500 dark:text-stone-400" };

  // Glob / file search / ls / find
  if (/^(glob|find|ls|list_files|list_dir|directory|folder|file_search)$/.test(n) ||
      /\b(glob|find|ls)\b/.test(n))
    return { icon: FolderSearch, color: "text-violet-600 dark:text-violet-400" };

  // Grep / content search
  if (/^(grep|search_files|search_code|search_text|ripgrep|rg)$/.test(n) ||
      /\b(grep|search_files)\b/.test(n))
    return { icon: Search, color: "text-violet-600 dark:text-violet-400" };

  // Web search
  if (/^(web_search|search_web|google|bing|serpapi|brave_search)$/.test(n) ||
      /\b(web_search|search_web)\b/.test(n))
    return { icon: Search, color: "text-sky-600 dark:text-sky-400" };

  // Web fetch / HTTP
  if (/^(web_fetch|fetch|http|curl|wget|url_fetch|get_url|scrape)$/.test(n) ||
      /\b(fetch|http|curl)\b/.test(n))
    return { icon: Download, color: "text-sky-600 dark:text-sky-400" };

  // Browser navigate
  if (/^(browser_navigate|navigate|goto|browser_open)$/.test(n) ||
      /\b(navigate|browser)\b/.test(n))
    return { icon: Globe, color: "text-sky-600 dark:text-sky-400" };

  // Browser click / interact
  if (/^(browser_click|click|browser_select|browser_drag|browser_hover)$/.test(n) ||
      /\b(click|select|hover|drag)\b/.test(n))
    return { icon: MousePointerClick, color: "text-sky-500 dark:text-sky-300" };

  // Browser type / fill
  if (/^(browser_type|browser_fill|browser_fill_form|type_text|input)$/.test(n) ||
      /\b(type|fill|input)\b/.test(n))
    return { icon: Keyboard, color: "text-sky-500 dark:text-sky-300" };

  // Browser screenshot / vision
  if (/^(browser_take_screenshot|screenshot|browser_snapshot|browser_vision|vision)$/.test(n) ||
      /\b(screenshot|snapshot|vision)\b/.test(n))
    return { icon: Camera, color: "text-sky-500 dark:text-sky-300" };

  // Browser misc (press key, wait, evaluate, etc.)
  if (/^browser_/.test(n))
    return { icon: Globe, color: "text-sky-500 dark:text-sky-300" };

  // Image generation / manipulation
  if (/^(image|generate_image|image_gen|dall_e|stable_diffusion|img)$/.test(n) ||
      /\b(image|img)\b/.test(n))
    return { icon: ImageIcon, color: "text-pink-600 dark:text-pink-400" };

  // Memory
  if (/^(memory_search|memory_write|memory_read|memory_update|memory|remember|recall)$/.test(n) ||
      /\b(memory|remember|recall)\b/.test(n))
    return { icon: Brain, color: "text-purple-600 dark:text-purple-400" };

  // Agent / session spawning / subagents
  if (/^(sessions_spawn|spawn|subagents|agent_spawn|delegate|handoff)$/.test(n) ||
      /\b(spawn|subagent|delegate|handoff)\b/.test(n))
    return { icon: Users, color: "text-indigo-600 dark:text-indigo-400" };

  // Session management / history / list
  if (/^(sessions_list|sessions_history|sessions_yield|sessions_search|process)$/.test(n) ||
      /\b(session|history)\b/.test(n))
    return { icon: ListTree, color: "text-stone-500 dark:text-stone-400" };

  // Process / system activity
  if (/^(activity|process|ps|kill|signal|service)$/.test(n))
    return { icon: Activity, color: "text-orange-600 dark:text-orange-400" };

  // Todo / task management
  if (/^(todo|task|todowrite|checklist|kanban)$/.test(n) ||
      /\b(todo|task)\b/.test(n))
    return { icon: CheckSquare, color: "text-teal-600 dark:text-teal-400" };

  // Agent / bot actions
  if (/^(agent|bot|mcp_|tool_)/.test(n))
    return { icon: Bot, color: "text-indigo-600 dark:text-indigo-400" };

  // Fallback
  return { icon: Wrench, color: "text-amber-600 dark:text-amber-400" };
}

// ── Event Card ────────────────────────────────────────────────────────────────

function ToolCallBlock({ call }: { call: ToolCallSummary }) {
  const [expanded, setExpanded] = useState(false);
  const { icon: Icon, color } = toolMeta(call.name);
  return (
    <div className="rounded border border-amber-200 bg-amber-50/50 dark:border-amber-500/20 dark:bg-amber-500/5">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
      >
        <Icon className={cn("h-3 w-3 shrink-0", color)} />
        <span className="font-mono font-medium text-amber-700 dark:text-amber-300">{call.name}</span>
        {expanded ? (
          <ChevronDown className="ml-auto h-3 w-3 text-stone-400" />
        ) : (
          <ChevronRight className="ml-auto h-3 w-3 text-stone-400" />
        )}
      </button>
      {expanded && (
        <div className="border-t border-amber-200/70 px-3 py-2 dark:border-amber-500/10">
          <pre className="overflow-x-auto whitespace-pre-wrap text-[11px] text-stone-600 dark:text-stone-400">
            {stripAnsi(JSON.stringify(call.args, null, 2))}
          </pre>
        </div>
      )}
    </div>
  );
}

function ToolResultBlock({ result }: { result: ToolResultSummary }) {
  const [expanded, setExpanded] = useState(false);
  const content = stripAnsi(result.diff ?? result.content);
  const preview = truncate(content.replace(/\n/g, " "), 80);
  const { icon: Icon, color } = toolMeta(result.toolName);

  return (
    <div className="rounded border border-stone-200 bg-stone-50/50 dark:border-stone-700 dark:bg-stone-800/30">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
      >
        <Icon className={cn("h-3 w-3 shrink-0", color)} />
        <span className="font-mono text-stone-600 dark:text-stone-300">{result.toolName}</span>
        {!expanded && <span className="ml-2 text-stone-400 dark:text-stone-500">{preview}</span>}
        {expanded ? (
          <ChevronDown className="ml-auto h-3 w-3 shrink-0 text-stone-400" />
        ) : (
          <ChevronRight className="ml-auto h-3 w-3 shrink-0 text-stone-400" />
        )}
      </button>
      {expanded && (
        <div className="border-t border-stone-200/70 px-3 py-2 dark:border-stone-700/50">
          {result.diff ? (
            <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-stone-600 dark:text-stone-400">
              {content}
            </pre>
          ) : (
            <p className="whitespace-pre-wrap text-[11px] text-stone-600 dark:text-stone-400">
              {content || "(empty)"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function EventCard({ event }: { event: ParsedEvent }) {
  const [expanded, setExpanded] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const isMessage = event.type === "message";
  const isUser = isMessage && event.role === "user";
  const isAssistant = isMessage && event.role === "assistant";
  const isToolResult = isMessage && event.role === "toolResult";
  const isModelChange = event.type === "model_change";
  const isThinkingChange = event.type === "thinking_level_change";
  const isSession = event.type === "session";

  // Skip pure session start/end events inline (tiny noise)
  if (isSession || isThinkingChange) {
    return (
      <div className="flex items-center gap-2 py-1 text-[11px] text-stone-400 dark:text-stone-500">
        <div className="h-px flex-1 bg-stone-200 dark:bg-stone-700/50" />
        {isSession ? (
          <span>session {event.type === "session" ? "started" : ""}</span>
        ) : (
          <span>
            thinking:{" "}
            {String((event.raw as Record<string, unknown>).thinkingLevel ?? "—")}
          </span>
        )}
        <div className="h-px flex-1 bg-stone-200 dark:bg-stone-700/50" />
      </div>
    );
  }

  if (isModelChange) {
    return (
      <div className="flex items-center gap-2 py-1.5 text-[11px]">
        <div className="h-px flex-1 bg-sky-200 dark:bg-sky-500/20" />
        <Cpu className="h-3 w-3 text-sky-500 dark:text-sky-400" />
        <span className="font-medium text-sky-600 dark:text-sky-400">
          {event.provider} / {event.modelId}
        </span>
        <div className="h-px flex-1 bg-sky-200 dark:bg-sky-500/20" />
      </div>
    );
  }

  // Tool result as standalone message
  if (isToolResult && event.toolResults) {
    return (
      <div className="flex gap-2.5">
        <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-stone-100 dark:bg-stone-700/60">
          <Database className="h-3 w-3 text-stone-500" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1 pt-0.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-stone-500 dark:text-stone-400">tool result</span>
            <span className="text-[11px] text-stone-400 dark:text-stone-500">{formatTs(event.timestamp)}</span>
          </div>
          <div className="flex flex-col gap-1">
            {event.toolResults.map((r, i) => (
              <ToolResultBlock key={i} result={r} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!isMessage) {
    // Unknown event type — show raw
    return (
      <div className="flex gap-2.5 py-1">
        <div className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center">
          <div className="h-1.5 w-1.5 rounded-full bg-stone-300 dark:bg-stone-600" />
        </div>
        <div className="min-w-0 flex-1">
          <button
            onClick={() => setShowRaw((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-stone-400 hover:text-stone-600 dark:hover:text-stone-300"
          >
            <span className="font-mono">{event.type}</span>
            <ChevronRight className={cn("h-3 w-3 transition-transform", showRaw && "rotate-90")} />
          </button>
          {showRaw && (
            <pre className="mt-1 overflow-x-auto rounded bg-stone-100 px-2 py-1 text-[11px] dark:bg-stone-800">
              {JSON.stringify(event.raw, null, 2)}
            </pre>
          )}
        </div>
      </div>
    );
  }

  const hasThinking = Boolean(event.thinking);
  const hasToolCalls = (event.toolCalls?.length ?? 0) > 0;
  const hasToolResults = (event.toolResults?.length ?? 0) > 0;
  const hasDetails = hasThinking || hasToolCalls || hasToolResults;

  return (
    <div
      className={cn(
        "flex gap-2.5 rounded-lg border-l-2 px-3 py-3 transition-colors",
        isUser && "border-l-stone-400 bg-stone-100/70 dark:border-l-stone-500 dark:bg-stone-800/40",
        isAssistant && "border-l-emerald-400 bg-white dark:border-l-emerald-500 dark:bg-stone-800/20",
        isToolResult && "border-l-amber-400 dark:border-l-amber-500",
        !isUser && !isAssistant && !isToolResult && "border-l-stone-200 dark:border-l-stone-700",
      )}
    >
      {/* Avatar */}
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full">
        {isUser ? (
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-stone-300 dark:bg-stone-600">
            <User className="h-3 w-3 text-stone-600 dark:text-stone-200" />
          </div>
        ) : (
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-500/20">
            <Bot className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        {/* Header */}
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-xs font-semibold text-stone-700 dark:text-stone-200">
            {isUser ? "user" : "assistant"}
          </span>
          {event.modelId && (
            <span className="text-[11px] text-stone-400 dark:text-stone-500">
              {event.provider ? `${event.provider}/${event.modelId}` : event.modelId}
            </span>
          )}
          {event.usage && (
            <span className="text-[11px] text-stone-400 dark:text-stone-500">
              {formatTokens(event.usage.total)} tokens
            </span>
          )}
          <span className="ml-auto text-[11px] text-stone-400 dark:text-stone-500">
            {formatTs(event.timestamp)}
          </span>
        </div>

        {/* Thinking (collapsible) */}
        {hasThinking && (
          <div className="mb-2 rounded border border-purple-200 bg-purple-50/50 dark:border-purple-500/20 dark:bg-purple-500/5">
            <button
              onClick={() => setExpanded((v) => !v)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px]"
            >
              <Brain className="h-3 w-3 shrink-0 text-purple-500" />
              <span className="text-purple-600 dark:text-purple-400">thinking</span>
              {!expanded && (
                <span className="ml-1 text-purple-400/70 dark:text-purple-500/70">
                  {truncate(stripAnsi(event.thinking ?? ""), 60)}
                </span>
              )}
              {expanded ? (
                <ChevronDown className="ml-auto h-3 w-3 text-purple-400" />
              ) : (
                <ChevronRight className="ml-auto h-3 w-3 text-purple-400" />
              )}
            </button>
            {expanded && (
              <div className="border-t border-purple-200/70 px-3 py-2 dark:border-purple-500/10">
                <p className="whitespace-pre-wrap text-xs italic text-purple-700 dark:text-purple-300">
                  {stripAnsi(event.thinking ?? "")}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Text content */}
        {event.textContent && (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-stone-700 dark:text-stone-200">
            {stripAnsi(event.textContent)}
          </p>
        )}

        {/* Tool calls */}
        {hasToolCalls && (
          <div className="mt-2 flex flex-col gap-1.5">
            {event.toolCalls!.map((call) => (
              <ToolCallBlock key={call.id} call={call} />
            ))}
          </div>
        )}

        {/* Tool results */}
        {hasToolResults && !isToolResult && (
          <div className="mt-2 flex flex-col gap-1.5">
            {event.toolResults!.map((result, i) => (
              <ToolResultBlock key={i} result={result} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Events Panel (virtualized) ────────────────────────────────────────────────

function EventsPanel({
  sessionId,
  onBack,
}: {
  sessionId: string;
  onBack: () => void;
}) {
  const [events, setEvents] = useState<ParsedEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageSize = 100;

  const fetchEvents = useCallback(
    async (p: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/sessions/history/events?id=${encodeURIComponent(sessionId)}&page=${p}&pageSize=${pageSize}`,
          { cache: "no-store" }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          total: number;
          page: number;
          hasMore: boolean;
          events: ParsedEvent[];
        };
        setEvents((prev) => (p === 0 ? data.events : [...prev, ...data.events]));
        setTotal(data.total);
        setHasMore(data.hasMore);
        setPage(p);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    },
    [sessionId]
  );

  useEffect(() => {
    setEvents([]);
    setPage(0);
    fetchEvents(0);
  }, [sessionId, fetchEvents]);

  const filtered = search
    ? events.filter((e) => {
        const hay = [e.textContent, e.thinking, ...(e.toolCalls ?? []).map((t) => t.name)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(search.toLowerCase());
      })
    : events;

  // Virtual list — estimate varies by event type
  const estimateSize = useCallback(
    (index: number) => {
      const e = filtered[index];
      if (!e) return 60;
      if (e.type === "model_change" || e.type === "thinking_level_change" || e.type === "session") return 28;
      if (e.role === "user") return 80;
      if (e.role === "assistant") {
        let h = 90;
        if (e.thinking) h += 36;
        if (e.toolCalls?.length) h += e.toolCalls.length * 36;
        return h;
      }
      return 60;
    },
    [filtered]
  );

  const virtualizer = useVirtualizer({
    count: filtered.length + (hasMore && !search ? 1 : 0),
    getScrollElement: () => scrollRef.current,
    estimateSize,
    overscan: 8,
  });

  const items = virtualizer.getVirtualItems();

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Sub-header */}
      <div className="sticky top-0 z-10 flex shrink-0 items-center gap-3 border-b border-stone-200 bg-stone-50 px-6 py-3 dark:border-stone-700/60 dark:bg-[#101214]">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-800 dark:hover:text-stone-200"
        >
          <ChevronLeft className="h-4 w-4" />
          Sessions
        </button>
        <span className="text-stone-300 dark:text-stone-600">/</span>
        <span className="font-mono text-xs text-stone-500">{sessionId.slice(0, 16)}…</span>
        <span className="text-[11px] text-stone-400">{total} events</span>
        <div className="ml-auto flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 dark:border-stone-700 dark:bg-stone-800/50">
          <Search className="h-3.5 w-3.5 text-stone-400" />
          <input
            type="text"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-40 bg-transparent text-xs text-stone-700 placeholder-stone-400 outline-none dark:text-stone-200"
          />
        </div>
      </div>

      {/* Virtualized events list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4">
        {loading && events.length === 0 && <LoadingState label="Loading session…" />}
        {error && <p className="text-sm text-red-500">{error}</p>}
        {!loading && !error && filtered.length === 0 && (
          <p className="text-sm text-stone-400">No events found.</p>
        )}

        {filtered.length > 0 && (
          <div
            style={{ height: virtualizer.getTotalSize(), position: "relative" }}
          >
            {items.map((vItem) => {
              // Load-more sentinel
              if (vItem.index >= filtered.length) {
                return (
                  <div
                    key="load-more"
                    data-index={vItem.index}
                    ref={virtualizer.measureElement}
                    style={{ position: "absolute", top: vItem.start, width: "100%" }}
                    className="pb-2"
                  >
                    <button
                      onClick={() => fetchEvents(page + 1)}
                      disabled={loading}
                      className="w-full rounded-lg border border-stone-200 py-2 text-sm text-stone-500 hover:bg-stone-50 dark:border-stone-700 dark:hover:bg-stone-800/40"
                    >
                      {loading ? "Loading…" : `Load more (${total - events.length} remaining)`}
                    </button>
                  </div>
                );
              }

              const event = filtered[vItem.index];
              return (
                <div
                  key={event.id}
                  data-index={vItem.index}
                  ref={virtualizer.measureElement}
                  style={{ position: "absolute", top: vItem.start, width: "100%" }}
                  className="pb-1.5"
                >
                  <EventCard event={event} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main View ─────────────────────────────────────────────────────────────────

export function TimelineView() {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [liveStatus, setLiveStatus] = useState<"connecting" | "live" | "disconnected">("connecting");
  const hasLoadedOnce = useRef(false);
  const refreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions/history", {
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { sessions: SessionMeta[] };
      setSessions(data.sessions ?? []);
      if (!hasLoadedOnce.current) {
        hasLoadedOnce.current = true;
        setLoading(false);
      }
    } catch (e) {
      if (!hasLoadedOnce.current) {
        setError(String(e));
        setLoading(false);
      }
    }
  }, []);

  const fetchActivity = useCallback(async () => {
    try {
      const res = await fetch("/api/activity", { cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (!res.ok) return;
      const data = await res.json();
      setActivityEvents(Array.isArray(data) ? data : []);
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    fetchActivity();
  }, [fetchSessions, fetchActivity]);

  // Live SSE subscription — refreshes session list when any .jsonl file changes
  useEffect(() => {
    const es = new EventSource("/api/events/stream");

    es.onopen = () => setLiveStatus("live");

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data as string) as { type?: string; path?: string };
        if (event.type === "connected") return;
        if (event.path && isSessionFileEvent(event.path)) {
          // Debounce: coalesce rapid writes into a single refresh
          if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
          refreshDebounceRef.current = setTimeout(() => { fetchSessions(); fetchActivity(); }, 500);
        }
      } catch {
        // ignore malformed SSE frames
      }
    };

    es.onerror = () => setLiveStatus("disconnected");

    return () => {
      es.close();
      if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
    };
  }, [fetchSessions, fetchActivity]);

  const agents = Array.from(new Set(sessions.map((s) => s.agent))).sort();

  const filtered = sessions.filter((s) => {
    if (agentFilter !== "all" && s.agent !== agentFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (
        !s.sessionId.toLowerCase().includes(q) &&
        !(s.model ?? "").toLowerCase().includes(q) &&
        !s.agent.toLowerCase().includes(q) &&
        !(s.summary ?? "").toLowerCase().includes(q)
      )
        return false;
    }
    const sessionTs = s.lastEventTs ?? (s.mtimeMs ? new Date(s.mtimeMs).toISOString() : null);
    if (dateFrom && sessionTs && new Date(sessionTs) < new Date(dateFrom)) return false;
    if (dateTo && sessionTs && new Date(sessionTs) > new Date(dateTo + "T23:59:59")) return false;
    return true;
  });

  const selectedSession = sessions.find((s) => s.id === selectedId);

  const merged: TimelineItem[] = useMemo(() => {
    const items: TimelineItem[] = [];
    for (const s of filtered) {
      const ts = s.lastEventTs ? new Date(s.lastEventTs).getTime() : s.mtimeMs;
      items.push({ kind: "session", data: s, sortTs: ts });
    }
    for (const a of activityEvents) {
      if (agentFilter !== "all" && a.source && !a.source.toLowerCase().includes(agentFilter)) continue;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!a.title.toLowerCase().includes(q) && !(a.detail ?? "").toLowerCase().includes(q)) continue;
      }
      items.push({ kind: "activity", data: a, sortTs: a.timestamp });
    }
    return items.sort((a, b) => b.sortTs - a.sortTs);
  }, [filtered, activityEvents, agentFilter, searchQuery]);

  return (
    <SectionLayout>
      <SectionHeader
        title="Activity Timeline"
        description="System of record — every agent action, traceable from trigger to outcome."
        actions={
          <div className="flex items-center gap-3">
            {/* Live status indicator */}
            <span
              className="flex items-center gap-1.5 text-xs text-stone-400 dark:text-stone-500"
              title={
                liveStatus === "live"
                  ? "Live — refreshes automatically when sessions change"
                  : liveStatus === "connecting"
                  ? "Connecting to live event stream…"
                  : "Disconnected from event stream — changes won't auto-refresh"
              }
              data-live-status={liveStatus}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  liveStatus === "live" && "bg-emerald-500",
                  liveStatus === "connecting" && "bg-amber-400",
                  liveStatus === "disconnected" && "bg-stone-400"
                )}
              />
              {liveStatus === "live" ? "Live" : liveStatus === "connecting" ? "Connecting…" : "Disconnected"}
            </span>
            <button
              onClick={() => { setLoading(true); fetchSessions(); fetchActivity(); }}
              className="flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 shadow-sm transition hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
          </div>
        }
      />

      <SectionBody>
        {selectedId && selectedSession ? (
          <EventsPanel
            sessionId={selectedId}
            onBack={() => setSelectedId(null)}
          />
        ) : (
          <div className="flex flex-1 flex-col gap-4 overflow-hidden">
            {/* Filters */}
            <div className="flex shrink-0 items-center gap-3">
              <div className="flex items-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-sm dark:border-stone-700 dark:bg-stone-800/50">
                <Search className="h-3.5 w-3.5 text-stone-400" />
                <input
                  type="text"
                  placeholder="Search sessions…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-44 bg-transparent text-xs text-stone-700 placeholder-stone-400 outline-none dark:text-stone-200"
                />
              </div>
              <div className="flex items-center gap-1">
                <Filter className="h-3.5 w-3.5 text-stone-400" />
                <select
                  value={agentFilter}
                  onChange={(e) => setAgentFilter(e.target.value)}
                  className="rounded border border-stone-200 bg-stone-50 px-2 py-1 text-xs text-stone-600 dark:border-stone-700 dark:bg-stone-800/50 dark:text-stone-300"
                >
                  <option value="all">All agents</option>
                  {agents.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>
              {/* Date range */}
              <div className="flex items-center gap-1.5">
                <CalendarRange className="h-3.5 w-3.5 text-stone-400" />
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  title="From date"
                  className="rounded border border-stone-200 bg-stone-50 px-2 py-1 text-xs text-stone-600 dark:border-stone-700 dark:bg-stone-800/50 dark:text-stone-300 dark:[color-scheme:dark]"
                />
                <span className="text-xs text-stone-400">–</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  title="To date"
                  className="rounded border border-stone-200 bg-stone-50 px-2 py-1 text-xs text-stone-600 dark:border-stone-700 dark:bg-stone-800/50 dark:text-stone-300 dark:[color-scheme:dark]"
                />
                {(dateFrom || dateTo) && (
                  <button
                    onClick={() => { setDateFrom(""); setDateTo(""); }}
                    className="text-[11px] text-stone-400 hover:text-stone-600 dark:hover:text-stone-300"
                    title="Clear date filter"
                  >
                    ✕
                  </button>
                )}
              </div>
              <span className="text-xs text-stone-400">
                {merged.length} events
              </span>
            </div>

            {/* Session list */}
            <div className="flex-1 overflow-y-auto">
              {loading && <LoadingState label="Scanning sessions…" />}
              {error && (
                <p className="text-sm text-red-500">{error}</p>
              )}
              {!loading && !error && merged.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-12 text-stone-400">
                  <FileText className="h-8 w-8 opacity-40" />
                  <p className="text-sm">
                    {searchQuery || agentFilter !== "all" || dateFrom || dateTo
                      ? "No matching sessions found."
                      : "No JSONL session files found in ~/.openclaw/agents/"}
                  </p>
                </div>
              )}
              {!loading && !error && merged.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {merged.map((item) =>
                    item.kind === "session" ? (
                      <SessionListItem
                        key={item.data.id}
                        session={item.data}
                        selected={selectedId === item.data.id}
                        onSelect={() => setSelectedId(item.data.id)}
                      />
                    ) : (
                      <ActivityCard key={item.data.id} event={item.data} />
                    )
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </SectionBody>
    </SectionLayout>
  );
}
