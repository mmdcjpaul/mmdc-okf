import { LogOut, Users } from "lucide-react";
import Link from "next/link";
import { signOut } from "@/app/login/actions";

interface UserMenuProps {
  name: string;
  email: string;
  role: string;
  devLogin: boolean;
}

export function UserMenu({ name, email, role, devLogin }: UserMenuProps) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
      <span
        aria-hidden
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent"
      >
        {initials}
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-[13px] font-medium text-ink">{name}</p>
        <p className="truncate text-[11.5px] text-faint" title={email}>
          {role === "member" ? email : `${role} · ${email}`}
        </p>
      </div>
      {devLogin ? (
        <Link
          href="/login"
          title="Switch user"
          aria-label="Switch user"
          className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-ink"
        >
          <Users size={15} aria-hidden />
        </Link>
      ) : null}
      <form action={signOut}>
        <button
          type="submit"
          title="Sign out"
          aria-label="Sign out"
          className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-ink"
        >
          <LogOut size={15} aria-hidden />
        </button>
      </form>
    </div>
  );
}
