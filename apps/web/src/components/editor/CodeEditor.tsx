"use client";

import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useEffect, useRef } from "react";
import { linkHref, markdownLink, openWikilink } from "./links";

export interface CodeEditorProps {
  label: string;
  initial: string;
  onChange: (text: string) => void;
  /** Called with image files pasted or dropped; returns the markdown to insert for each. */
  onImages: (files: File[]) => Promise<string[]>;
  bundleRoot: string;
  /** Repository path of the note, for relative links. */
  notePath: string;
  linkStyle: "absolute" | "relative";
  /** Lines to mark, for example unresolved merge conflicts. */
  invalid?: boolean;
}

interface SearchHit {
  id: string;
  title: string;
  description: string;
  namespace: string | null;
  type: string;
  path: string;
}

const highlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "650", color: "var(--ink)" },
  { tag: tags.strong, fontWeight: "650" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: [tags.link, tags.url], color: "var(--accent)" },
  { tag: tags.monospace, fontFamily: "var(--font-mono)", color: "var(--ink)" },
  { tag: [tags.processingInstruction, tags.meta, tags.contentSeparator], color: "var(--muted)" },
  { tag: tags.quote, color: "var(--muted)" },
  { tag: tags.comment, color: "var(--muted)" },
]);

const theme = EditorView.theme({
  "&": { fontSize: "14.5px", backgroundColor: "transparent", color: "var(--ink-2)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.65",
    minHeight: "420px",
    overflow: "auto",
  },
  ".cm-content": { padding: "14px 16px", caretColor: "var(--ink)" },
  ".cm-line": { padding: "0" },
  ".cm-cursor": { borderLeftColor: "var(--ink)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "var(--accent-soft)",
  },
  ".cm-placeholder": { color: "var(--faint)" },
  ".cm-tooltip": {
    border: "1px solid var(--line)",
    borderRadius: "8px",
    backgroundColor: "var(--paper)",
    color: "var(--ink)",
    boxShadow: "0 8px 24px rgb(0 0 0 / 0.12)",
    overflow: "hidden",
  },
  ".cm-tooltip-autocomplete > ul": { fontFamily: "var(--font-sans)", maxHeight: "280px" },
  ".cm-tooltip-autocomplete > ul > li": { padding: "6px 10px", lineHeight: "1.35" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--accent-soft)",
    color: "var(--ink)",
  },
  ".cm-completionDetail": { color: "var(--muted)", fontStyle: "normal", marginLeft: "8px" },
});

/**
 * The markdown editor. Typing `[[` searches the vault and inserts a standard markdown link,
 * never a wikilink. Pasted and dropped images are handed to the page, which keeps them until
 * the note is saved.
 *
 * Tab is left alone so that keyboard users can move through the page; Escape then Tab also
 * works, as CodeMirror documents.
 */
export function CodeEditor(props: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // The latest props, for handlers created once with the editor.
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    if (!host.current) return;

    async function complete(ctx: CompletionContext): Promise<CompletionResult | null> {
      const line = ctx.state.doc.lineAt(ctx.pos);
      const open = openWikilink(line.text.slice(0, ctx.pos - line.from));
      if (!open) return null;
      const from = line.from + open.from;
      let hits: SearchHit[] = [];
      if (open.query.trim().length >= 2) {
        try {
          const res = await fetch(`/api/search?q=${encodeURIComponent(open.query)}&limit=8`, {
            signal: AbortSignal.timeout(4000),
          });
          if (res.ok) hits = ((await res.json()) as { hits: SearchHit[] }).hits;
        } catch {
          hits = [];
        }
        if (ctx.aborted) return null;
      }
      const p = latest.current;
      return {
        from,
        to: ctx.pos,
        filter: false,
        options: hits.map((h, i) => ({
          label: h.title,
          detail: [h.type, h.namespace].filter(Boolean).join(" · "),
          boost: hits.length - i,
          apply(v, _completion, start, end) {
            // Swallow a closing `]]` the writer may have typed already.
            const after = v.state.doc.sliceString(end, end + 2) === "]]" ? end + 2 : end;
            const text = markdownLink(
              h.title,
              linkHref(p.bundleRoot, p.notePath, h.path, p.linkStyle),
            );
            v.dispatch({
              changes: { from: start, to: after, insert: text },
              selection: { anchor: start + text.length },
            });
          },
        })),
      };
    }

    async function insertImages(v: EditorView, files: File[], at: number): Promise<void> {
      const snippets = await latest.current.onImages(files);
      if (!snippets.length) return;
      const text = snippets.join("\n\n");
      v.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length } });
      v.focus();
    }
    const images = (list: FileList | undefined | null) =>
      [...(list ?? [])].filter((f) => f.type.startsWith("image/"));

    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: props.initial,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown(),
          syntaxHighlighting(highlight),
          EditorView.lineWrapping,
          placeholder("Write the note in markdown. Type [[ to link to another note."),
          autocompletion({ override: [complete], activateOnTyping: true, icons: false }),
          EditorView.contentAttributes.of({
            "aria-label": props.label,
            "aria-multiline": "true",
            spellcheck: "true",
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) latest.current.onChange(u.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            paste(event, ed) {
              const files = images(event.clipboardData?.files);
              if (!files.length) return false;
              event.preventDefault();
              void insertImages(ed, files, ed.state.selection.main.head);
              return true;
            },
            drop(event, ed) {
              const files = images(event.dataTransfer?.files);
              if (!files.length) return false;
              event.preventDefault();
              const at =
                ed.posAtCoords({ x: event.clientX, y: event.clientY }) ??
                ed.state.selection.main.head;
              void insertImages(ed, files, at);
              return true;
            },
          }),
          theme,
        ],
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // The editor is created once; later props reach it through `latest`.
  }, []);

  return (
    <div
      ref={host}
      className={`overflow-hidden rounded-lg border bg-paper focus-within:ring-4 focus-within:ring-accent/10 ${
        props.invalid
          ? "border-bad/60 focus-within:border-bad"
          : "border-line focus-within:border-accent/50"
      }`}
    />
  );
}
