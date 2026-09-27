import type { ReactNode } from "react";

interface PageHeaderProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}

export function PageHeader({ eyebrow, title, description, actions, children }: PageHeaderProps) {
  return (
    <header className="mb-8">
      {eyebrow ? (
        <div className="mb-2 flex flex-wrap items-center gap-1 text-[13px] text-muted">
          {eyebrow}
        </div>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="min-w-0 text-[26px] font-semibold leading-tight tracking-[-0.015em] text-ink">
          {title}
        </h1>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {description ? (
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted">{description}</p>
      ) : null}
      {children}
    </header>
  );
}
