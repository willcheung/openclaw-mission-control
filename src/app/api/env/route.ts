/**
 * GET  /api/env        — list all env vars (values masked)
 * POST /api/env        — create new env var { key, value, source? }
 */

import { NextRequest, NextResponse } from "next/server";
import { listEnvVars, setEnvVar } from "@/lib/env-manager";
import type { EnvSource } from "@/lib/env-manager";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const vars = await listEnvVars();
    return NextResponse.json({ vars });
  } catch (err) {
    console.error("GET /api/env error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      key?: string;
      value?: string;
      source?: EnvSource;
    };

    const { key, value, source = "workspace" } = body;
    if (!key || typeof key !== "string") {
      return NextResponse.json({ error: "key is required" }, { status: 400 });
    }
    if (value === undefined || value === null) {
      return NextResponse.json({ error: "value is required" }, { status: 400 });
    }

    await setEnvVar(key, String(value), source);
    return NextResponse.json({ ok: true, key, source });
  } catch (err) {
    console.error("POST /api/env error:", err);
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}
