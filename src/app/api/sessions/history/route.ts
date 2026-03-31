/**
 * GET /api/sessions/history
 *
 * Lists all JSONL session files across all agents in ~/.openclaw/agents/
 * Returns metadata: agent, session ID, file path (base64), size, mtime,
 * first/last event timestamps, approximate event count, summary, toolNames.
 */

import { NextResponse } from "next/server";
import { readdir, stat, open, readFile } from "fs/promises";
import { join, basename } from "path";
import { getOpenClawHome } from "@/lib/paths";

export const dynamic = "force-dynamic";

type SessionFileMeta = {
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
  toolNames: string[];
};

async function readHead(path: string, maxBytes = 4096): Promise<string> {
  const fh = await open(path, "r");
  try {
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
    return buf.slice(0, bytesRead).toString("utf-8");
  } finally {
    await fh.close();
  }
}

async function readTail(path: string, maxBytes = 4096): Promise<string> {
  const s = await stat(path);
  if (s.size <= maxBytes) return readFile(path, "utf-8");
  const fh = await open(path, "r");
  try {
    const offset = s.size - maxBytes;
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await fh.read(buf, 0, maxBytes, offset);
    return buf.slice(0, bytesRead).toString("utf-8");
  } finally {
    await fh.close();
  }
}

function firstJsonlTs(text: string): string | null {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      if (typeof obj.timestamp === "string") return obj.timestamp;
    } catch { /* skip */ }
  }
  return null;
}

function lastJsonlTs(text: string): string | null {
  const lines = text.split("\n").reverse();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      if (typeof obj.timestamp === "string") return obj.timestamp;
    } catch { /* skip */ }
  }
  return null;
}

function firstJsonlModel(text: string): string | null {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      if (obj.type === "model_change" && typeof obj.modelId === "string") {
        return obj.modelId as string;
      }
    } catch { /* skip */ }
  }
  return null;
}

function approximateLineCount(text: string): number {
  let count = 0;
  for (const ch of text) if (ch === "\n") count++;
  return count;
}

function encodeId(path: string): string {
  return Buffer.from(path).toString("base64url");
}

/**
 * Extract the first user message text from JSONL head as a session summary.
 * Returns null if no user message found. Truncated to 120 chars.
 */
function extractSummary(text: string): string | null {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      if (obj.type !== "message") continue;
      const msg = obj.message as Record<string, unknown> | undefined;
      if (!msg || msg.role !== "user") continue;
      const content = msg.content;
      if (typeof content === "string") {
        return content.length > 120 ? content.slice(0, 120) + "…" : content;
      }
      if (Array.isArray(content)) {
        const textParts = (content as Record<string, unknown>[])
          .filter((c) => c.type === "text" && typeof c.text === "string")
          .map((c) => String(c.text));
        const joined = textParts.join(" ");
        if (joined) return joined.length > 120 ? joined.slice(0, 120) + "…" : joined;
      }
    } catch { /* skip */ }
  }
  return null;
}

/**
 * Extract unique tool names from the JSONL text (up to 5).
 */
function extractToolNames(text: string): string[] {
  const names = new Set<string>();
  for (const line of text.split("\n")) {
    if (names.size >= 5) break;
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      if (obj.type === "tool_call" && typeof obj.name === "string") {
        names.add(obj.name);
        continue;
      }
      if (obj.type === "message") {
        const msg = obj.message as Record<string, unknown> | undefined;
        if (!msg) continue;
        const content = msg.content;
        if (Array.isArray(content)) {
          for (const part of content as Record<string, unknown>[]) {
            if (part.type === "toolCall" && typeof part.name === "string") {
              names.add(part.name);
            }
            if (part.type === "tool_use" && typeof part.name === "string") {
              names.add(part.name);
            }
          }
        }
      }
    } catch { /* skip */ }
  }
  return Array.from(names).slice(0, 5);
}

function lastTailTs(tail: string, head: string): string | null {
  return lastJsonlTs(tail) ?? lastJsonlTs(head);
}

export async function GET() {
  try {
    const home = getOpenClawHome();
    const agentsDir = join(home, "agents");

    let agents: string[];
    try {
      agents = await readdir(agentsDir);
    } catch {
      return NextResponse.json({ sessions: [] });
    }

    const sessionMetas: SessionFileMeta[] = [];

    await Promise.all(
      agents.map(async (agent) => {
        const sessionsDir = join(agentsDir, agent, "sessions");
        let files: string[];
        try {
          files = await readdir(sessionsDir);
        } catch {
          return;
        }

        const jsonlFiles = files.filter(
          (f) => f.endsWith(".jsonl") && !f.includes(".deleted.")
        );

        await Promise.all(
          jsonlFiles.map(async (filename) => {
            const filePath = join(sessionsDir, filename);
            try {
              const s = await stat(filePath);
              if (s.size === 0) return;

              const [headText, tailText] = await Promise.all([
                readHead(filePath, 16384),
                s.size > 16384 ? readTail(filePath, 4096) : Promise.resolve(""),
              ]);

              const tailForTs = tailText || headText;
              const firstTs = firstJsonlTs(headText);
              const lastTs = lastTailTs(tailForTs, headText);
              const model = firstJsonlModel(headText);
              const summary = extractSummary(headText);
              const toolNames = extractToolNames(headText + tailText);

              const sessionId = basename(filename, ".jsonl").split("-topic-")[0];

              sessionMetas.push({
                id: encodeId(filePath),
                agent,
                sessionId,
                filename,
                sizeBytes: s.size,
                mtimeMs: s.mtimeMs,
                firstEventTs: firstTs,
                lastEventTs: lastTs,
                model,
                eventCount: approximateLineCount(headText + tailText),
                summary,
                toolNames,
              });
            } catch { /* skip unreadable files */ }
          })
        );
      })
    );

    sessionMetas.sort((a, b) => b.mtimeMs - a.mtimeMs);

    return NextResponse.json({ sessions: sessionMetas });
  } catch (err) {
    console.error("sessions/history GET error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
