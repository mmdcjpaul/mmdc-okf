"use client";

import { Menu, Search, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useCommandPalette } from "./CommandPaletteProvider";
import { SidebarNav, type SidebarNamespace } from "./SidebarNav";

interface MobileNavProps {
  brand: ReactNode;
  namespaces: SidebarNamespace[];
  footer: ReactNode;
}

/** Top bar and slide-out navigation below the `md` breakpoint. */
export function MobileNav({ brand, namespaces, footer }: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const palette = useCommandPalette();

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    panelRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      trigger?.focus();
    };
  }, [open]);

  function close() {
    setOpen(false);
  }

  return (
    <>
      <div className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-line bg-bg/90 px-3 backdrop-blur md:hidden">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          aria-expanded={open}
          className="flex size-9 items-center justify-center rounded-md text-ink-2 hover:bg-hover"
        >
          <Menu size={18} aria-hidden />
        </button>
        <div className="min-w-0 flex-1">{brand}</div>
        <button
          type="button"
          onClick={palette.open}
          aria-label="Search"
          className="flex size-9 items-center justify-center rounded-md text-ink-2 hover:bg-hover"
        >
          <Search size={18} aria-hidden />
        </button>
      </div>

      {open ? (
        <div
          className="fixed inset-0 z-40 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/30"
            onClick={close}
          />
          <div
            ref={panelRef}
            className="absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col overflow-y-auto bg-bg px-3 py-3 shadow-xl"
          >
            <div className="mb-4 flex items-center justify-between gap-2 pl-2">
              {brand}
              <button
                type="button"
                onClick={close}
                aria-label="Close navigation"
                className="flex size-8 items-center justify-center rounded-md hover:bg-hover"
              >
                <X size={17} aria-hidden />
              </button>
            </div>
            <SidebarNav namespaces={namespaces} onNavigate={close} />
            <div className="mt-auto pt-6">{footer}</div>
          </div>
        </div>
      ) : null}
    </>
  );
}
