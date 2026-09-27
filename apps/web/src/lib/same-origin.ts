import { NextResponse, type NextRequest } from "next/server";

/**
 * Refuses a write that comes from another site. Browsers send `Origin` on every cross-site
 * request that can carry the session cookie, so a page elsewhere cannot act as the person.
 */
export function crossSite(req: NextRequest): NextResponse | null {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 });
  }
  return host === req.headers.get("host")
    ? null
    : NextResponse.json({ error: "Cross-site request refused" }, { status: 403 });
}
