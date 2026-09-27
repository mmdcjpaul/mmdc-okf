import Link from "next/link";
import type { GardenerRunRow } from "@lore/db";
import type { GardenerView, NoteRef } from "@/lib/gardener";
import { plural, timeAgo } from "@/lib/format";
import { noteHref, termHref } from "@/lib/urls";

const NoteLink = ({ note }: { note: NoteRef }) => (
  <Link href={noteHref(note)} className="font-medium text-ink hover:underline">
    {note.title}
  </Link>
);

function Finding({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div>
      <h3 className="mb-1 text-[13.5px] font-semibold text-ink">
        {title} <span className="font-normal tabular-nums text-muted">{count}</span>
      </h3>
      <ul className="space-y-1 text-[13.5px] text-ink-2">{children}</ul>
    </div>
  );
}

/** What the last Gardener run found, as far as the reader may see it. */
export function GardenerPanel({
  run,
  view,
  proposals,
}: {
  run: GardenerRunRow;
  view: GardenerView;
  /** How many of the run's proposals the reader can open. */
  proposals: { id: string; title: string; state: string }[];
}) {
  const drift = view.drift;
  const nothing =
    view.duplicates.length +
      view.orphans.length +
      view.wanted.length +
      view.reported.length +
      view.gaps.length +
      drift.nearDuplicateTerms.length +
      drift.tagsUsedOnce.length +
      drift.smallThemes.length +
      drift.hubsWithoutDescription.length ===
    0;
  return (
    <div className="rounded-lg border border-line p-4">
      <p className="text-[13px] text-muted">
        Last run {timeAgo(run.finishedAt ?? run.startedAt)}
        {run.namespace ? ` for ${run.namespace}` : " for the whole vault"}. It looked at{" "}
        {plural(view.notes, "note")}
        {run.proposals.length
          ? ` and made ${plural(run.proposals.length, "proposal")}.`
          : " and proposed nothing new."}
      </p>
      {proposals.length ? (
        <ul className="mt-2 space-y-1 text-[13.5px]" aria-label="Proposals">
          {proposals.map((p) => (
            <li key={p.id}>
              <Link href={`/changes/${p.id}`} className="text-accent hover:underline">
                {p.title}
              </Link>
              <span className="ml-2 text-[12.5px] text-muted">
                {p.state === "in_review"
                  ? "waiting for review"
                  : p.state === "committed"
                    ? "published"
                    : p.state === "rejected"
                      ? "turned down"
                      : "being prepared"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {nothing ? (
        <p className="mt-3 text-[13.5px] text-ink-2">It found nothing that needs attention.</p>
      ) : (
        <div className="mt-4 grid gap-x-8 gap-y-5 md:grid-cols-2">
          <Finding title="Probably the same note" count={view.duplicates.length}>
            {view.duplicates.map((d) => (
              <li key={d.keep.id}>
                <NoteLink note={d.keep} /> and{" "}
                {d.others.map((o, i) => (
                  <span key={o.id}>
                    {i ? ", " : ""}
                    <NoteLink note={o} />
                  </span>
                ))}
                <span className="ml-1 text-[12.5px] text-muted">
                  {Math.round(d.score * 100)}% similar
                </span>
              </li>
            ))}
          </Finding>
          <Finding title="Nothing links to or from these" count={view.orphans.length}>
            {view.orphans.map((n) => (
              <li key={n.id}>
                <NoteLink note={n} />
              </li>
            ))}
          </Finding>
          <Finding title="Linked to, but not written yet" count={view.wanted.length}>
            {view.wanted.map((w) => (
              <li key={w.path}>
                <span className="font-mono text-[12.5px] text-ink">{w.path}</span>
                <span className="ml-1 text-muted">
                  wanted by{" "}
                  {w.wantedBy.map((n, i) => (
                    <span key={n.id}>
                      {i ? ", " : ""}
                      <NoteLink note={n} />
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </Finding>
          <Finding title="Reported more than once" count={view.reported.length}>
            {view.reported.map((n) => (
              <li key={n.id}>
                <NoteLink note={n} />{" "}
                <span className="text-[12.5px] text-muted">{plural(n.reports, "open report")}</span>
              </li>
            ))}
          </Finding>
          <Finding title="Terms that look the same" count={drift.nearDuplicateTerms.length}>
            {drift.nearDuplicateTerms.map((t) => (
              <li key={`${t.keep.kind}:${t.keep.slug}:${t.other.slug}`}>
                {t.keep.kind} <span className="font-mono text-[12.5px]">{t.other.slug}</span> and{" "}
                <span className="font-mono text-[12.5px]">{t.keep.slug}</span>
              </li>
            ))}
          </Finding>
          <Finding title="Tags used by one note" count={drift.tagsUsedOnce.length}>
            {drift.tagsUsedOnce.map((t) => (
              <li key={t.slug}>
                <Link
                  href={termHref("tag", t.slug)}
                  className="font-mono text-[12.5px] text-ink hover:underline"
                >
                  {t.slug}
                </Link>
              </li>
            ))}
          </Finding>
          <Finding title="Themes small enough to be tags" count={drift.smallThemes.length}>
            {drift.smallThemes.map((t) => (
              <li key={t.slug}>
                <Link
                  href={termHref("theme", t.slug)}
                  className="font-mono text-[12.5px] text-ink hover:underline"
                >
                  {t.slug}
                </Link>{" "}
                <span className="text-[12.5px] text-muted">{plural(t.notes, "note")}</span>
              </li>
            ))}
          </Finding>
          <Finding title="Hubs without a description" count={drift.hubsWithoutDescription.length}>
            {drift.hubsWithoutDescription.map((t) => (
              <li key={`${t.kind}:${t.slug}`}>
                <Link
                  href={termHref(t.kind, t.slug)}
                  className="font-mono text-[12.5px] text-ink hover:underline"
                >
                  {t.slug}
                </Link>
              </li>
            ))}
          </Finding>
          <Finding title="Questions that found nothing" count={view.gaps.length}>
            {view.gaps.map((g) => (
              <li key={g.question}>
                {g.question}{" "}
                <span className="text-[12.5px] text-muted">asked {plural(g.count, "time")}</span>
              </li>
            ))}
          </Finding>
        </div>
      )}
    </div>
  );
}
