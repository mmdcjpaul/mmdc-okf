"use client";

export default function LibraryError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg px-5 py-24 text-center">
      <h1 className="text-2xl font-semibold text-ink">Something went wrong</h1>
      <p className="mt-2 text-[15px] text-muted">
        The Library could not load this page. The database or search service may be down.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:brightness-110"
      >
        Try again
      </button>
    </div>
  );
}
