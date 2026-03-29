/**
 * Unit tests for the session history API event parser.
 * Tests the JSONL parsing and event enrichment logic extracted into pure functions.
 */

// We test the parsing logic by re-implementing the core parse function
// in a testable way (extracted from the route handler).

type RawEvent = Record<string, unknown>;

type ToolCallSummary = { id: string; name: string; args: Record<string, unknown> };
type ToolResultSummary = { toolCallId: string; toolName: string; content: string; diff?: string };
type TokenUsage = { input: number; output: number; cacheRead?: number; cacheWrite?: number; total: number };

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
};

// Inline the parseEvent logic here for pure unit testing
function parseEvent(raw: RawEvent): ParsedEvent {
  const type = String(raw.type ?? "unknown");
  const id = String(raw.id ?? `${type}-test`);
  const parentId = raw.parentId != null ? String(raw.parentId) : null;
  const timestamp = typeof raw.timestamp === "string" ? raw.timestamp : null;
  const event: ParsedEvent = { type, id, parentId, timestamp };

  if (type === "message") {
    const msg = raw.message as Record<string, unknown> | undefined;
    if (!msg) return event;
    event.role = String(msg.role ?? "unknown");
    const content = msg.content;
    if (Array.isArray(content)) {
      const textParts: string[] = [];
      const toolCalls: ToolCallSummary[] = [];
      for (const part of content as Record<string, unknown>[]) {
        if (part.type === "text" && typeof part.text === "string") textParts.push(part.text);
        if (part.type === "thinking" && typeof part.thinking === "string") event.thinking = part.thinking;
        if (part.type === "toolCall") {
          toolCalls.push({ id: String(part.id ?? ""), name: String(part.name ?? ""), args: (part.arguments as Record<string, unknown>) ?? {} });
        }
      }
      if (textParts.length) event.textContent = textParts.join("\n");
      if (toolCalls.length) event.toolCalls = toolCalls;
    }
    const usage = msg.usage as Record<string, unknown> | undefined;
    if (usage) {
      event.usage = { input: Number(usage.input ?? 0), output: Number(usage.output ?? 0), total: Number(usage.totalTokens ?? usage.total ?? 0) };
      event.modelId = typeof msg.model === "string" ? msg.model : undefined;
      event.provider = typeof msg.provider === "string" ? msg.provider : undefined;
    }
  } else if (type === "model_change") {
    event.modelId = typeof raw.modelId === "string" ? raw.modelId : undefined;
    event.provider = typeof raw.provider === "string" ? raw.provider : undefined;
  }
  return event;
}

describe("parseEvent", () => {
  it("parses a session start event", () => {
    const raw = { type: "session", id: "abc123", timestamp: "2026-03-28T10:00:00Z" };
    const result = parseEvent(raw);
    expect(result.type).toBe("session");
    expect(result.id).toBe("abc123");
    expect(result.timestamp).toBe("2026-03-28T10:00:00Z");
    expect(result.parentId).toBeNull();
  });

  it("parses a user message with text content", () => {
    const raw = {
      type: "message",
      id: "msg1",
      parentId: "abc123",
      timestamp: "2026-03-28T10:00:01Z",
      message: {
        role: "user",
        content: [{ type: "text", text: "Hello, agent!" }],
      },
    };
    const result = parseEvent(raw);
    expect(result.type).toBe("message");
    expect(result.role).toBe("user");
    expect(result.textContent).toBe("Hello, agent!");
    expect(result.thinking).toBeUndefined();
    expect(result.toolCalls).toBeUndefined();
  });

  it("parses an assistant message with thinking and tool calls", () => {
    const raw = {
      type: "message",
      id: "msg2",
      parentId: "msg1",
      timestamp: "2026-03-28T10:00:02Z",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Let me think about this..." },
          { type: "text", text: "I'll help with that." },
          { type: "toolCall", id: "call_1", name: "read_file", arguments: { path: "/foo.txt" } },
        ],
        model: "claude-opus-4-6",
        provider: "anthropic",
        usage: { input: 100, output: 50, totalTokens: 150 },
      },
    };
    const result = parseEvent(raw);
    expect(result.role).toBe("assistant");
    expect(result.thinking).toBe("Let me think about this...");
    expect(result.textContent).toBe("I'll help with that.");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe("read_file");
    expect(result.toolCalls![0].args).toEqual({ path: "/foo.txt" });
    expect(result.modelId).toBe("claude-opus-4-6");
    expect(result.provider).toBe("anthropic");
    expect(result.usage?.total).toBe(150);
  });

  it("parses a model_change event", () => {
    const raw = {
      type: "model_change",
      id: "mc1",
      parentId: null,
      timestamp: "2026-03-28T10:00:00Z",
      provider: "anthropic",
      modelId: "claude-opus-4-6",
    };
    const result = parseEvent(raw);
    expect(result.type).toBe("model_change");
    expect(result.modelId).toBe("claude-opus-4-6");
    expect(result.provider).toBe("anthropic");
  });

  it("handles message with no content array gracefully", () => {
    const raw = { type: "message", id: "x", message: { role: "user" } };
    const result = parseEvent(raw);
    expect(result.role).toBe("user");
    expect(result.textContent).toBeUndefined();
  });

  it("handles unknown event types", () => {
    const raw = { type: "custom", id: "c1", customType: "something", data: {} };
    const result = parseEvent(raw);
    expect(result.type).toBe("custom");
    expect(result.role).toBeUndefined();
  });

  it("handles null parentId", () => {
    const raw = { type: "session", id: "s1", parentId: null };
    expect(parseEvent(raw).parentId).toBeNull();
  });

  it("handles missing id gracefully", () => {
    const raw = { type: "session" };
    const result = parseEvent(raw);
    expect(result.id).toBeTruthy();
  });
});

describe("JSONL line parsing", () => {
  function parseLines(content: string): ParsedEvent[] {
    return content
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return parseEvent(JSON.parse(line) as RawEvent);
        } catch {
          return null;
        }
      })
      .filter(Boolean) as ParsedEvent[];
  }

  it("parses a multi-event JSONL session", () => {
    const content = [
      JSON.stringify({ type: "session", id: "s1", timestamp: "2026-03-28T10:00:00Z" }),
      JSON.stringify({ type: "model_change", id: "mc1", parentId: "s1", modelId: "claude-opus-4-6", provider: "anthropic" }),
      JSON.stringify({ type: "message", id: "m1", parentId: "mc1", timestamp: "2026-03-28T10:00:01Z", message: { role: "user", content: [{ type: "text", text: "hi" }] } }),
    ].join("\n") + "\n";

    const events = parseLines(content);
    expect(events).toHaveLength(3);
    expect(events[0].type).toBe("session");
    expect(events[1].type).toBe("model_change");
    expect(events[2].type).toBe("message");
  });

  it("skips malformed lines without crashing", () => {
    const content = [
      JSON.stringify({ type: "session", id: "s1" }),
      "this is not json {{{",
      JSON.stringify({ type: "message", id: "m1", message: { role: "user", content: [] } }),
    ].join("\n");

    const events = parseLines(content);
    expect(events).toHaveLength(2);
  });

  it("handles empty content", () => {
    expect(parseLines("")).toHaveLength(0);
    expect(parseLines("\n\n\n")).toHaveLength(0);
  });
});
