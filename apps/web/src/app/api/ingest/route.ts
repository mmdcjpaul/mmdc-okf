import { NextResponse, type NextRequest } from "next/server";
import { getFeatures } from "@lore/db";
import { LIMITS } from "@lore/ingest";
import { RequestError } from "@/lib/changesets";
import { apiContext } from "@/lib/context";
import { db } from "@/lib/db";
import { saveCapture, saveUpload, type Hints } from "@/lib/ingest";
import { crossSite } from "@/lib/same-origin";

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

function hintsOf(form: FormData): Hints {
  const theme = String(form.get("theme") ?? "").trim();
  const tags = form
    .getAll("tags")
    .map((t) => String(t).trim())
    .filter(Boolean);
  const target = String(form.get("target") ?? "").trim();
  for (const slug of [theme, ...tags])
    if (slug && !SLUG.test(slug)) throw new RequestError(400, `"${slug}" is not a valid term`);
  return {
    ...(theme ? { theme } : {}),
    ...(tags.length ? { tags } : {}),
    ...(target ? { target } : {}),
  };
}

/**
 * Upload a file, or capture rough text and screenshots (AU-4, AU-5). There is no prompt box
 * on purpose: this is document processing with a fixed pipeline, not a chat.
 */
export async function POST(req: NextRequest) {
  const ctx = await apiContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const refused = crossSite(req);
  if (refused) return refused;

  // Refuse what is obviously too large before reading it.
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > LIMITS.maxBytes + 60 * 1024 * 1024)
    return NextResponse.json({ error: "The request is too large" }, { status: 413 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "The request is not a form" }, { status: 400 });
  }
  const namespace = String(form.get("namespace") ?? "");
  if (!SLUG.test(namespace))
    return NextResponse.json({ error: "Choose a namespace" }, { status: 400 });
  const processNow = form.get("process") === "now";

  try {
    const hints = hintsOf(form);
    if (form.get("kind") === "capture") {
      if (!(await getFeatures(db())).capture)
        return NextResponse.json({ error: "Capture is switched off" }, { status: 403 });
      const images = form
        .getAll("images")
        .filter((f): f is File => f instanceof File && f.size > 0);
      const saved = await saveCapture(ctx, {
        text: String(form.get("text") ?? ""),
        images: await Promise.all(
          images.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })),
        ),
        namespace,
        hints,
        processNow,
      });
      return NextResponse.json(saved, { status: 202 });
    }
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0)
      return NextResponse.json({ error: "Choose a file" }, { status: 400 });
    if (file.size > LIMITS.maxBytes)
      return NextResponse.json(
        { error: `The file is larger than ${LIMITS.maxBytes / 1024 / 1024} MB` },
        { status: 413 },
      );
    const saved = await saveUpload(ctx, {
      name: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
      namespace,
      hints,
      processNow,
    });
    return NextResponse.json(saved, { status: 202 });
  } catch (err) {
    if (err instanceof RequestError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
