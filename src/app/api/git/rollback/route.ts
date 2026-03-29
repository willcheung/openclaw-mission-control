import { NextRequest, NextResponse } from "next/server";
import { rollbackToCommit } from "@/lib/git-manager";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { ref?: string };
    if (!body.ref) {
      return NextResponse.json({ error: "ref is required" }, { status: 400 });
    }
    await rollbackToCommit(body.ref);
    return NextResponse.json({ ok: true, ref: body.ref });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
