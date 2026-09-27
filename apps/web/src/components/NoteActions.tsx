"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  BadgeCheck,
  FolderInput,
  Loader2,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { submitChangeset, type Outcome } from "./editor/submit";

export interface NoteActionsProps {
  note: { id: string; title: string; slug: string; namespace: string | null; folder: string };
  /** Publishes in this namespace. Everyone else suggests. */
  writes: boolean;
  /** Namespaces the note can move to. */
  namespaces: { slug: string; title: string }[];
  deprecated: boolean;
  isHub: boolean;
}

type Dialog = "move" | "deprecate" | "delete" | null;

const button =
  "inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-paper px-2.5 text-[13px] font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-50";
const input =
  "h-9 w-full rounded-md border border-line bg-paper px-2.5 text-[14px] text-ink placeholder:text-faint";

const slugify = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

/** What a person can do to a note: edit or suggest, verify, move, deprecate, delete. */
export function NoteActions({ note, writes, namespaces, deprecated, isHub }: NoteActionsProps) {
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Outcome | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent
          ? e.key === "Escape"
          : !menuRef.current?.contains(e.target as Node)
      )
        setMenu(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menu]);

  async function run(label: string, request: Record<string, unknown>) {
    setBusy(label);
    setResult(null);
    const outcome = await submitChangeset(request, setBusy);
    setBusy(null);
    setDialog(null);
    if (outcome.kind === "published") {
      if (request.kind === "delete") router.push("/");
      else if (outcome.status.href) router.replace(outcome.status.href);
      router.refresh();
      return;
    }
    setResult(outcome);
  }

  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/edit/${encodeURIComponent(note.id)}`} className={button}>
          <Pencil size={14} aria-hidden />
          {writes ? "Edit" : "Suggest an edit"}
        </Link>
        {writes && !isHub ? (
          <button
            type="button"
            className={button}
            disabled={busy !== null}
            onClick={() => void run("Verifying…", { kind: "verify", noteId: note.id })}
          >
            <BadgeCheck size={14} aria-hidden />
            Mark verified
          </button>
        ) : null}
        {isHub ? null : (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              className={button}
              aria-haspopup="menu"
              aria-expanded={menu}
              aria-label="More actions"
              onClick={() => setMenu((m) => !m)}
            >
              <MoreHorizontal size={15} aria-hidden />
            </button>
            {menu ? (
              <div
                role="menu"
                aria-label="More actions"
                className="absolute left-0 z-10 mt-1 w-56 overflow-hidden rounded-lg border border-line bg-paper py-1 shadow-lg"
              >
                <MenuItem
                  icon={<FolderInput size={14} aria-hidden />}
                  onSelect={() => (setMenu(false), setDialog("move"))}
                >
                  Move or rename
                </MenuItem>
                {deprecated ? null : (
                  <MenuItem
                    icon={<Archive size={14} aria-hidden />}
                    onSelect={() => (setMenu(false), setDialog("deprecate"))}
                  >
                    Deprecate
                  </MenuItem>
                )}
                <MenuItem
                  icon={<Trash2 size={14} aria-hidden />}
                  onSelect={() => (setMenu(false), setDialog("delete"))}
                >
                  Delete
                </MenuItem>
              </div>
            ) : null}
          </div>
        )}
        {busy ? (
          <span className="inline-flex items-center gap-1.5 text-[13px] text-muted" role="status">
            <Loader2 size={14} className="animate-spin" aria-hidden />
            {busy}
          </span>
        ) : null}
      </div>

      <div aria-live="polite">
        {result?.kind === "review" ? (
          <p className="mt-2 rounded-md bg-info-soft px-3 py-2 text-[13.5px] text-ink-2">
            Sent for review: {result.status.reviewReasons.map((r) => r.message).join(". ")}.{" "}
            <Link
              href={`/changes/${result.status.id}`}
              className="font-medium text-accent hover:underline"
            >
              See the change
            </Link>
          </p>
        ) : null}
        {result?.kind === "failed" ? (
          <p className="mt-2 rounded-md bg-bad-soft px-3 py-2 text-[13.5px] text-ink-2">
            {result.message}
          </p>
        ) : null}
        {result?.kind === "invalid" ? (
          <p className="mt-2 rounded-md bg-bad-soft px-3 py-2 text-[13.5px] text-ink-2">
            {result.status.error ?? "The change did not validate."}{" "}
            {result.status.issues
              .filter((i) => i.severity === "error")
              .map((i) => i.message)
              .join(" ")}
          </p>
        ) : null}
        {result?.kind === "conflict" ? (
          <p className="mt-2 rounded-md bg-warn-soft px-3 py-2 text-[13.5px] text-ink-2">
            The note changed a moment ago. Reload the page and try again.
          </p>
        ) : null}
      </div>

      {dialog === "move" ? (
        <MoveDialog
          note={note}
          namespaces={namespaces}
          writes={writes}
          busy={busy !== null}
          onClose={() => setDialog(null)}
          onSubmit={(r) => void run("Moving…", { kind: "move", noteId: note.id, ...r })}
        />
      ) : null}
      {dialog === "deprecate" ? (
        <DeprecateDialog
          note={note}
          writes={writes}
          busy={busy !== null}
          onClose={() => setDialog(null)}
          onSubmit={(r) => void run("Deprecating…", { kind: "deprecate", noteId: note.id, ...r })}
        />
      ) : null}
      {dialog === "delete" ? (
        <ConfirmDialog
          title={`Delete "${note.title}"?`}
          action="Delete"
          writes={writes}
          busy={busy !== null}
          onClose={() => setDialog(null)}
          onSubmit={(r) => void run("Deleting…", { kind: "delete", noteId: note.id, ...r })}
        >
          <p>
            Links to this note will point at nothing. If another note replaces it, deprecate it
            instead: the old note stays for history and points readers to the new one.
          </p>
          <p className="mt-2">A maintainer reviews deletions before they happen.</p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

function MenuItem(props: { icon: ReactNode; onSelect: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={props.onSelect}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13.5px] text-ink-2 hover:bg-hover hover:text-ink"
    >
      <span className="text-muted">{props.icon}</span>
      {props.children}
    </button>
  );
}

interface DialogProps<T> {
  writes: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (request: T & { reason?: string }) => void;
}

function Modal(props: {
  title: string;
  action: string;
  busy: boolean;
  disabled?: boolean;
  onClose: () => void;
  onSubmit: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={props.onClose}
      onClick={(e) => {
        if (e.target === ref.current) props.onClose();
      }}
      className="m-auto w-[calc(100vw-2rem)] max-w-[480px] rounded-xl border border-line bg-paper p-0 text-ink shadow-2xl backdrop:bg-black/30"
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          props.onSubmit();
        }}
        className="p-5"
      >
        <h2 id={titleId} className="text-[16px] font-semibold text-ink">
          {props.title}
        </h2>
        <div className="mt-3 space-y-3 text-[13.5px] leading-relaxed text-ink-2">
          {props.children}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={props.onClose} className={button}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={props.busy || props.disabled}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-accent-ink hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {props.busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}
            {props.action}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function Reason(props: { value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[13px] font-medium text-ink">
        Why? <span className="text-bad">*</span>
      </label>
      <input
        id={id}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        maxLength={500}
        placeholder="A sentence for the reviewer"
        className={input}
      />
    </div>
  );
}

function ConfirmDialog(
  props: DialogProps<object> & { title: string; action: string; children: ReactNode },
) {
  const [reason, setReason] = useState("");
  return (
    <Modal
      title={props.title}
      action={props.action}
      busy={props.busy}
      disabled={!props.writes && !reason.trim()}
      onClose={props.onClose}
      onSubmit={() => props.onSubmit(reason.trim() ? { reason: reason.trim() } : {})}
    >
      {props.children}
      <Reason value={reason} onChange={setReason} />
    </Modal>
  );
}

function MoveDialog(
  props: DialogProps<{ slug: string; namespace: string; folder: string }> & {
    note: NoteActionsProps["note"];
    namespaces: NoteActionsProps["namespaces"];
  },
) {
  const ids = useId();
  const [slug, setSlug] = useState(props.note.slug);
  const [namespace, setNamespace] = useState(props.note.namespace ?? "");
  const [folder, setFolder] = useState(props.note.folder);
  const [reason, setReason] = useState("");
  const clean = slugify(slug);
  const cleanFolder = folder.split("/").map(slugify).filter(Boolean).join("/");
  const same =
    clean === props.note.slug &&
    namespace === props.note.namespace &&
    cleanFolder === props.note.folder;
  const crosses = namespace !== props.note.namespace;
  return (
    <Modal
      title="Move or rename"
      action="Move"
      busy={props.busy}
      disabled={!clean || same || (!props.writes && !reason.trim())}
      onClose={props.onClose}
      onSubmit={() =>
        props.onSubmit({
          slug: clean,
          namespace,
          folder: cleanFolder,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        })
      }
    >
      <p>
        Every link to this note is rewritten in the same change, and its address in the Library
        stays the same.
      </p>
      <div>
        <label htmlFor={`${ids}-slug`} className="mb-1 block text-[13px] font-medium text-ink">
          File name
        </label>
        <div className="flex items-center gap-1.5">
          <input
            id={`${ids}-slug`}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            onBlur={() => setSlug(clean)}
            className={input}
          />
          <span className="text-muted">.md</span>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${ids}-ns`} className="mb-1 block text-[13px] font-medium text-ink">
            Namespace
          </label>
          <select
            id={`${ids}-ns`}
            value={namespace}
            onChange={(e) => setNamespace(e.target.value)}
            className={input}
          >
            {props.namespaces.map((n) => (
              <option key={n.slug} value={n.slug}>
                {n.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${ids}-folder`} className="mb-1 block text-[13px] font-medium text-ink">
            Folder
          </label>
          <input
            id={`${ids}-folder`}
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            onBlur={() => setFolder(cleanFolder)}
            placeholder="None"
            className={input}
          />
        </div>
      </div>
      {crosses ? (
        <p className="rounded-md bg-warn-soft px-3 py-2">
          Moving to another namespace changes who owns the note and who can read it. A maintainer
          reviews it first.
        </p>
      ) : null}
      {props.writes ? null : <Reason value={reason} onChange={setReason} />}
    </Modal>
  );
}

function DeprecateDialog(
  props: DialogProps<{ supersededBy: string }> & { note: NoteActionsProps["note"] },
) {
  const ids = useId();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: string; title: string; namespace: string | null }[]>([]);
  const [chosen, setChosen] = useState<{ id: string; title: string } | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (q.trim().length < 2) return setHits([]);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=6`);
        if (res.ok)
          setHits(
            ((await res.json()) as { hits: typeof hits }).hits.filter(
              (h) => h.id !== props.note.id,
            ),
          );
      } catch {
        setHits([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [q, props.note.id]);

  return (
    <Modal
      title={`Deprecate "${props.note.title}"`}
      action="Deprecate"
      busy={props.busy}
      disabled={!chosen || (!props.writes && !reason.trim())}
      onClose={props.onClose}
      onSubmit={() =>
        chosen &&
        props.onSubmit({
          supersededBy: chosen.id,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        })
      }
    >
      <p>
        The note stays for history with a banner pointing to its replacement. It drops out of search
        and the Desk stops citing it. A maintainer reviews it first.
      </p>
      <div>
        <label htmlFor={`${ids}-q`} className="mb-1 block text-[13px] font-medium text-ink">
          Which note replaces it? <span className="text-bad">*</span>
        </label>
        {chosen ? (
          <p className="flex items-center justify-between gap-2 rounded-md border border-accent bg-accent-soft px-3 py-2 text-ink">
            {chosen.title}
            <button
              type="button"
              onClick={() => setChosen(null)}
              className="text-[13px] text-accent hover:underline"
            >
              Change
            </button>
          </p>
        ) : (
          <>
            <input
              id={`${ids}-q`}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search for the replacement"
              className={input}
            />
            <ul className="mt-1 max-h-44 overflow-y-auto">
              {hits.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => setChosen(h)}
                    className="flex w-full items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-left hover:bg-hover"
                  >
                    <span className="text-ink">{h.title}</span>
                    <span className="text-[12px] text-muted">{h.namespace}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <Reason value={reason} onChange={setReason} />
    </Modal>
  );
}
