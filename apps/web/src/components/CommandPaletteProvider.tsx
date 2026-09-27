"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { CommandPalette } from "./CommandPalette";

interface PaletteApi {
  open: () => void;
}

const PaletteContext = createContext<PaletteApi | null>(null);

export function useCommandPalette(): PaletteApi {
  const ctx = useContext(PaletteContext);
  if (!ctx) throw new Error("useCommandPalette must be used inside CommandPaletteProvider");
  return ctx;
}

/** Owns the Cmd-K palette so any part of the page can open it. */
export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const open = useCallback(() => setOpen(true), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "/" && !isTyping(e.target)) {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const api = useMemo(() => ({ open }), [open]);
  return (
    <PaletteContext.Provider value={api}>
      {children}
      <CommandPalette open={isOpen} onOpenChange={setOpen} />
    </PaletteContext.Provider>
  );
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}
