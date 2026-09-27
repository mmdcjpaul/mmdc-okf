import { useId, type ReactNode } from "react";

interface PanelSectionProps {
  title: string;
  count?: number;
  children: ReactNode;
}

/** A titled block in the note page's side panel. */
export function PanelSection({ title, count, children }: PanelSectionProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="border-t border-line-2 py-5 first:border-t-0 first:pt-0"
    >
      <h2
        id={headingId}
        className="mb-2.5 flex items-baseline gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-faint"
      >
        {title}
        {count !== undefined ? <span className="font-normal tabular-nums">{count}</span> : null}
      </h2>
      {children}
    </section>
  );
}
