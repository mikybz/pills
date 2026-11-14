import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { subscribe } from "@/lib/live";

/** Comment line every 25 s so proxies and phones keep the connection open. */
const HEARTBEAT_MS = 25_000;

/**
 * Server-sent events: live changes for every person the user can access
 * (doses, medicines, person settings). The client refetches on each one; a
 * dose another user logged also shows the "Anna gave Rex …" overlay.
 */
export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      // Tell EventSource to wait 3 s before reconnecting after a drop.
      send("retry: 3000\n: connected\n\n");
      const unsubscribe = subscribe(user.id, (event) => send(`data: ${JSON.stringify(event)}\n\n`));
      const heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);
      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        cleanup = () => {};
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      req.signal.addEventListener("abort", () => cleanup());
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
