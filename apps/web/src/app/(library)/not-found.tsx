import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-5 py-24 text-center">
      <p className="text-sm font-medium text-muted">404</p>
      <h1 className="mt-2 text-2xl font-semibold text-ink">This page does not exist</h1>
      <p className="mt-2 text-[15px] text-muted">
        The note may have been removed, or you may not have access to it.
      </p>
      <Link
        href="/"
        className="mt-6 inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:brightness-110"
      >
        Back to Home
      </Link>
    </div>
  );
}
