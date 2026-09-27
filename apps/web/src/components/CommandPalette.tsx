"use client";

import { Command } from "cmdk";
import { ArrowRight, CornerDownLeft, FileText, Loader2, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { TypeIcon } from "./TypeIcon";

interface PaletteHit {
  id: string;
  slug: string;
  title: string;
  description: string;
  type: string;
  namespace: string | null;
  href: string;
}

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "done"; hits: PaletteHit[]; keywordOnly: boolean };

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PAGES = [
  { label: "Home", href: "/" },
  { label: "Themes", href: "/themes" },
  { label: "Systems", href: "/systems" },
  { label: "Types", href: "/types" },
  { label: "Tags", href: "/tags" },
  { label: "Namespaces", href: "/ns" },
];

const DEBOUNCE_MS = 120;

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const requestId = useRef(0);

  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setState({ status: "idle" });
      return;
    }
    const id = ++requestId.current;
    setState((s) => (s.status === "done" ? s : { status: "loading" }));
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query)}&limit=12`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((data: { hits: PaletteHit[]; keywordOnly: boolean }) => {
          if (id === requestId.current)
            setState({ status: "done", hits: data.hits, keywordOnly: data.keywordOnly });
        })
        .catch(() => {
          if (id === requestId.current) setState({ status: "error" });
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q]);

  function go(href: string) {
    onOpenChange(false);
    router.push(href);
  }

  const groups = state.status === "done" ? groupByType(state.hits) : [];
  const pages = PAGES.filter((p) => !q || p.label.toLowerCase().includes(q.toLowerCase()));

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Search the Library"
      shouldFilter={false}
      overlayClassName="fixed inset-0 z-40 bg-black/25 backdrop-blur-[2px]"
      contentClassName="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-2rem)] max-w-[640px] -translate-x-1/2 overflow-hidden rounded-xl border border-line bg-paper shadow-2xl"
    >
      <div className="flex items-center gap-2 border-b border-line px-4">
        <Search size={16} className="text-muted" aria-hidden />
        <Command.Input
          value={q}
          onValueChange={setQ}
          placeholder="Search notes, runbooks, systems…"
          className="h-12 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-faint focus-visible:outline-none"
        />
        {state.status === "loading" ? (
          <Loader2 size={15} className="animate-spin text-faint" aria-label="Searching" />
        ) : null}
        <kbd className="rounded border border-line px-1.5 py-0.5 text-[10.5px] text-faint">Esc</kbd>
      </div>

      <Command.List className="max-h-[min(60vh,460px)] overflow-y-auto p-1.5">
        {state.status === "error" ? (
          <p className="px-3 py-6 text-center text-sm text-bad">
            Search is unavailable right now. Try again in a moment.
          </p>
        ) : null}
        {state.status === "done" && state.hits.length === 0 ? (
          <Command.Empty className="px-3 py-6 text-center text-sm text-muted">
            No notes match “{q}”.
          </Command.Empty>
        ) : null}

        {groups.map(([type, hits]) => (
          <Command.Group key={type} heading={type}>
            {hits.map((h) => (
              <Command.Item
                key={h.id}
                value={h.id}
                onSelect={() => go(h.href)}
                className="flex cursor-pointer items-start gap-3 rounded-md px-3 py-2"
              >
                <TypeIcon type={h.type} className="mt-0.5 shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{h.title}</p>
                  {h.description ? (
                    <p className="truncate text-xs text-muted">{h.description}</p>
                  ) : null}
                </div>
                {h.namespace ? (
                  <span className="shrink-0 pt-0.5 text-xs text-faint">{h.namespace}</span>
                ) : null}
              </Command.Item>
            ))}
          </Command.Group>
        ))}

        {q.trim() ? (
          <Command.Group heading="Search">
            <Command.Item
              value="__all__"
              onSelect={() => go(`/search?q=${encodeURIComponent(q.trim())}`)}
              className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-ink-2"
            >
              <FileText size={16} className="text-muted" aria-hidden />
              See all results for “{q.trim()}”
            </Command.Item>
          </Command.Group>
        ) : null}

        {pages.length ? (
          <Command.Group heading="Go to">
            {pages.map((p) => (
              <Command.Item
                key={p.href}
                value={`page:${p.href}`}
                onSelect={() => go(p.href)}
                className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-ink-2"
              >
                <ArrowRight size={16} className="text-muted" aria-hidden />
                {p.label}
              </Command.Item>
            ))}
          </Command.Group>
        ) : null}
      </Command.List>

      <div className="flex items-center gap-4 border-t border-line bg-bg px-4 py-2 text-[11px] text-faint">
        <span className="flex items-center gap-1">
          <kbd className="rounded border border-line px-1">↑</kbd>
          <kbd className="rounded border border-line px-1">↓</kbd> to navigate
        </span>
        <span className="flex items-center gap-1">
          <CornerDownLeft size={11} aria-hidden /> to open
        </span>
        {state.status === "done" && state.keywordOnly ? (
          <span className="ml-auto">Keyword search only</span>
        ) : null}
      </div>
    </Command.Dialog>
  );
}

function groupByType(hits: PaletteHit[]): [string, PaletteHit[]][] {
  const map = new Map<string, PaletteHit[]>();
  for (const h of hits) map.set(h.type, [...(map.get(h.type) ?? []), h]);
  return [...map];
}
