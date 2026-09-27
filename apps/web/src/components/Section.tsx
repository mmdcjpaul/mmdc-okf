import type { ReactNode } from "react";

interface SectionProps {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}

export function Section({ title, action, children }: SectionProps) {
  return (
    <section className="mb-10">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-faint">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
