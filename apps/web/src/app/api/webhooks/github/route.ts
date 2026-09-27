import { NextResponse, type NextRequest } from "next/server";
import { forwardWebhook } from "@/lib/worker";

/**
 * GitHub's push webhook. Open to the internet, as it has to be: the delivery is checked by
 * its signature, which the worker does, because the worker holds the secret. Nothing is read
 * from the vault here and nothing about it is answered.
 */
export async function POST(req: NextRequest) {
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > 26 * 1024 * 1024) return NextResponse.json({ error: "Too large" }, { status: 413 });
  const signature = req.headers.get("x-hub-signature-256") ?? "";
  const event = req.headers.get("x-github-event") ?? "";
  if (!signature || !event) return NextResponse.json({ error: "Not a delivery" }, { status: 400 });
  const ok = await forwardWebhook(await req.arrayBuffer(), { event, signature });
  // 503 makes GitHub show the delivery as failed, so it can be sent again.
  return ok
    ? NextResponse.json({ received: true }, { status: 202 })
    : NextResponse.json({ error: "Try again later" }, { status: 503 });
}
