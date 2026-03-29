import { NextRequest, NextResponse } from "next/server";
import { getGitLog } from "@/lib/git-manager";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));
  try {
    const log = await getGitLog(limit);
    return NextResponse.json({ log });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
