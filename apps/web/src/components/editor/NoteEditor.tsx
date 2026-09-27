"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, ImagePlus, Loader2 } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Banner, cn } from "@lore/ui";
import { CodeEditor } from "./CodeEditor";
import {
  changedFields,
  conflictMarkers,
  pastedImageName,
  suggestChangeClass,
  type ChangeClass,
} from "./links";
import { submitChangeset, watchChangeset, type Outcome } from "./submit";
import { TermPicker, type Term } from "./TermPicker";

export interface EditorVocabulary {
  themes: Term[];
  systems: Term[];
  tags: Term[];
  types: string[];
  teams: string[];
  customFields: { name: string; type: string; values?: string[]; required?: boolean }[];
  linkStyle: "absolute" | "relative";
}

export interface EditorNote {
  /** Null for a note that does not exist yet. */
  id: string | null;
  slug: string;
  namespace: string | null;
  /** Repository path; for a new note, a placeholder inside the chosen namespace. */
  path: string;
  blobSha: string | null;
  /** Frontmatter as loaded. Only keys that change are sent back. */
  data: Record<string, unknown>;
  body: string;
  isHub: boolean;
}

export interface NoteEditorProps {
  mode: "edit" | "create";
  note: EditorNote;
  vocabulary: EditorVocabulary;
  bundleRoot: string;
  /** True when the person publishes here; false when their change is a suggestion. */
  writes: boolean;
  /** Namespaces a new note can go in, with whether the person writes there. */
  namespaces?: { slug: string; title: string; writes: boolean }[];
  /** Set when continuing an earlier changeset: what to start from instead of the note as indexed. */
  merge?: {
    changesetId: string;
    /** `own`: the writer continues their changeset. `review`: a reviewer edits a suggestion. */
    mode: "own" | "review";
    /** True when the note changed in the vault after the changeset was made. */
    moved: boolean;
    body: string;
    set: Record<string, unknown>;
    conflicts: number;
    changeClass: ChangeClass;
    reason: string | null;
    summary: string | null;
  };
  /** A changeset this new note replaces: the draft it was started from. */
  replaces?: string;
  /** Feedback reports this edit resolves. */
  resolves?: string[];
  cancelHref: string;
  limits: { imageMaxMb: number; wordsWarn: number; wordsError: number };
}

interface PendingImage {
  name: string;
  data: string;
  url: string;
  size: number;
}

type Phase =
  | { kind: "editing" }
  | { kind: "saving"; message: string }
  | Exclude<Outcome, { kind: "published" }>;

const CLASSES: { value: ChangeClass; label: string; help: string }[] = [
  {
    value: "fix",
    label: "Fix",
    help: "A typo, a broken link, or a clarification. The meaning is unchanged.",
  },
  {
    value: "addition",
    label: "Addition",
    help: "A new section, more context, or an optional step.",
  },
  {
    value: "process",
    label: "Process change",
    help: "The steps, owners, or rules changed, and the old instructions are now wrong. Owners and followers are told.",
  },
];

const str = (v: unknown) => (typeof v === "string" ? v : "");
const list = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const inputClass =
  "h-9 w-full rounded-md border border-line bg-paper px-2.5 text-[14px] text-ink placeholder:text-faint";

async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function NoteEditor(props: NoteEditorProps) {
  const { mode, note, vocabulary, bundleRoot, merge, limits } = props;
  const router = useRouter();
  const ids = useId();
  const loaded = useMemo(
    () => ({
      title: str(note.data.title),
      description: str(note.data.description),
      type: str(note.data.type),
      themes: list(note.data.themes),
      systems: list(note.data.systems),
      tags: list(note.data.tags),
      owner: str(note.data.owner),
      aliases: list(note.data.aliases),
      status: str(note.data.status) || "stable",
      ...Object.fromEntries(vocabulary.customFields.map((f) => [f.name, note.data[f.name] ?? ""])),
    }),
    [note.data, vocabulary.customFields],
  );
  const [fields, setFields] = useState<Record<string, unknown>>(() => ({
    ...loaded,
    ...(merge?.set ?? {}),
  }));
  const [body, setBody] = useState(merge?.body ?? note.body);
  const [namespace, setNamespace] = useState(note.namespace ?? props.namespaces?.[0]?.slug ?? "");
  const [chosenClass, setChosenClass] = useState<ChangeClass | null>(merge?.changeClass ?? null);
  const [verify, setVerify] = useState(false);
  const [reason, setReason] = useState(merge?.mode === "own" ? (merge.reason ?? "") : "");
  const [summary, setSummary] = useState(merge?.summary ?? "");
  const reviewing = merge?.mode === "review";
  const [images, setImages] = useState<PendingImage[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: "editing" });
  const [preview, setPreview] = useState<string | null>(null);
  const [similar, setSimilar] = useState<
    { id: string; title: string; description: string; href: string; namespace: string | null }[]
  >([]);
  const [tab, setTab] = useState<"preview" | "similar">("preview");
  const imagesRef = useRef(images);
  imagesRef.current = images;

  const writes =
    mode === "create"
      ? (props.namespaces?.find((n) => n.slug === namespace)?.writes ?? false)
      : props.writes;
  const set = (key: string, value: unknown) => setFields((f) => ({ ...f, [key]: value }));
  const suggested = useMemo(() => suggestChangeClass(note.body, body), [note.body, body]);
  const changeClass: ChangeClass = mode === "create" ? "addition" : (chosenClass ?? suggested);
  const markers = useMemo(() => conflictMarkers(body), [body]);
  const count = useMemo(() => words(body), [body]);
  const title = str(fields.title);
  const path =
    mode === "create" ? `${bundleRoot}/${namespace || "namespace"}/new-note.md` : note.path;

  const problems: string[] = [];
  if (!title.trim()) problems.push("Give the note a title.");
  if (!str(fields.description).trim()) problems.push("Describe the note in one sentence.");
  if (!note.isHub && list(fields.themes).length === 0) problems.push("Choose at least one theme.");
  if (mode === "create" && !str(fields.type)) problems.push("Choose a type.");
  if (mode === "create" && !namespace) problems.push("Choose a namespace.");
  if (markers.length)
    problems.push(
      `Resolve the merge ${markers.length === 3 ? "conflict" : "conflicts"} marked in the text (line ${markers[0]}).`,
    );
  if (count > limits.wordsError)
    problems.push(`The note has ${count} words. Split it: the limit is ${limits.wordsError}.`);
  if (!writes && !reviewing && !reason.trim())
    problems.push("Say in a sentence why you suggest this change.");
  if (changeClass === "process" && mode === "edit" && !summary.trim())
    problems.push("Summarise what changed in the process, for the log.");

  // Preview, rendered by the server with the same renderer as the note page.
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            body,
            ...(note.id ? { noteId: note.id } : { namespace }),
            pendingAssets: imagesRef.current.map((i) => i.name),
          }),
        });
        if (!res.ok) return;
        let html = ((await res.json()) as { html: string }).html;
        // Images pasted in this session are not in the vault yet; show them from memory.
        for (const img of imagesRef.current)
          html = html.replaceAll(
            new RegExp(`src="/assets/[^"]*/_assets/${img.name}"`, "g"),
            `src="${img.url}"`,
          );
        setPreview(html);
      } catch {
        // Keep the last preview; the next keystroke tries again.
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [body, note.id, namespace, images]);

  // Similar notes, from search only (PRD 7.4), so writers update instead of duplicating.
  useEffect(() => {
    const q = title.trim();
    if (q.length < 4) {
      setSimilar([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=6`);
        if (!res.ok) return;
        const hits = ((await res.json()) as { hits: (typeof similar)[number][] }).hits;
        setSimilar(hits.filter((h) => h.id !== note.id));
      } catch {
        setSimilar([]);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [title, note.id]);

  useEffect(
    () => () => {
      for (const i of imagesRef.current) URL.revokeObjectURL(i.url);
    },
    [],
  );

  const [imageError, setImageError] = useState<string | null>(null);
  const addImages = useCallback(
    async (files: File[]): Promise<string[]> => {
      setImageError(null);
      const out: string[] = [];
      const added: PendingImage[] = [];
      const ns = mode === "create" ? namespace : note.namespace;
      if (!ns) {
        setImageError("Choose a namespace before adding images.");
        return [];
      }
      for (const file of files) {
        if (imagesRef.current.length + added.length >= 10) {
          setImageError("A note can take up to 10 new images at a time.");
          break;
        }
        if (file.size > limits.imageMaxMb * 1024 * 1024) {
          setImageError(`${file.name || "The image"} is larger than ${limits.imageMaxMb} MB.`);
          continue;
        }
        const taken = new Set([...imagesRef.current, ...added].map((i) => i.name));
        let name: string | null = null;
        for (let n = 0; n < 20 && (!name || taken.has(name)); n++)
          name = pastedImageName(note.slug || "note", file.type, new Date(), n);
        if (!name) {
          setImageError("Only PNG, JPEG, GIF, and WebP images can be added.");
          continue;
        }
        added.push({
          name,
          data: await toBase64(file),
          url: URL.createObjectURL(file),
          size: file.size,
        });
        const href =
          vocabulary.linkStyle === "absolute"
            ? `/${ns}/_assets/${name}`
            : `${path.split("/").length > 3 ? "../".repeat(path.split("/").length - 3) : "./"}_assets/${name}`;
        out.push(`![${file.name.replace(/\.[^.]+$/, "") || "image"}](${href})`);
      }
      if (added.length) setImages((cur) => [...cur, ...added]);
      return out;
    },
    [limits.imageMaxMb, mode, namespace, note.namespace, note.slug, path, vocabulary.linkStyle],
  );

  async function save() {
    if (problems.length) return;
    setPhase({ kind: "saving", message: writes ? "Saving…" : "Sending your suggestion…" });
    const { set: changed, unset } = changedFields(loaded, fields);
    const used = images.filter((i) => body.includes(`_assets/${i.name}`));
    const common = {
      ...(reason.trim() ? { reason: reason.trim() } : {}),
      ...(summary.trim() ? { summary: summary.trim() } : {}),
      images: used.map((i) => ({ name: i.name, data: i.data })),
      resolves: props.resolves ?? [],
      verify: verify && writes,
    };
    const request =
      mode === "create"
        ? {
            kind: "create",
            namespace,
            // A new note has nothing to compare with: every field that has a value is sent.
            data: Object.fromEntries(
              Object.entries(fields).filter(
                ([k, v]) =>
                  v !== "" &&
                  v !== null &&
                  v !== undefined &&
                  !(Array.isArray(v) && v.length === 0) &&
                  !(k === "status" && v === "stable"),
              ),
            ),
            body,
            ...common,
          }
        : {
            kind: "edit",
            noteId: note.id,
            baseSha: note.blobSha,
            body,
            set: changed,
            unset,
            changeClass,
            ...common,
          };
    if (mode === "create" && props.replaces) {
      // Finishing a note that came back: the changeset keeps what else it carries, such as
      // the Source Document and the images of the upload it came from.
      try {
        const { title: _t, ...rest } = note.data;
        const res = await fetch(`/api/changesets/${props.replaces}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "create",
            data: { ...rest, ...(request as { data: Record<string, unknown> }).data },
            body,
          }),
        });
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          return setPhase({
            kind: "failed",
            message: json.error ?? "The note could not be saved.",
          });
        }
        const outcome = await watchChangeset(props.replaces, (message) =>
          setPhase({ kind: "saving", message }),
        );
        if (outcome.kind === "published") {
          router.push(outcome.status.href ?? `/changes/${props.replaces}`);
          router.refresh();
          return;
        }
        setPhase(outcome);
      } catch {
        setPhase({
          kind: "failed",
          message: "The Library could not be reached. Nothing was saved.",
        });
      }
      return;
    }
    if (reviewing) {
      // The suggestion stays its author's: the reviewer's edits go into the same changeset.
      try {
        const res = await fetch(`/api/changesets/${merge.changesetId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            noteId: note.id,
            baseSha: note.blobSha,
            body,
            set: changed,
            unset,
            changeClass,
            ...(summary.trim() ? { summary: summary.trim() } : {}),
          }),
        });
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          return setPhase({
            kind: "failed",
            message: json.error ?? "The edit could not be saved.",
          });
        }
        const outcome = await watchChangeset(merge.changesetId, (message) =>
          setPhase({ kind: "saving", message }),
        );
        if (outcome.kind === "failed" || outcome.kind === "invalid") return setPhase(outcome);
        router.push(`/changes/${merge.changesetId}`);
        router.refresh();
      } catch {
        setPhase({
          kind: "failed",
          message: "The Library could not be reached. Nothing was saved.",
        });
      }
      return;
    }
    const outcome = await submitChangeset(request, (message) =>
      setPhase({ kind: "saving", message }),
    );
    if (outcome.kind === "failed" || outcome.kind === "invalid") return setPhase(outcome);
    // The changeset this one replaces is no longer needed.
    if (merge) void fetch(`/api/changesets/${merge.changesetId}`, { method: "DELETE" });
    if (outcome.kind === "published") {
      router.push(outcome.status.href ?? props.cancelHref);
      router.refresh();
      return;
    }
    setPhase(outcome);
  }

  const busy = phase.kind === "saving";
  const dirty =
    body !== note.body ||
    images.length > 0 ||
    Object.keys(changedFields(loaded, fields).set).length > 0 ||
    changedFields(loaded, fields).unset.length > 0;

  useEffect(() => {
    if (!dirty || phase.kind === "review" || busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, phase.kind, busy]);

  if (phase.kind === "review") {
    return (
      <div className="mx-auto max-w-[640px] px-5 py-16 text-center">
        <CheckCircle2 size={36} className="mx-auto text-ok" aria-hidden />
        <h1 className="mt-4 text-[22px] font-semibold text-ink">
          {writes ? "Sent for review" : "Suggestion sent"}
        </h1>
        <p className="mt-2 text-[14.5px] text-muted">
          Nothing is published yet. A reviewer will look at it, and you will be told what they
          decide.
        </p>
        <ul className="mx-auto mt-5 max-w-md space-y-1.5 text-left text-[13.5px] text-ink-2">
          {phase.status.reviewReasons.map((r) => (
            <li key={r.code} className="rounded-md bg-bg px-3 py-2">
              {r.message}
            </li>
          ))}
        </ul>
        <div className="mt-7 flex justify-center gap-3 text-[14px]">
          <Link
            href={`/changes/${phase.status.id}`}
            className="font-medium text-accent hover:underline"
          >
            See the change
          </Link>
          <Link href={props.cancelHref} className="text-muted hover:text-ink">
            Back to the note
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form
      className="mx-auto max-w-[1400px] px-5 pb-24 pt-6 md:px-8"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      aria-busy={busy}
    >
      <header className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-[20px] font-semibold tracking-[-0.01em] text-ink">
          {mode === "create"
            ? "New note"
            : reviewing
              ? "Edit the suggestion"
              : writes
                ? "Edit note"
                : "Suggest an edit"}
        </h1>
        <Link href={props.cancelHref} className="text-[14px] text-muted hover:text-ink">
          Cancel
        </Link>
        <button
          type="submit"
          disabled={busy || problems.length > 0 || (mode === "edit" && !dirty && !merge)}
          className="inline-flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-[14px] font-medium text-accent-ink hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : null}
          {reviewing ? "Save the suggestion" : writes ? "Save" : "Send suggestion"}
        </button>
      </header>

      <div aria-live="polite" className="space-y-2 empty:hidden">
        {busy ? <p className="text-[13.5px] text-muted">{phase.message}</p> : null}
        {merge?.moved ? (
          <Banner kind="stale" title="Someone else changed this note in the meantime">
            Their version and {reviewing ? "the suggestion" : "yours"} are combined below.{" "}
            {merge.conflicts
              ? `${merge.conflicts} ${merge.conflicts === 1 ? "place needs" : "places need"} your decision: look for the lines between <<<<<<< and >>>>>>>, keep what is right, and delete the markers.`
              : "Nothing overlapped, so check the result and save."}
          </Banner>
        ) : null}
        {reviewing ? (
          <Banner kind="info" title="You are editing a suggestion before approving it">
            Saving updates the suggestion. It is still published in its author&apos;s name, with
            yours added when you approve it.
          </Banner>
        ) : null}
        {phase.kind === "failed" ? (
          <Banner kind="reported" title="Not saved">
            {phase.message}
          </Banner>
        ) : null}
        {phase.kind === "conflict" ? (
          <Banner kind="stale" title="Someone else changed this note while you were editing">
            Your change was not saved over theirs.{" "}
            <Link href={`/changes/${phase.status.id}`} className="font-medium underline">
              Combine the two versions
            </Link>
          </Banner>
        ) : null}
        {phase.kind === "invalid" ? (
          <Banner kind="reported" title={phase.status.error ?? "There are problems to fix"}>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {phase.status.issues
                .filter((i) => i.severity === "error")
                .map((i, n) => (
                  <li key={n}>
                    {i.message}
                    {i.line ? <span className="text-muted"> (line {i.line})</span> : null}
                  </li>
                ))}
            </ul>
          </Banner>
        ) : null}
      </div>

      <div className="mt-4 grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <div>
            <label htmlFor={`${ids}-title`} className="mb-1 block text-[13px] font-medium text-ink">
              Title <span className="text-bad">*</span>
            </label>
            <input
              id={`${ids}-title`}
              value={title}
              onChange={(e) => set("title", e.target.value)}
              maxLength={160}
              required
              placeholder="Specific enough to answer a search"
              className={cn(inputClass, "h-10 text-[16px] font-medium")}
            />
          </div>
          <div>
            <label htmlFor={`${ids}-desc`} className="mb-1 block text-[13px] font-medium text-ink">
              Description <span className="text-bad">*</span>
            </label>
            <textarea
              id={`${ids}-desc`}
              value={str(fields.description)}
              onChange={(e) => set("description", e.target.value)}
              rows={2}
              maxLength={400}
              required
              placeholder="One sentence. Shown in search results and lists."
              className={cn(inputClass, "h-auto resize-y py-2 leading-snug")}
            />
          </div>

          {mode === "create" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor={`${ids}-ns`}
                  className="mb-1 block text-[13px] font-medium text-ink"
                >
                  Namespace <span className="text-bad">*</span>
                </label>
                <select
                  id={`${ids}-ns`}
                  value={namespace}
                  disabled={!!props.replaces}
                  onChange={(e) => setNamespace(e.target.value)}
                  className={inputClass}
                >
                  {(props.namespaces ?? []).map((n) => (
                    <option key={n.slug} value={n.slug}>
                      {n.title}
                      {n.writes ? "" : " (suggestion)"}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor={`${ids}-type`}
                  className="mb-1 block text-[13px] font-medium text-ink"
                >
                  Type <span className="text-bad">*</span>
                </label>
                <select
                  id={`${ids}-type`}
                  value={str(fields.type)}
                  onChange={(e) => set("type", e.target.value)}
                  className={inputClass}
                >
                  <option value="">Choose a type</option>
                  {vocabulary.types.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}

          <details className="group rounded-lg border border-line" open={mode === "create"}>
            <summary className="cursor-pointer select-none px-3.5 py-2.5 text-[13.5px] font-medium text-ink">
              Details
              <span className="ml-2 font-normal text-muted">
                {[
                  mode === "edit" ? str(fields.type) : null,
                  ...list(fields.themes),
                  ...list(fields.systems),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </summary>
            <div className="space-y-4 border-t border-line px-3.5 py-4">
              {note.isHub ? null : (
                <TermPicker
                  label="Themes"
                  hint="The business journey or area this belongs to."
                  terms={vocabulary.themes}
                  value={list(fields.themes)}
                  onChange={(v) => set("themes", v)}
                  max={3}
                  required
                />
              )}
              {note.isHub ? null : (
                <TermPicker
                  label="Systems"
                  hint="The tools this is about."
                  terms={vocabulary.systems}
                  value={list(fields.systems)}
                  onChange={(v) => set("systems", v)}
                />
              )}
              <TermPicker
                label="Tags"
                terms={vocabulary.tags}
                value={list(fields.tags)}
                onChange={(v) => set("tags", v)}
                max={8}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor={`${ids}-aliases`}
                    className="mb-1 block text-[13px] font-medium text-ink"
                  >
                    Other names
                  </label>
                  <input
                    id={`${ids}-aliases`}
                    value={list(fields.aliases).join(", ")}
                    onChange={(e) =>
                      set(
                        "aliases",
                        e.target.value
                          .split(",")
                          .map((s) => s.trimStart())
                          .filter((s, i, all) => s !== "" || i === all.length - 1),
                      )
                    }
                    onBlur={() =>
                      set(
                        "aliases",
                        list(fields.aliases)
                          .map((s) => s.trim())
                          .filter(Boolean),
                      )
                    }
                    placeholder="What people search for, separated by commas"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label
                    htmlFor={`${ids}-owner`}
                    className="mb-1 block text-[13px] font-medium text-ink"
                  >
                    Owner
                  </label>
                  <select
                    id={`${ids}-owner`}
                    value={str(fields.owner)}
                    onChange={(e) => set("owner", e.target.value)}
                    className={inputClass}
                  >
                    <option value="">The namespace&apos;s owner</option>
                    {[...new Set([...vocabulary.teams, str(loaded.owner)].filter(Boolean))].map(
                      (t) => (
                        <option key={t}>{t}</option>
                      ),
                    )}
                  </select>
                </div>
                {note.isHub ? null : (
                  <div>
                    <label
                      htmlFor={`${ids}-status`}
                      className="mb-1 block text-[13px] font-medium text-ink"
                    >
                      Status
                    </label>
                    <select
                      id={`${ids}-status`}
                      value={str(fields.status) === "stable" ? "" : str(fields.status)}
                      onChange={(e) => set("status", e.target.value)}
                      className={inputClass}
                    >
                      <option value="">Published</option>
                      <option value="draft">Draft</option>
                      {str(loaded.status) === "deprecated" ? (
                        <option value="deprecated">Deprecated</option>
                      ) : null}
                    </select>
                  </div>
                )}
                {vocabulary.customFields.map((f) => (
                  <div key={f.name}>
                    <label
                      htmlFor={`${ids}-c-${f.name}`}
                      className="mb-1 block text-[13px] font-medium capitalize text-ink"
                    >
                      {f.name.replace(/[_-]/g, " ")}
                      {f.required ? <span className="text-bad"> *</span> : null}
                    </label>
                    {f.type === "enum" ? (
                      <select
                        id={`${ids}-c-${f.name}`}
                        value={str(fields[f.name])}
                        onChange={(e) => set(f.name, e.target.value)}
                        className={inputClass}
                      >
                        <option value="">Not set</option>
                        {(f.values ?? []).map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={`${ids}-c-${f.name}`}
                        value={str(fields[f.name])}
                        onChange={(e) => set(f.name, e.target.value)}
                        className={inputClass}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </details>

          <div>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="text-[13px] font-medium text-ink">Body</span>
              <span
                className={cn(
                  "text-[12.5px] tabular-nums",
                  count > limits.wordsError
                    ? "font-medium text-bad"
                    : count > limits.wordsWarn
                      ? "text-warn"
                      : "text-muted",
                )}
              >
                {count} words
                {count > limits.wordsWarn && count <= limits.wordsError
                  ? ". Consider splitting the note."
                  : ""}
              </span>
            </div>
            <CodeEditor
              label="Note body"
              initial={merge?.body ?? note.body}
              onChange={setBody}
              onImages={addImages}
              bundleRoot={bundleRoot}
              notePath={path}
              linkStyle={vocabulary.linkStyle}
              invalid={markers.length > 0}
            />
            <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-muted">
              <ImagePlus size={13} aria-hidden />
              Paste or drop images into the text. Type [[ to link to a note.
            </p>
            {imageError ? (
              <p role="alert" className="mt-1 flex items-center gap-1.5 text-[13px] text-bad">
                <AlertTriangle size={13} aria-hidden />
                {imageError}
              </p>
            ) : null}
          </div>

          <div className="space-y-4 rounded-lg border border-line bg-bg p-4">
            {mode === "edit" ? (
              <fieldset>
                <legend className="mb-2 text-[13px] font-medium text-ink">
                  What kind of change is this?
                </legend>
                <div className="space-y-1.5">
                  {CLASSES.map((c) => (
                    <label
                      key={c.value}
                      className={cn(
                        "flex cursor-pointer gap-2.5 rounded-md border px-3 py-2",
                        changeClass === c.value
                          ? "border-accent bg-paper"
                          : "border-transparent hover:bg-hover",
                      )}
                    >
                      <input
                        type="radio"
                        name={`${ids}-class`}
                        value={c.value}
                        checked={changeClass === c.value}
                        onChange={() => setChosenClass(c.value)}
                        className="mt-1 accent-[var(--accent)]"
                      />
                      <span>
                        <span className="block text-[13.5px] font-medium text-ink">{c.label}</span>
                        <span className="block text-[12.5px] leading-snug text-muted">
                          {c.help}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
            {changeClass === "process" && mode === "edit" ? (
              <div>
                <label
                  htmlFor={`${ids}-summary`}
                  className="mb-1 block text-[13px] font-medium text-ink"
                >
                  What changed? <span className="text-bad">*</span>
                </label>
                <input
                  id={`${ids}-summary`}
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  maxLength={300}
                  placeholder="One sentence for the log and the people who are told"
                  className={inputClass}
                />
              </div>
            ) : null}
            {reviewing ? null : writes ? (
              note.isHub || str(fields.status) === "draft" ? null : (
                <label className="flex cursor-pointer items-start gap-2.5 text-[13.5px] text-ink-2">
                  <input
                    type="checkbox"
                    checked={verify}
                    onChange={(e) => setVerify(e.target.checked)}
                    className="mt-0.5 size-4 accent-[var(--accent)]"
                  />
                  <span>
                    I checked this is accurate
                    <span className="block text-[12.5px] text-muted">
                      Marks the note as verified by you and sets its next review date.
                    </span>
                  </span>
                </label>
              )
            ) : (
              <div>
                <label
                  htmlFor={`${ids}-reason`}
                  className="mb-1 block text-[13px] font-medium text-ink"
                >
                  Why are you suggesting this? <span className="text-bad">*</span>
                </label>
                <input
                  id={`${ids}-reason`}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={500}
                  placeholder="A sentence for the reviewer"
                  className={inputClass}
                />
                <p className="mt-1 text-[12.5px] text-muted">
                  You read this namespace but do not write in it, so a writer reviews your change
                  before it is published.
                </p>
              </div>
            )}
            {problems.length ? (
              <ul className="space-y-0.5 text-[13px] text-ink-2" aria-label="Before you can save">
                {problems.map((p) => (
                  <li key={p} className="flex gap-1.5">
                    <span aria-hidden className="text-muted">
                      •
                    </span>
                    {p}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>

        <div className="min-w-0">
          <div
            role="tablist"
            aria-label="Beside the editor"
            className="mb-3 flex gap-1 border-b border-line"
          >
            {(
              [
                ["preview", "Preview"],
                ["similar", `Similar notes${similar.length ? ` (${similar.length})` : ""}`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                id={`${ids}-tab-${key}`}
                aria-selected={tab === key}
                aria-controls={`${ids}-panel-${key}`}
                onClick={() => setTab(key)}
                className={cn(
                  "-mb-px border-b-2 px-3 py-2 text-[13.5px]",
                  tab === key
                    ? "border-accent font-medium text-ink"
                    : "border-transparent text-muted hover:text-ink",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id={`${ids}-panel-preview`}
            aria-labelledby={`${ids}-tab-preview`}
            hidden={tab !== "preview"}
            className="xl:sticky xl:top-4 xl:max-h-[calc(100dvh-6rem)] xl:overflow-y-auto"
          >
            <p className="text-[24px] font-semibold leading-tight tracking-[-0.02em] text-ink">
              {title || "Untitled"}
            </p>
            {str(fields.description) ? (
              <p className="mt-1.5 text-[15px] text-muted">{str(fields.description)}</p>
            ) : null}
            {preview === null ? (
              <p className="mt-6 text-[13.5px] text-muted">Rendering…</p>
            ) : (
              <div className="note-body" dangerouslySetInnerHTML={{ __html: preview }} />
            )}
          </div>
          <div
            role="tabpanel"
            id={`${ids}-panel-similar`}
            aria-labelledby={`${ids}-tab-similar`}
            hidden={tab !== "similar"}
          >
            <p className="mb-3 text-[13px] text-muted">
              Notes with a similar title. If one of them covers this already, update it instead of
              writing a second one.
            </p>
            {similar.length ? (
              <ul className="space-y-1">
                {similar.map((s) => (
                  <li key={s.id}>
                    <a
                      href={s.href}
                      target="_blank"
                      rel="noreferrer"
                      className="block rounded-md px-3 py-2 hover:bg-bg"
                    >
                      <span className="block text-[14px] font-medium text-ink">{s.title}</span>
                      <span className="block text-[13px] leading-snug text-muted">
                        {s.description}
                      </span>
                      <span className="text-[12px] text-faint">
                        {s.namespace} <span className="sr-only">(opens in a new tab)</span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13.5px] text-muted">
                {title.trim().length < 4
                  ? "Type a title to look for similar notes."
                  : "Nothing similar found."}
              </p>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
