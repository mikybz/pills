import { NextResponse } from "next/server";
import { APP_VERSION } from "@/lib/version";

// Never cached: open pages compare this with the version they were built with.
export const dynamic = "force-dynamic";

/** GET /api/version → { version }. No login: nothing secret, and the update check needs it. */
export function GET() {
  return NextResponse.json({ version: APP_VERSION }, { headers: { "Cache-Control": "no-store" } });
}
