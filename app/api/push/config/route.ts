import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { pushConfigured, vapidPublicKey } from "@/lib/push";

// The VAPID public key at runtime (not inlined at build), so the image does not
// need to be rebuilt when keys are added or rotated.
export async function GET() {
  return withUser(async () =>
    NextResponse.json({ configured: pushConfigured(), publicKey: vapidPublicKey() }),
  );
}
