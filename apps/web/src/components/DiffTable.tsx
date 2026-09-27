import type { DiffLine, NoteDiff } from "@/lib/diff";
import { plural } from "@/lib/format";

const LINE_STYLE: Record<DiffLine["kind"], string> = {
  same: "text-ink-2",
  add: "bg-ok-soft text-ink",
  remove: "bg-bad-soft text-ink",
};
const MARK: Record<DiffLine["kind"], string> = { same: " ", add: "+", remove: "-" };
const SPOKEN: Record<DiffLine["kind"], string> = { same: "", add: "Added: ", remove: "Removed: " };

/** A line diff with line numbers, readable by screen readers as added and removed lines. */
export function DiffTable({ diff, label }: { diff: NoteDiff; label: string }) {
  return (
    <div
      role="table"
      aria-label={label}
      className="overflow-x-auto rounded-lg border border-line font-mono text-[12.5px] leading-[1.55]"
    >
      {diff.hunks.map((hunk, i) => (
        <div key={i} role="rowgroup">
          {hunk.skipped ? <Skipped count={hunk.skipped} /> : null}
          {hunk.lines.map((l, j) => (
            <Line key={j} line={l} />
          ))}
        </div>
      ))}
      {diff.trailing ? (
        <div role="rowgroup">
          <Skipped count={diff.trailing} />
        </div>
      ) : null}
    </div>
  );
}

export function DiffSummary({ diff }: { diff: NoteDiff }) {
  return (
    <p className="text-[13px] text-muted">
      <span className="font-medium text-ok">{plural(diff.added, "line")} added</span>
      {" · "}
      <span className="font-medium text-bad">{plural(diff.removed, "line")} removed</span>
    </p>
  );
}

function Skipped({ count }: { count: number }) {
  return (
    <div role="row" className="border-y border-line bg-bg px-3 py-1 text-[11.5px] text-faint">
      <span role="cell">{plural(count, "unchanged line")}</span>
    </div>
  );
}

function Line({ line }: { line: DiffLine }) {
  return (
    <div role="row" className={`flex min-w-max ${LINE_STYLE[line.kind]}`}>
      <span
        role="cell"
        aria-hidden
        className="w-10 shrink-0 select-none px-2 text-right text-faint"
      >
        {line.before ?? ""}
      </span>
      <span
        role="cell"
        aria-hidden
        className="w-10 shrink-0 select-none px-2 text-right text-faint"
      >
        {line.after ?? ""}
      </span>
      <span role="cell" aria-hidden className="w-5 shrink-0 select-none text-center text-muted">
        {MARK[line.kind]}
      </span>
      <span role="cell" className="whitespace-pre pr-4">
        <span className="sr-only">{SPOKEN[line.kind]}</span>
        {line.text || " "}
      </span>
    </div>
  );
}
