"use client";

import { useRouter } from "next/navigation";
import { FileUp, ImagePlus, Loader2, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Banner } from "@lore/ui";
import { TermPicker, type Term } from "./editor/TermPicker";

export interface IngestFormProps {
  kind: "upload" | "capture";
  namespaces: { slug: string; title: string; writes: boolean; ai: boolean }[];
  themes: Term[];
  tags: Term[];
  /** Whether any model can be called at all. */
  aiAvailable: boolean;
  initialNamespace?: string;
  /** The note a capture updates, when it was started from a note page. */
  target?: { id: string; title: string; namespace: string };
  limits: { maxMb: number; maxPages: number; maxImages: number };
}

const input =
  "h-9 w-full rounded-md border border-line bg-paper px-2.5 text-[14px] text-ink placeholder:text-faint";
const ACCEPT = ".pdf,.docx,.pptx,.xlsx,.csv,.html,.htm,.md,.txt,.png,.jpg,.jpeg";

/** Upload a file, or capture rough notes. No prompt box: the pipeline is fixed (PRD 7.1). */
export function IngestForm(props: IngestFormProps) {
  const { kind, namespaces, limits } = props;
  const router = useRouter();
  const ids = useId();
  const [namespace, setNamespace] = useState(
    props.target?.namespace ?? props.initialNamespace ?? namespaces[0]?.slug ?? "",
  );
  const [theme, setTheme] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [images, setImages] = useState<{ file: File; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const ns = namespaces.find((n) => n.slug === namespace);
  const usesAi = props.aiAvailable && (ns?.ai ?? false);
  const tooBig = file && file.size > limits.maxMb * 1024 * 1024;
  const ready =
    !!ns &&
    !tooBig &&
    (kind === "upload" ? !!file : text.trim().length >= 20 || images.length > 0) &&
    // Without AI nothing chooses a theme, so the person does.
    (usesAi || theme.length > 0);

  function addImages(list: FileList | null) {
    setError(null);
    const next = [...images];
    for (const f of [...(list ?? [])]) {
      if (!/^image\/(png|jpeg)$/.test(f.type)) {
        setError("Only PNG and JPEG images can be added.");
        continue;
      }
      if (next.length >= limits.maxImages) {
        setError(`A capture can have up to ${limits.maxImages} images.`);
        break;
      }
      const url = URL.createObjectURL(f);
      urls.current.push(url);
      next.push({ file: f, url });
    }
    setImages(next);
  }

  async function submit(processNow: boolean) {
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("kind", kind);
    form.set("namespace", namespace);
    if (theme[0]) form.set("theme", theme[0]);
    for (const t of tags) form.append("tags", t);
    if (processNow) form.set("process", "now");
    if (kind === "upload" && file) form.set("file", file);
    if (kind === "capture") {
      form.set("text", text);
      for (const i of images) form.append("images", i.file);
      if (props.target) form.set("target", props.target.id);
    }
    try {
      const res = await fetch("/api/ingest", { method: "POST", body: form });
      const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !json.id) {
        setError(json.error ?? "It could not be sent.");
        return;
      }
      router.push(`/uploads/${json.id}`);
    } catch {
      setError("The Library could not be reached. Nothing was sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-6"
      aria-busy={busy}
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) void submit(true);
      }}
    >
      {kind === "upload" ? (
        <div>
          <label htmlFor={`${ids}-file`} className="mb-1 block text-[13px] font-medium text-ink">
            File <span className="text-bad">*</span>
          </label>
          <input
            id={`${ids}-file`}
            type="file"
            accept={ACCEPT}
            required
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            aria-describedby={`${ids}-file-help`}
            className="block w-full rounded-lg border border-dashed border-line bg-bg px-3 py-6 text-[14px] text-ink-2 file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-[13px] file:font-medium file:text-accent-ink"
          />
          <p id={`${ids}-file-help`} className="mt-1.5 text-[12.5px] text-muted">
            PDF, Word, PowerPoint, Excel, CSV, HTML, Markdown, text, PNG, or JPEG. Up to{" "}
            {limits.maxMb} MB and {limits.maxPages} pages.
          </p>
          {tooBig ? (
            <p role="alert" className="mt-1 text-[13px] text-bad">
              This file is larger than {limits.maxMb} MB.
            </p>
          ) : null}
        </div>
      ) : (
        <>
          {props.target ? (
            <Banner kind="info" title={`Updating "${props.target.title}"`}>
              What you write here is used to update that note.
            </Banner>
          ) : null}
          <div>
            <label htmlFor={`${ids}-text`} className="mb-1 block text-[13px] font-medium text-ink">
              What do you want to record?
            </label>
            <textarea
              id={`${ids}-text`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              maxLength={60_000}
              placeholder="Rough is fine: steps as you did them, what someone told you, what went wrong."
              className={`${input} h-auto resize-y py-2 leading-relaxed`}
            />
          </div>
          <div>
            <p className="mb-1 text-[13px] font-medium text-ink">
              Screenshots{" "}
              <span className="font-normal text-muted">
                {images.length} of {limits.maxImages}
              </span>
            </p>
            {images.length ? (
              <ul className="mb-2 flex flex-wrap gap-2">
                {images.map((img, i) => (
                  <li key={img.url} className="relative">
                    <img
                      src={img.url}
                      alt={img.file.name}
                      className="size-20 rounded-md border border-line object-cover"
                    />
                    <button
                      type="button"
                      aria-label={`Remove ${img.file.name}`}
                      onClick={() => setImages(images.filter((_x, j) => j !== i))}
                      className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full border border-line bg-paper text-ink-2 hover:bg-hover"
                    >
                      <X size={13} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-line bg-paper px-2.5 text-[13px] font-medium text-ink-2 hover:bg-hover has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent">
              <ImagePlus size={14} aria-hidden />
              Add screenshots
              <input
                type="file"
                accept="image/png,image/jpeg"
                multiple
                className="sr-only"
                onChange={(e) => {
                  addImages(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </>
      )}

      <div>
        <label htmlFor={`${ids}-ns`} className="mb-1 block text-[13px] font-medium text-ink">
          Namespace <span className="text-bad">*</span>
        </label>
        <select
          id={`${ids}-ns`}
          value={namespace}
          disabled={!!props.target}
          onChange={(e) => setNamespace(e.target.value)}
          className={input}
        >
          {namespaces.map((n) => (
            <option key={n.slug} value={n.slug}>
              {n.title}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-[12.5px] text-muted">
          {!ns
            ? ""
            : !usesAi
              ? ns.ai
                ? "AI is not available right now, so the file is converted as it is and saved as a draft for you to finish."
                : `AI processing is turned off for ${ns.title}. The file is converted as it is and saved as a draft for you to finish.`
              : ns.writes
                ? "AI drafts notes from it. A writer reviews them before anything is published."
                : `AI drafts notes from it. You read ${ns.title} but do not write in it, so a writer reviews them first.`}
        </p>
      </div>

      <TermPicker
        label="Theme"
        hint={
          usesAi
            ? "Optional. A hint for where it belongs."
            : "Needed, because no AI will choose one."
        }
        terms={props.themes}
        value={theme}
        onChange={(v) => setTheme(v.slice(-1))}
        required={!usesAi}
      />
      <TermPicker
        label="Tags"
        hint="Optional."
        terms={props.tags}
        value={tags}
        onChange={setTags}
        max={8}
      />

      {error ? (
        <Banner kind="reported" title="Not sent">
          {error}
        </Banner>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={busy || !ready}
          className="inline-flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-[14px] font-medium text-accent-ink hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? (
            <Loader2 size={15} className="animate-spin" aria-hidden />
          ) : (
            <FileUp size={15} aria-hidden />
          )}
          {kind === "upload" ? "Upload" : "Save the capture"}
        </button>
        {ns?.writes && usesAi ? (
          <button
            type="button"
            disabled={busy || !ready}
            onClick={() => void submit(false)}
            className="inline-flex h-9 items-center rounded-md border border-line bg-paper px-3.5 text-[14px] font-medium text-ink-2 hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add to the queue instead
          </button>
        ) : null}
      </div>
    </form>
  );
}
