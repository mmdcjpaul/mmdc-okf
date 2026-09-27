"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { noteHref } from "@/lib/urls";

type NodeTuple = [id: string, slug: string, title: string, type: string, ns: string, theme: string];
interface Payload {
  nodes: NodeTuple[];
  edges: [number, number][];
  namespaces: { slug: string; title: string }[];
  themes: { slug: string; title: string }[];
}
type ColorBy = "namespace" | "theme";
type State = "loading" | "layout" | "ready" | "empty" | "failed";

/** Twelve colours that stay apart for most kinds of colour vision, on light and dark. */
const PALETTE = [
  "#4b50d8",
  "#1f8a5b",
  "#d9730d",
  "#c2366b",
  "#2f8f9d",
  "#8a5cd6",
  "#a3841a",
  "#d1453b",
  "#3b82c4",
  "#5f8f2f",
  "#b05a9c",
  "#6b7280",
];
const OTHER = "#9a9aa2";

/** A steady pseudo-random number from a string, so the first layout is the same each time. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

interface Live {
  setColorBy(by: ColorBy): void;
  setFilter(f: { ns: string; theme: string; type: string }): number;
  focus(id: string): void;
  toggleLayout(): boolean;
  kill(): void;
}

export function GlobalGraph() {
  const router = useRouter();
  const uid = useId();
  const container = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const live = useRef<Live | null>(null);
  const [data, setData] = useState<Payload | null>(null);
  const [state, setState] = useState<State>("loading");
  const [colorBy, setColorBy] = useState<ColorBy>("namespace");
  const [filter, setFilter] = useState({ ns: "", theme: "", type: "" });
  const [shown, setShown] = useState(0);
  const [running, setRunning] = useState(false);
  const [find, setFind] = useState("");

  useEffect(() => {
    let gone = false;
    fetch("/api/graph")
      .then((r) => (r.ok ? (r.json() as Promise<Payload>) : Promise.reject(new Error("failed"))))
      .then((d) => {
        if (gone) return;
        setData(d);
        setShown(d.nodes.length);
        if (d.nodes.length === 0) setState("empty");
      })
      .catch(() => !gone && setState("failed"));
    return () => {
      gone = true;
    };
  }, []);

  const colors = useMemo(() => {
    const of = (keys: string[]) =>
      new Map(keys.map((k, i) => [k, i < PALETTE.length ? PALETTE[i]! : OTHER]));
    if (!data) return { namespace: new Map<string, string>(), theme: new Map<string, string>() };
    const count = new Map<string, number>();
    for (const n of data.nodes) if (n[5]) count.set(n[5], (count.get(n[5]) ?? 0) + 1);
    return {
      namespace: of(data.namespaces.map((n) => n.slug)),
      // The largest themes get the colours; the rest share grey.
      theme: of([...count.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)),
    };
  }, [data]);

  const titles = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of data?.namespaces ?? []) m.set(`namespace:${n.slug}`, n.title);
    for (const t of data?.themes ?? []) m.set(`theme:${t.slug}`, t.title);
    return m;
  }, [data]);

  const degree = useMemo(() => {
    const d = new Array<number>(data?.nodes.length ?? 0).fill(0);
    for (const [s, t] of data?.edges ?? []) {
      d[s]! += 1;
      d[t]! += 1;
    }
    return d;
  }, [data]);

  useEffect(() => {
    const el = container.current;
    const overlay = labels.current;
    if (!el || !overlay || !data || data.nodes.length === 0) return;
    let killed = false;
    let cleanup = () => {};

    void (async () => {
      try {
        const [{ default: Graph }, { default: Sigma }, { default: FA2 }, fa2] = await Promise.all([
          import("graphology"),
          import("sigma"),
          import("graphology-layout-forceatlas2/worker"),
          import("graphology-layout-forceatlas2"),
        ]);
        if (killed) return;
        const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        const g = new Graph({ multi: false, type: "undirected" });
        // Each namespace starts in its own part of the plane, so the layout has less to do.
        const centres = new Map(
          data.namespaces.map((n, i) => {
            const a = (2 * Math.PI * i) / Math.max(1, data.namespaces.length);
            return [n.slug, { x: Math.cos(a) * 100, y: Math.sin(a) * 100 }];
          }),
        );
        const spread = 20 + Math.sqrt(data.nodes.length);
        let by: ColorBy = "namespace";
        const colorOf = (n: NodeTuple) =>
          (by === "namespace" ? colors.namespace.get(n[4]) : colors.theme.get(n[5])) ?? OTHER;
        const big = data.nodes.length > 3000;
        // A large graph is arranged on a copy that is not drawn, and the drawing catches up
        // now and then. Arranging the drawn graph would redraw 20,000 notes many times a second.
        const arranged = big ? new Graph({ multi: false, type: "undirected" }) : g;
        const pause = () => new Promise<void>((r) => setTimeout(r));
        const edgeColor = dark ? "#34343b" : "#dedcd6";
        const sigma = new Sigma(g, el, {
          renderLabels: true,
          labelSize: 11,
          labelColor: { color: dark ? "#cfcfd4" : "#3d3d42" },
          labelDensity: 0.5,
          labelRenderedSizeThreshold: big ? 9 : 6,
          // Edges are not drawn while the view moves, which keeps large graphs smooth.
          hideEdgesOnMove: big,
          zIndex: true,
        });
        // The renderer starts on an empty graph: setting it up is work of its own, and the
        // notes then appear a slice at a time.
        await new Promise<void>((done) => {
          sigma.once("afterRender", () => done());
          setTimeout(done, 1000);
        });
        if (killed) {
          sigma.kill();
          return;
        }
        cleanup = () => sigma.kill();
        // Built in slices, so the page can answer in between.
        for (let i = 0; i < data.nodes.length; i++) {
          const n = data.nodes[i]!;
          const c = centres.get(n[4]) ?? { x: 0, y: 0 };
          const r = Math.sqrt(hash(n[0])) * spread;
          const a = hash(n[0] + "a") * 2 * Math.PI;
          const at = { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r };
          g.addNode(String(i), {
            ...at,
            size: 2 + Math.min(10, Math.sqrt(degree[i] ?? 0) * 1.6),
            label: n[2],
            color: colorOf(n),
          });
          if (big) arranged.addNode(String(i), at);
          if (i % 2000 === 1999) {
            await pause();
            if (killed) return;
          }
        }
        for (let i = 0; i < data.edges.length; i++) {
          const [s, t] = data.edges[i]!;
          if (s !== t && !arranged.hasEdge(String(s), String(t))) {
            // A large graph is drawn without its links, which at that size are a grey
            // cloud. The links of the note under the pointer are drawn when it is pointed at.
            if (big) arranged.addEdge(String(s), String(t));
            else g.addEdge(String(s), String(t), { size: 0.5, color: edgeColor });
          }
          if (i % 3000 === 2999) {
            await pause();
            if (killed) return;
          }
        }
        const layout = new FA2(arranged, {
          settings: {
            ...fa2.inferSettings(arranged),
            barnesHutOptimize: data.nodes.length > 1000,
            gravity: 0.6,
            scalingRatio: 8,
            slowDown: 4 + Math.log(data.nodes.length + 1),
          },
        });
        // The layout runs in a web worker, so the page stays responsive while it settles.
        let timer: ReturnType<typeof setTimeout> | null = null;
        let catchUp: ReturnType<typeof setInterval> | null = null;
        let centroids: [string, { x: number; y: number }][] = [];
        const sync = () => {
          if (big)
            g.updateEachNodeAttributes(
              (key, attrs) => {
                const at = arranged.getNodeAttributes(key);
                attrs.x = at.x;
                attrs.y = at.y;
                return attrs;
              },
              { attributes: ["x", "y"] },
            );
          measure();
        };
        const stop = () => {
          if (timer) clearTimeout(timer);
          if (catchUp) clearInterval(catchUp);
          timer = catchUp = null;
          layout.stop();
          sync();
          sigma.refresh();
          setRunning(false);
          setState("ready");
        };
        const start = () => {
          layout.start();
          catchUp = setInterval(sync, big ? 2000 : 1000);
          setRunning(true);
          setState("layout");
          timer = setTimeout(stop, Math.min(20_000, 2500 + data.nodes.length));
        };

        // Cluster labels: the name of each colour, at the middle of its visible notes.
        let visible = new Set<string>(data.nodes.map((_, i) => String(i)));
        // The middle of each colour's visible notes. Worked out when notes move or the
        // filter changes, not on every frame.
        const measure = () => {
          const sums = new Map<string, { x: number; y: number; n: number }>();
          g.forEachNode((key, a) => {
            if (!visible.has(key)) return;
            const n = data.nodes[Number(key)]!;
            const k = by === "namespace" ? n[4] : n[5];
            if (!k) return;
            const s = sums.get(k) ?? { x: 0, y: 0, n: 0 };
            s.x += a.x as number;
            s.y += a.y as number;
            s.n += 1;
            sums.set(k, s);
          });
          centroids = [...sums.entries()]
            .sort((p, q) => q[1].n - p[1].n)
            .slice(0, PALETTE.length)
            .map(([k, s]) => [k, { x: s.x / s.n, y: s.y / s.n }]);
        };
        const place = () => {
          overlay.replaceChildren(
            ...centroids.map(([k, c]) => {
              const at = sigma.graphToViewport(c);
              const tag = document.createElement("span");
              tag.textContent = titles.get(`${by}:${k}`) ?? k;
              tag.className =
                "absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded bg-paper/80 px-1.5 py-0.5 text-[12px] font-semibold text-ink shadow-sm";
              tag.style.left = `${at.x}px`;
              tag.style.top = `${at.y}px`;
              return tag;
            }),
          );
        };
        sigma.on("afterRender", place);

        sigma.on("clickNode", ({ node }) => {
          const n = data.nodes[Number(node)]!;
          router.push(noteHref({ id: n[0], slug: n[1] }));
        });
        const shown: string[] = [];
        const hideLinks = () => {
          for (const e of shown.splice(0)) if (g.hasEdge(e)) g.dropEdge(e);
        };
        const showLinks = (node: string) => {
          if (!big) return;
          hideLinks();
          arranged.forEachNeighbor(node, (other) => {
            if (visible.has(other) && !g.hasEdge(node, other))
              shown.push(g.addEdge(node, other, { size: 1, color: dark ? "#8b8ff5" : "#4b50d8" }));
          });
        };
        sigma.on("enterNode", ({ node }) => {
          el.style.cursor = "pointer";
          showLinks(node);
        });
        sigma.on("leaveNode", () => {
          el.style.cursor = "default";
          if (!focused) hideLinks();
          else showLinks(focused);
        });

        let focused: string | null = null;
        sigma.setSetting("nodeReducer", (key, attrs) => {
          if (!visible.has(key)) return { ...attrs, hidden: true };
          if (key === focused)
            return { ...attrs, size: 14, zIndex: 2, forceLabel: true, highlighted: true };
          return attrs;
        });
        sigma.setSetting("edgeReducer", (edge, attrs) => {
          const [s, t] = g.extremities(edge);
          return visible.has(s) && visible.has(t) ? attrs : { ...attrs, hidden: true };
        });

        live.current = {
          setColorBy(next) {
            if (by === next) return;
            by = next;
            g.updateEachNodeAttributes(
              (key, attrs) => {
                attrs.color = colorOf(data.nodes[Number(key)]!);
                return attrs;
              },
              { attributes: ["color"] },
            );
            measure();
          },
          setFilter(f) {
            visible = new Set(
              g.filterNodes((key) => {
                const n = data.nodes[Number(key)]!;
                return (
                  (!f.ns || n[4] === f.ns) &&
                  (!f.theme || n[5] === f.theme) &&
                  (!f.type || n[3] === f.type)
                );
              }),
            );
            measure();
            sigma.refresh();
            return visible.size;
          },
          focus(id) {
            const i = data.nodes.findIndex((n) => n[0] === id);
            if (i < 0) return;
            focused = String(i);
            showLinks(focused);
            const at = sigma.getNodeDisplayData(focused);
            if (at)
              void sigma.getCamera().animate({ x: at.x, y: at.y, ratio: 0.15 }, { duration: 500 });
            sigma.refresh();
          },
          toggleLayout() {
            if (layout.isRunning()) {
              stop();
              return false;
            }
            start();
            return true;
          },
          kill() {
            if (timer) clearTimeout(timer);
            if (catchUp) clearInterval(catchUp);
            layout.kill();
            sigma.kill();
            overlay.replaceChildren();
          },
        };
        cleanup = () => live.current?.kill();
        measure();
        await pause();
        if (!killed) start();
      } catch {
        setState("failed");
      }
    })();

    return () => {
      killed = true;
      cleanup();
      live.current = null;
    };
  }, [data, colors, titles, degree, router]);

  useEffect(() => {
    live.current?.setColorBy(colorBy);
  }, [colorBy, state]);
  const applied = useRef(filter);
  useEffect(() => {
    if (!live.current || applied.current === filter) return;
    applied.current = filter;
    setShown(live.current.setFilter(filter));
  }, [filter, state]);

  const types = useMemo(() => [...new Set(data?.nodes.map((n) => n[3]) ?? [])].sort(), [data]);
  const matches = useMemo(() => {
    const q = find.trim().toLowerCase();
    if (!data || q.length < 2) return [];
    return data.nodes.filter((n) => n[2].toLowerCase().includes(q)).slice(0, 8);
  }, [data, find]);
  const mostLinked = useMemo(() => {
    if (!data) return [];
    return data.nodes
      .map((n, i) => ({ n, links: degree[i] ?? 0 }))
      .filter((x) => x.links > 0)
      .sort((a, b) => b.links - a.links || (a.n[2] < b.n[2] ? -1 : 1))
      .slice(0, 20);
  }, [data, degree]);

  const legend = colorBy === "namespace" ? (data?.namespaces ?? []) : (data?.themes ?? []);
  const field = "h-9 rounded-md border border-line bg-paper px-2.5 text-[13.5px] text-ink";
  const label = "block text-[13px] font-medium text-ink";

  if (state === "failed")
    return <p className="text-[14px] text-muted">The graph could not be loaded. Try again.</p>;
  if (state === "empty")
    return <p className="text-[14px] text-muted">There are no notes to show yet.</p>;

  return (
    <div data-state={state} data-testid="global-graph">
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={`${uid}-color`} className={label}>
            Colour by
          </label>
          <select
            id={`${uid}-color`}
            value={colorBy}
            onChange={(e) => setColorBy(e.target.value as ColorBy)}
            className={`${field} mt-1 block`}
          >
            <option value="namespace">Namespace</option>
            <option value="theme">Theme</option>
          </select>
        </div>
        <div>
          <label htmlFor={`${uid}-ns`} className={label}>
            Namespace
          </label>
          <select
            id={`${uid}-ns`}
            value={filter.ns}
            onChange={(e) => setFilter({ ...filter, ns: e.target.value })}
            className={`${field} mt-1 block`}
          >
            <option value="">All</option>
            {data?.namespaces.map((n) => (
              <option key={n.slug} value={n.slug}>
                {n.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${uid}-theme`} className={label}>
            Theme
          </label>
          <select
            id={`${uid}-theme`}
            value={filter.theme}
            onChange={(e) => setFilter({ ...filter, theme: e.target.value })}
            className={`${field} mt-1 block`}
          >
            <option value="">All</option>
            {data?.themes.map((t) => (
              <option key={t.slug} value={t.slug}>
                {t.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${uid}-type`} className={label}>
            Type
          </label>
          <select
            id={`${uid}-type`}
            value={filter.type}
            onChange={(e) => setFilter({ ...filter, type: e.target.value })}
            className={`${field} mt-1 block`}
          >
            <option value="">All</option>
            {types.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="relative">
          <label htmlFor={`${uid}-find`} className={label}>
            Find a note
          </label>
          <input
            id={`${uid}-find`}
            value={find}
            onChange={(e) => setFind(e.target.value)}
            className={`${field} mt-1 block w-56`}
            autoComplete="off"
          />
          {matches.length ? (
            <ul className="absolute left-0 top-full z-10 mt-1 w-72 rounded-md border border-line bg-paper py-1 shadow-lg">
              {matches.map((n) => (
                <li key={n[0]}>
                  <button
                    type="button"
                    className="block w-full truncate px-3 py-1.5 text-left text-[13.5px] text-ink hover:bg-hover"
                    onClick={() => {
                      live.current?.focus(n[0]);
                      setFind("");
                    }}
                  >
                    {n[2]}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <button
          type="button"
          disabled={state === "loading"}
          onClick={() => live.current?.toggleLayout()}
          className="h-9 rounded-md border border-line bg-paper px-3 text-[13.5px] font-medium text-ink-2 hover:bg-hover disabled:opacity-50"
        >
          {running ? "Stop arranging" : "Arrange again"}
        </button>
      </div>

      <p role="status" className="mb-2 text-[13px] text-muted">
        {state === "loading"
          ? "Loading…"
          : `${shown.toLocaleString("en")} of ${(data?.nodes.length ?? 0).toLocaleString("en")} notes, ${(data?.edges.length ?? 0).toLocaleString("en")} links.${running ? " Arranging…" : ""}`}
      </p>

      <div className="relative h-[68vh] min-h-[420px] overflow-hidden rounded-lg border border-line bg-bg">
        <div
          ref={container}
          className="absolute inset-0"
          role="img"
          aria-label={`Graph of ${data?.nodes.length ?? 0} notes. The most linked notes are listed below.`}
        />
        <div ref={labels} className="pointer-events-none absolute inset-0" aria-hidden />
      </div>

      <ul
        className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-ink-2"
        aria-label="Colours"
      >
        {legend.slice(0, PALETTE.length).map((k) => (
          <li key={k.slug} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-3 rounded-full"
              style={{ background: colors[colorBy].get(k.slug) ?? OTHER }}
            />
            {k.title}
          </li>
        ))}
        {legend.length > PALETTE.length ? (
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="size-3 rounded-full" style={{ background: OTHER }} />
            Others
          </li>
        ) : null}
      </ul>

      <section aria-label="Most linked notes" className="mt-8">
        <h2 className="mb-2 text-[15px] font-semibold text-ink">Most linked notes</h2>
        {mostLinked.length === 0 ? (
          <p className="text-[13.5px] text-muted">
            {state === "loading" ? "Loading…" : "No notes link to each other yet."}
          </p>
        ) : (
          <ol className="grid gap-x-8 gap-y-1 text-[13.5px] sm:grid-cols-2">
            {mostLinked.map(({ n, links }) => (
              <li key={n[0]} className="flex items-baseline gap-2">
                <Link
                  href={noteHref({ id: n[0], slug: n[1] })}
                  className="min-w-0 truncate font-medium text-ink hover:underline"
                >
                  {n[2]}
                </Link>
                <span className="shrink-0 text-[12.5px] tabular-nums text-muted">
                  {links} links
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
