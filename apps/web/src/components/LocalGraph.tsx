"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export interface GraphNodeInput {
  id: string;
  title: string;
  href: string;
  /** center: the page's note; in: links here; out: linked from here; member: hub member. */
  role: "center" | "in" | "out" | "both" | "member";
}

export interface GraphEdgeInput {
  source: string;
  target: string;
}

interface LocalGraphProps {
  nodes: GraphNodeInput[];
  edges: GraphEdgeInput[];
  height?: number;
}

const ROLE_COLOR: Record<GraphNodeInput["role"], string> = {
  center: "#4b50d8",
  in: "#1f7a4d",
  out: "#8b8ff5",
  both: "#2f8f9d",
  member: "#9a9aa2",
};

/** A small force-directed graph of a note's neighbourhood, drawn with Sigma.js (LB-5). */
export function LocalGraph({ nodes, edges, height = 220 }: LocalGraphProps) {
  const container = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = container.current;
    if (!el || nodes.length < 2) return;
    let killed = false;
    let renderer: { kill: () => void } | null = null;

    void (async () => {
      try {
        const [{ default: Graph }, { default: Sigma }, fa2] = await Promise.all([
          import("graphology"),
          import("sigma"),
          import("graphology-layout-forceatlas2"),
        ]);
        if (killed) return;
        const g = new Graph({ multi: false, type: "directed" });
        const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        nodes.forEach((n, i) => {
          const angle = (2 * Math.PI * i) / nodes.length;
          g.addNode(n.id, {
            x: n.role === "center" ? 0 : Math.cos(angle),
            y: n.role === "center" ? 0 : Math.sin(angle),
            size: n.role === "center" ? 9 : 5,
            label: n.title,
            color: ROLE_COLOR[n.role],
            href: n.href,
          });
        });
        for (const e of edges) {
          if (
            e.source !== e.target &&
            g.hasNode(e.source) &&
            g.hasNode(e.target) &&
            !g.hasEdge(e.source, e.target)
          ) {
            g.addEdge(e.source, e.target, { size: 1, color: dark ? "#3a3a41" : "#d9d8d3" });
          }
        }
        fa2.default.assign(g, {
          iterations: 120,
          settings: { ...fa2.default.inferSettings(g), gravity: 2, scalingRatio: 6 },
        });
        const sigma = new Sigma(g, el, {
          renderLabels: true,
          labelSize: 11,
          labelColor: { color: dark ? "#cfcfd4" : "#3d3d42" },
          // Small neighbourhoods show every label; big hubs show only the larger nodes.
          labelDensity: nodes.length <= 16 ? 1 : 0.4,
          labelRenderedSizeThreshold: nodes.length <= 16 ? 0 : 6,
          defaultEdgeType: "arrow",
          zIndex: true,
        });
        sigma.on("clickNode", ({ node }) => {
          const href = g.getNodeAttribute(node, "href") as string;
          if (href) router.push(href);
        });
        sigma.on("enterNode", () => (el.style.cursor = "pointer"));
        sigma.on("leaveNode", () => (el.style.cursor = "default"));
        renderer = sigma;
      } catch {
        setFailed(true);
      }
    })();

    return () => {
      killed = true;
      renderer?.kill();
    };
  }, [nodes, edges, router]);

  if (nodes.length < 2) return <p className="text-[13px] text-muted">No linked notes yet.</p>;
  if (failed)
    return <p className="text-[13px] text-muted">The graph could not be drawn in this browser.</p>;
  return (
    <div>
      <div
        ref={container}
        style={{ height }}
        className="w-full rounded-lg border border-line bg-bg"
        role="img"
        aria-label={`Graph of ${nodes.length} linked notes`}
      />
      <ul className="sr-only">
        {nodes.map((n) => (
          <li key={n.id}>
            <a href={n.href}>{n.title}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}
