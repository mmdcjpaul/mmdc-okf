import Link from "next/link";

export default function Forbidden() {
  return (
    <div className="mx-auto max-w-[560px] px-5 py-24 text-center">
      <p className="text-[13px] font-semibold uppercase tracking-wide text-faint">403</p>
      <h1 className="mt-2 text-[24px] font-semibold text-ink">This page is for admins</h1>
      <p className="mt-2 text-[15px] text-muted">
        Ask an admin if you need something changed here.
      </p>
      <p className="mt-6">
        <Link href="/" className="text-[14px] font-medium text-accent hover:underline">
          Back to the Library
        </Link>
      </p>
    </div>
  );
}
