import { NextRequest, NextResponse } from "next/server";
import { commitWorkspace } from "@/lib/git-manager";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { message?: string };
    const result = await commitWorkspace(body.message);
    if (!result) {
      return NextResponse.json({ ok: true, committed: false, message: "Nothing to commit" });
    }
    return NextResponse.json({ ok: true, committed: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
