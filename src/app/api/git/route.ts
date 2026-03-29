/**
 * GET  /api/git        — git status + recent log
 * POST /api/git/commit — manual commit { message? }
 */

import { NextRequest, NextResponse } from "next/server";
import { getGitStatus, getGitLog, commitWorkspace } from "@/lib/git-manager";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [status, log] = await Promise.all([
      getGitStatus(),
      getGitLog(10),
    ]);
    return NextResponse.json({ status, log });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
