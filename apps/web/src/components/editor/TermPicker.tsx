"use client";

import { Check } from "lucide-react";
import { useId, useState } from "react";
import { cn } from "@lore/ui";

export interface Term {
  slug: string;
  title: string;
  description?: string;
}

interface TermPickerProps {
  label: string;
  hint?: string;
  terms: Term[];
  value: string[];
  onChange: (next: string[]) => void;
  /** No more than this many can be chosen. */
  max?: number;
  required?: boolean;
}

const FILTER_FROM = 9;

/**
 * Chooses terms from the vocabulary. There is no free text: a term that does not exist is
 * proposed through the taxonomy queue, never invented by typing.
 */
export function TermPicker({
  label,
  hint,
  terms,
  value,
  onChange,
  max,
  required,
}: TermPickerProps) {
  const id = useId();
  const [filter, setFilter] = useState("");
  const chosen = new Set(value);
  const full = max !== undefined && value.length >= max;
  const q = filter.trim().toLowerCase();
  const shown = terms.filter(
    (t) => chosen.has(t.slug) || !q || t.slug.includes(q) || t.title.toLowerCase().includes(q),
  );
  // Terms the note already carries but the vocabulary no longer lists stay visible, so
  // opening the form never drops them silently.
  const unknown = value.filter((v) => !terms.some((t) => t.slug === v));

  function toggle(slug: string) {
    if (chosen.has(slug)) onChange(value.filter((v) => v !== slug));
    else if (!full) onChange([...value, slug]);
  }

  return (
    <fieldset>
      <legend className="mb-1 text-[13px] font-medium text-ink">
        {label}
        {required ? <span className="text-bad"> *</span> : null}
        {max !== undefined ? (
          <span className="ml-1.5 font-normal text-muted">
            {value.length} of {max}
          </span>
        ) : null}
      </legend>
      {hint ? (
        <p id={`${id}-hint`} className="mb-1.5 text-[12.5px] text-muted">
          {hint}
        </p>
      ) : null}
      {terms.length >= FILTER_FROM ? (
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`Filter ${label.toLowerCase()}`}
          aria-label={`Filter ${label.toLowerCase()}`}
          className="mb-1.5 h-8 w-full rounded-md border border-line bg-paper px-2.5 text-[13px] text-ink placeholder:text-faint"
        />
      ) : null}
      <div
        className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto"
        aria-describedby={hint ? `${id}-hint` : undefined}
      >
        {[
          ...unknown.map((slug) => ({ slug, title: slug, description: "Not in the vocabulary" })),
          ...shown,
        ].map((t) => {
          const on = chosen.has(t.slug);
          const off = !on && full;
          return (
            <label
              key={t.slug}
              title={t.description || undefined}
              className={cn(
                "inline-flex min-h-7 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-[13px] transition-colors",
                "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
                on
                  ? "border-accent bg-accent-soft text-ink"
                  : "border-line bg-paper text-ink-2 hover:bg-hover",
                off && "cursor-not-allowed opacity-55",
              )}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={on}
                disabled={off}
                onChange={() => toggle(t.slug)}
              />
              {on ? <Check size={12} strokeWidth={3} className="text-accent" aria-hidden /> : null}
              {t.title}
            </label>
          );
        })}
        {shown.length === 0 && unknown.length === 0 ? (
          <p className="text-[13px] text-muted">Nothing matches.</p>
        ) : null}
      </div>
    </fieldset>
  );
}
