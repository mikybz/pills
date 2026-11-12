import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { pushConfigured, sendToUser } from "@/lib/push";
import { testPayload } from "@/lib/reminder-text";

/** "Send test notification": to all of the user's devices. */
export async function POST() {
  return withUser(async (user) => {
    if (!pushConfigured()) {
      return NextResponse.json({ error: "push_not_configured" }, { status: 503 });
    }
    const result = await sendToUser(user.id, testPayload(user.locale), 300);
    return NextResponse.json(result);
  });
}
