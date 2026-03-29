import { NextRequest, NextResponse } from "next/server";
import { getFileDiff } from "@/lib/git-manager";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const file = searchParams.get("file") ?? undefined;
  const ref = searchParams.get("ref") ?? undefined;
  try {
    const diffs = await getFileDiff(file, ref);
    return NextResponse.json({ diffs });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
