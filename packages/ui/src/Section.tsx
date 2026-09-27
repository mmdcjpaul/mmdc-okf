import { useId, type ReactNode } from "react";

interface SectionProps {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}

export function Section({ title, action, children }: SectionProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="mb-10">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id={headingId} className="text-[13px] font-semibold uppercase tracking-wide text-faint">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
