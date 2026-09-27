import { NextResponse, type NextRequest } from "next/server";
import { ChangesetRequest, RequestError, saveChangeset } from "@/lib/changesets";
import { apiContext } from "@/lib/context";
import { crossSite } from "@/lib/same-origin";

/** Saves an edit, a new note, a move, a verification, a deprecation, or a deletion. */
export async function POST(req: NextRequest) {
  const ctx = await apiContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const refused = crossSite(req);
  if (refused) return refused;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "The request is not JSON" }, { status: 400 });
  }
  const parsed = ChangesetRequest.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: `${first?.path.join(".") || "request"}: ${first?.message ?? "invalid"}` },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(await saveChangeset(ctx, parsed.data), { status: 202 });
  } catch (err) {
    if (err instanceof RequestError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
