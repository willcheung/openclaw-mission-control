/**
 * GET    /api/env/:key  — reveal single env var value
 * PUT    /api/env/:key  — update env var { value, source? }
 * DELETE /api/env/:key  — delete env var from all source files
 */

import { NextRequest, NextResponse } from "next/server";
import { getEnvVar, setEnvVar, deleteEnvVar } from "@/lib/env-manager";
import type { EnvSource } from "@/lib/env-manager";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ key: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { key } = await params;
  try {
    const entry = await getEnvVar(key);
    if (!entry) {
      return NextResponse.json({ error: `Key not found: ${key}` }, { status: 404 });
    }
    // Value is intentionally included here — this is the "reveal" endpoint
    return NextResponse.json({
      key: entry.key,
      value: entry.value,
      source: entry.source,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { key } = await params;
  try {
    const body = (await request.json()) as {
      value?: string;
      source?: EnvSource;
    };
    const { value, source = "workspace" } = body;
    if (value === undefined || value === null) {
      return NextResponse.json({ error: "value is required" }, { status: 400 });
    }
    await setEnvVar(key, String(value), source);
    return NextResponse.json({ ok: true, key, source });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { key } = await params;
  try {
    const deleted = await deleteEnvVar(key);
    if (!deleted) {
      return NextResponse.json({ error: `Key not found: ${key}` }, { status: 404 });
    }
    return NextResponse.json({ ok: true, key });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
