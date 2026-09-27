import { NextResponse } from "next/server";

/** Liveness for the container health check and the uptime monitor. Reads nothing. */
export function GET() {
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
