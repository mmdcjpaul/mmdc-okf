"use client";

import {
  Bell,
  ClipboardCheck,
  FilePen,
  FileUp,
  FolderClosed,
  Hash,
  HeartPulse,
  Home,
  Layers,
  Lock,
  NotebookPen,
  Plus,
  Search,
  Server,
  Settings,
  Shapes,
  Tags,
  Waypoints,
} from "lucide-react";
import Link from "next/link";
import { NavLink } from "./NavLink";
import { useCommandPalette } from "./CommandPaletteProvider";

export interface SidebarNamespace {
  slug: string;
  title: string;
  count: number;
  restricted: boolean;
}

export interface SidebarCounts {
  /** Changesets waiting for this person's decision. Null hides Review: they approve nothing. */
  review: number | null;
  unread: number;
  /** Their own changes that came back to them. */
  mine: number;
  /** Whether to show Admin. */
  admin: boolean;
  /** Proposed terms waiting for a decision. Null hides Taxonomy: they maintain nothing. */
  taxonomy: number | null;
  /** Features admins can switch off. */
  capture: boolean;
  graph: boolean;
}

interface SidebarNavProps {
  namespaces: SidebarNamespace[];
  counts: SidebarCounts;
  onNavigate?: () => void;
}

const ICON = 16;

export function SidebarNav({ namespaces, counts, onNavigate }: SidebarNavProps) {
  const palette = useCommandPalette();

  function openSearch() {
    onNavigate?.();
    palette.open();
  }

  return (
    <nav aria-label="Library" className="flex flex-col gap-5">
      <button
        type="button"
        onClick={openSearch}
        className="flex h-8 w-full items-center gap-2 rounded-md border border-line bg-paper px-2 text-left text-[13px] text-muted shadow-[0_1px_0_rgba(0,0,0,0.02)] transition-colors hover:border-faint/60 hover:text-ink-2"
      >
        <Search size={14} aria-hidden />
        <span className="flex-1">Search</span>
        <kbd className="rounded border border-line px-1 font-sans text-[10.5px] text-faint">⌘K</kbd>
      </button>

      <Link
        href="/new"
        onClick={onNavigate}
        className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-accent text-[13px] font-medium text-accent-ink hover:brightness-110"
      >
        <Plus size={15} aria-hidden />
        New note
      </Link>

      <div className="flex flex-col gap-0.5">
        <NavLink href="/" exact icon={<Home size={ICON} aria-hidden />} onNavigate={onNavigate}>
          Home
        </NavLink>
        <NavLink href="/search" icon={<Search size={ICON} aria-hidden />} onNavigate={onNavigate}>
          Search
        </NavLink>
        <NavLink
          href="/notifications"
          icon={<Bell size={ICON} aria-hidden />}
          count={counts.unread || undefined}
          onNavigate={onNavigate}
        >
          Notifications
        </NavLink>
        <NavLink href="/upload" icon={<FileUp size={ICON} aria-hidden />} onNavigate={onNavigate}>
          Upload
        </NavLink>
        {counts.capture ? (
          <NavLink
            href="/capture"
            icon={<NotebookPen size={ICON} aria-hidden />}
            onNavigate={onNavigate}
          >
            Capture
          </NavLink>
        ) : null}
        <NavLink
          href="/changes"
          icon={<FilePen size={ICON} aria-hidden />}
          count={counts.mine || undefined}
          onNavigate={onNavigate}
        >
          My changes
        </NavLink>
        {counts.admin ? (
          <NavLink
            href="/admin"
            icon={<Settings size={ICON} aria-hidden />}
            onNavigate={onNavigate}
          >
            Admin
          </NavLink>
        ) : null}
        {counts.review === null ? null : (
          <NavLink
            href="/review"
            icon={<ClipboardCheck size={ICON} aria-hidden />}
            count={counts.review || undefined}
            onNavigate={onNavigate}
          >
            Review
          </NavLink>
        )}
      </div>

      <div className="flex flex-col gap-0.5">
        <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">
          Browse
        </p>
        <NavLink href="/themes" icon={<Layers size={ICON} aria-hidden />} onNavigate={onNavigate}>
          Themes
        </NavLink>
        <NavLink href="/systems" icon={<Server size={ICON} aria-hidden />} onNavigate={onNavigate}>
          Systems
        </NavLink>
        <NavLink href="/types" icon={<Shapes size={ICON} aria-hidden />} onNavigate={onNavigate}>
          Types
        </NavLink>
        <NavLink href="/tags" icon={<Hash size={ICON} aria-hidden />} onNavigate={onNavigate}>
          Tags
        </NavLink>
        {counts.graph ? (
          <NavLink
            href="/graph"
            icon={<Waypoints size={ICON} aria-hidden />}
            onNavigate={onNavigate}
          >
            Graph
          </NavLink>
        ) : null}
        {counts.taxonomy === null ? null : (
          <NavLink
            href="/taxonomy"
            icon={<Tags size={ICON} aria-hidden />}
            count={counts.taxonomy || undefined}
            onNavigate={onNavigate}
          >
            Taxonomy
          </NavLink>
        )}
        <NavLink
          href="/hygiene"
          icon={<HeartPulse size={ICON} aria-hidden />}
          onNavigate={onNavigate}
        >
          Hygiene
        </NavLink>
      </div>

      <div className="flex flex-col gap-0.5">
        <NavLink href="/ns" exact onNavigate={onNavigate}>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-faint">
            Namespaces
          </span>
        </NavLink>
        {namespaces.map((ns) => (
          <NavLink
            key={ns.slug}
            href={`/ns/${ns.slug}`}
            count={ns.count}
            icon={
              ns.restricted ? (
                <Lock size={ICON} aria-label="Restricted" />
              ) : (
                <FolderClosed size={ICON} aria-hidden />
              )
            }
            onNavigate={onNavigate}
          >
            {ns.title}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
