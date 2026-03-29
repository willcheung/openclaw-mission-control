/**
 * GET /api/events?limit=100
 *
 * Returns recent audit events from memory/audit.jsonl (newest-first).
 */

import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";
import { getOpenClawHome } from "@/lib/paths";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(500, Math.max(1, parseInt(searchParams.get("limit") ?? "100", 10)));

  const logPath = join(getOpenClawHome(), "workspace", "memory", "audit.jsonl");

  try {
    const content = await readFile(logPath, "utf-8");
    const lines = content
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const events = lines
      .slice(-limit)
      .reverse()
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    return NextResponse.json({ events });
  } catch {
    // File doesn't exist yet — return empty
    return NextResponse.json({ events: [] });
  }
}
