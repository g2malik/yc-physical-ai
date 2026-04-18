"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, useRef, useCallback, useMemo } from "react";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

interface Node {
  id: number;
  name: string;
  batch: string;
  industry: string;
  subIndustry: string;
  oneLiner: string;
  location: string;
  website: string;
  status: string;
  tags: string[];
  ycUrl: string;
  whyMech: string;
  cluster?: number;
  clusterName?: string;
  top10?: { id: number; score: number }[];
  x?: number;
  y?: number;
  employeeCount?: number | null;
  followerCount?: number | null;
}

type DotMode = "uniform" | "employees" | "followers";

interface Link { source: number; target: number; weight: number; }
interface GraphData { nodes: Node[]; links: Link[]; }
interface UmapNode extends Node { x: number; y: number; }
interface ClusterInfo { id: number; name: string; cx: number; cy: number; size: number; color?: string; }

const SECTOR_MAP: Record<string, string> = {
  "Industrials -> Manufacturing and Robotics": "Manufacturing & Robotics",
  "Industrials": "Manufacturing & Robotics",
  "B2B -> Engineering, Product and Design": "Engineering & Design Tools",
  "B2B -> Analytics": "Engineering & Design Tools",
  "B2B -> Productivity": "Engineering & Design Tools",
  "B2B": "Engineering & Design Tools",
  "B2B -> Supply Chain and Logistics": "Supply Chain & Operations",
  "B2B -> Operations": "Supply Chain & Operations",
  "B2B -> Infrastructure": "Supply Chain & Operations",
  "Industrials -> Aviation and Space": "Aviation & Space",
  "Industrials -> Energy": "Energy & Climate",
  "Industrials -> Climate": "Energy & Climate",
  "Real Estate and Construction -> Construction": "Construction",
  "Real Estate and Construction": "Construction",
  "Real Estate and Construction -> Housing and Real Estate": "Construction",
  "Healthcare -> Medical Devices": "Healthcare & Bio",
  "Healthcare -> Drug Discovery and Delivery": "Healthcare & Bio",
  "Healthcare -> Industrial Bio": "Healthcare & Bio",
  "Healthcare": "Healthcare & Bio",
  "Healthcare -> Diagnostics": "Healthcare & Bio",
  "Healthcare -> Therapeutics": "Healthcare & Bio",
  "Healthcare -> Healthcare IT": "Healthcare & Bio",
  "Industrials -> Defense": "Defense & Government",
  "Government": "Defense & Government",
  "Industrials -> Agriculture": "Agriculture",
  "Industrials -> Automotive": "Automotive & Drones",
  "Industrials -> Drones": "Automotive & Drones",
  "Consumer -> Consumer Electronics": "Consumer Hardware",
  "Consumer": "Consumer Hardware",
  "Consumer -> Food and Beverage": "Consumer Hardware",
  "Consumer -> Virtual and Augmented Reality": "Consumer Hardware",
};

// Dot sizing — employees: sqrt scale capped at 32 (p90); followers: log scale
// normalized against actual data floor (p10≈319) to p90≈8000.
// Wide visual range 2.5–14px to make differences obvious.
const DOT_MIN = 2;
const DOT_MAX = 10;
const DOT_UNIFORM = 4;

function scaledT(raw: number, mode: Exclude<DotMode, "uniform">): number {
  if (mode === "employees") {
    // sqrt scale 1→0, 32→1
    return Math.min(Math.sqrt(Math.max(raw, 1)) / Math.sqrt(32), 1);
  } else {
    // log scale normalized: floor=300 → 0, ceil=8000 → 1
    const FLOOR = Math.log(300), CEIL = Math.log(8000);
    return Math.max(0, Math.min((Math.log(Math.max(raw, 1)) - FLOOR) / (CEIL - FLOOR), 1));
  }
}

function dotRadius(n: Node, mode: DotMode, isSelected: boolean, isHovered: boolean): number {
  if (isSelected) return DOT_MAX + 2;
  if (isHovered) return DOT_MAX + 1;
  if (mode === "uniform") return DOT_UNIFORM;
  const raw = mode === "employees" ? (n.employeeCount ?? null) : (n.followerCount ?? null);
  if (raw === null || raw === undefined) return DOT_MIN;
  return DOT_MIN + scaledT(raw, mode) * (DOT_MAX - DOT_MIN);
}

function dotOpacity(n: Node, mode: DotMode, isSelected: boolean, isHovered: boolean): number {
  if (isSelected || isHovered) return 1;
  if (mode === "uniform") return 0.75;
  const raw = mode === "employees" ? (n.employeeCount ?? null) : (n.followerCount ?? null);
  if (raw === null || raw === undefined) return 0.25;
  return 0.35 + scaledT(raw, mode) * 0.65;
}

function getSector(subIndustry: string): string {
  return SECTOR_MAP[subIndustry] ?? "Other";
}

const SECTOR_COLORS: Record<string, string> = {
  "Manufacturing & Robotics": "#f97316",
  "Engineering & Design Tools": "#f59e0b",
  "Supply Chain & Operations": "#8b5cf6",
  "Aviation & Space": "#3b82f6",
  "Energy & Climate": "#22c55e",
  "Construction": "#a855f7",
  "Healthcare & Bio": "#ec4899",
  "Defense & Government": "#ef4444",
  "Agriculture": "#84cc16",
  "Automotive & Drones": "#06b6d4",
  "Consumer Hardware": "#14b8a6",
  "Other": "#94a3b8",
};

function nodeColor(n: Node) {
  return SECTOR_COLORS[getSector(n.subIndustry)] ?? "#94a3b8";
}

// ─── Convex hull helpers ──────────────────────────────────────────────────────

function convexHull(pts: { x: number; y: number }[]): { x: number; y: number }[] {
  if (pts.length < 3) return pts;
  const s = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: { x: number; y: number }[] = [];
  for (const p of s) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: { x: number; y: number }[] = [];
  for (const p of [...s].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return [...lower, ...upper];
}

function expandHull(hull: { x: number; y: number }[], cx: number, cy: number, pad: number) {
  return hull.map(p => {
    const dx = p.x - cx, dy = p.y - cy, l = Math.sqrt(dx * dx + dy * dy) || 1;
    return { x: p.x + (dx / l) * pad, y: p.y + (dy / l) * pad };
  });
}

function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return "";
  const n = pts.length;
  const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const m0 = mid(pts[0], pts[1]);
  let d = `M ${m0.x} ${m0.y}`;
  for (let i = 1; i <= n; i++) {
    const p = pts[i % n], q = pts[(i + 1) % n];
    const m = mid(p, q);
    d += ` Q ${p.x} ${p.y} ${m.x} ${m.y}`;
  }
  return d + " Z";
}

// ─── Company drawer ───────────────────────────────────────────────────────────

function CompanyDrawer({ node, allNodes, links, onClose, onSelect }: {
  node: Node;
  allNodes: Node[];
  links: Link[];
  onClose: () => void;
  onSelect: (n: Node) => void;
}) {
  const similar = useMemo(() => {
    const relevant = links
      .filter(l => l.source === node.id || l.target === node.id)
      .map(l => ({ id: l.source === node.id ? l.target : l.source, score: l.weight }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    return relevant
      .map(({ id, score }) => ({ node: allNodes.find(n => n.id === id), score }))
      .filter(x => x.node) as { node: Node; score: number }[];
  }, [node, allNodes, links]);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex justify-end" onClick={onClose}>
      <div className="bg-white w-full max-w-md h-full overflow-y-auto p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-sm mb-4">← Close</button>
        <div className="flex items-start justify-between gap-2 mb-1">
          <h2 className="text-xl font-bold text-gray-900">{node.name}</h2>
          <span className={`text-xs px-2 py-1 rounded-full font-medium mt-1 ${node.status === "Active" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
            {node.status}
          </span>
        </div>
        <p className="text-sm text-gray-500 mb-3">{node.batch} · {node.location}</p>
        <p className="text-sm font-medium text-gray-800 mb-4">{node.oneLiner}</p>
        <div className="mb-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Why Physical AI</h3>
          <p className="text-sm text-gray-700 bg-orange-50 border border-orange-200 rounded-lg p-3">{node.whyMech}</p>
        </div>
        {node.clusterName && (
          <div className="mb-4">
            <span className="text-xs px-2 py-1 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-100 font-medium">
              {node.clusterName}
            </span>
          </div>
        )}
        <div className="mb-4 flex flex-wrap gap-1.5">
          <span className="text-xs px-2 py-1 rounded-full font-medium bg-gray-100 text-gray-700">{node.subIndustry}</span>
          {node.tags.map(t => (
            <span key={t} className="text-xs px-2 py-1 rounded-full bg-gray-50 text-gray-500 border border-gray-200">{t}</span>
          ))}
        </div>
        <div className="flex gap-3 mb-6">
          {node.website && (
            <a href={node.website} target="_blank" rel="noopener noreferrer"
              className="text-sm px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition">Website</a>
          )}
          {node.ycUrl && (
            <a href={node.ycUrl} target="_blank" rel="noopener noreferrer"
              className="text-sm px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-400 transition">YC Profile</a>
          )}
        </div>

        {similar.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Most Similar Companies</h3>
            <div className="space-y-2">
              {similar.map(({ node: n, score }) => (
                <button
                  key={n.id}
                  onClick={() => onSelect(n)}
                  className="w-full text-left border border-gray-200 rounded-lg p-3 hover:border-orange-400 hover:bg-orange-50 transition"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-gray-900">{n.name}</span>
                    <span className="text-xs text-gray-400 shrink-0 font-mono">{Math.round(score * 100)}%</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.oneLiner}</p>
                  <p className="text-xs text-gray-400 mt-1">{getSector(n.subIndustry)} · {n.batch}</p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Cluster Map (UMAP scatter) ──────────────────────────────────────────────

function ClusterMap({ nodes, clusters, selected, onSelect, dotMode }: {
  nodes: UmapNode[];
  clusters: ClusterInfo[];
  selected: Node | null;
  onSelect: (n: Node) => void;
  dotMode: DotMode;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ mx: 0, my: 0, tx: 0, ty: 0 });
  const [hovered, setHovered] = useState<UmapNode | null>(null);
  const [tooltip, setTooltip] = useState({ x: 0, y: 0 });
  const [search, setSearch] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeCluster, setActiveCluster] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const W = 900, H = 650;

  const { minX, maxX, minY, maxY } = useMemo(() => {
    const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  }, [nodes]);

  const toSvgXY = useCallback((x: number, y: number) => ({
    sx: 40 + ((x - minX) / (maxX - minX)) * (W - 80),
    sy: 40 + ((y - minY) / (maxY - minY)) * (H - 80),
  }), [minX, maxX, minY, maxY]);

  const toSvg = (n: UmapNode) => {
    const { sx, sy } = toSvgXY(n.x, n.y);
    return { cx: sx, cy: sy };
  };

  // Compute convex hull shapes for each cluster
  const clusterShapes = useMemo(() => {
    if (!clusters.length) return [];
    return clusters.flatMap(c => {
      const pts = nodes
        .filter(n => n.cluster === c.id)
        .map(n => {
          const { sx, sy } = toSvgXY(n.x, n.y);
          return { x: sx, y: sy };
        });
      if (pts.length < 3) return [];
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
      const hull = convexHull(pts);
      if (hull.length < 3) return [];
      const expanded = expandHull(hull, cx, cy, 26);
      const color = c.color ?? "#94a3b8";
      return [{ id: c.id, name: c.name, path: smoothPath(expanded), cx, cy, color }];
    });
  }, [clusters, nodes, toSvgXY]);

  function zoomToCluster(cid: number) {
    const pts = nodes
      .filter(n => n.cluster === cid)
      .map(n => toSvgXY(n.x, n.y));
    if (!pts.length) return;
    const xs = pts.map(p => p.sx), ys = pts.map(p => p.sy);
    const pad = 50;
    const bW = Math.max(...xs) - Math.min(...xs) + 2 * pad;
    const bH = Math.max(...ys) - Math.min(...ys) + 2 * pad;
    const scale = Math.min(8, Math.min(W / bW, H / bH) * 0.9);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    setTransform({ x: W / 2 - cx * scale, y: H / 2 - cy * scale, scale });
    setActiveCluster(cid);
  }

  const suggestions = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase();
    return nodes.filter(n => n.name.toLowerCase().includes(q) || n.oneLiner.toLowerCase().includes(q)).slice(0, 8);
  }, [search, nodes]);

  const panToNode = useCallback((n: UmapNode) => {
    const { cx, cy } = toSvg(n);
    const scale = 4;
    setTransform({ x: W / 2 - cx * scale, y: H / 2 - cy * scale, scale });
    onSelect(n);
    setSearch("");
    setShowSuggestions(false);
    setActiveCluster(n.cluster ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, minX, maxX, minY, maxY, onSelect]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "f" || e.key === "F") {
        if (document.activeElement === searchRef.current) return;
        setTransform({ x: 0, y: 0, scale: 1 });
        setActiveCluster(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.06 : 0.94;
    setTransform(t => ({ ...t, scale: Math.max(0.3, Math.min(8, t.scale * factor)) }));
  }, []);

  const onMouseDown = (e: React.MouseEvent) => {
    setDragging(true);
    dragStart.current = { mx: e.clientX, my: e.clientY, tx: transform.x, ty: transform.y };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    setTransform(t => ({ ...t, x: dragStart.current.tx + e.clientX - dragStart.current.mx, y: dragStart.current.ty + e.clientY - dragStart.current.my }));
  };
  const onMouseUp = () => setDragging(false);

  return (
    <div className="relative w-full h-full bg-gray-50 overflow-hidden">
      {/* Search box */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 w-72">
        <input
          ref={searchRef}
          type="text"
          placeholder="Search company..."
          value={search}
          onChange={e => { setSearch(e.target.value); setShowSuggestions(true); }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          className="w-full px-3 py-2 text-sm bg-white border border-gray-300 text-gray-900 placeholder-gray-400 rounded-lg shadow-sm focus:outline-none focus:border-orange-400"
        />
        {showSuggestions && suggestions.length > 0 && (
          <div className="mt-1 bg-white border border-gray-200 rounded-lg overflow-hidden shadow-xl">
            {suggestions.map(n => (
              <button
                key={n.id}
                onMouseDown={() => panToNode(n)}
                className="w-full text-left px-3 py-2 hover:bg-gray-50 transition"
              >
                <p className="text-sm text-gray-900">{n.name}</p>
                <p className="text-xs text-gray-400 truncate">{n.oneLiner}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        viewBox={`0 0 ${W} ${H}`}
        className="cursor-grab active:cursor-grabbing select-none"
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.scale})`}>
          {/* Hull fills — behind dots */}
          {clusterShapes.map(s => {
            const isActive = activeCluster === s.id;
            return (
              <path
                key={s.id}
                d={s.path}
                fill={isActive ? `${s.color}22` : `${s.color}12`}
                stroke={s.color}
                strokeOpacity={isActive ? 0.6 : 0.3}
                strokeWidth={isActive ? 1.5 : 1}
                className="cursor-pointer"
                onClick={(e) => { e.stopPropagation(); zoomToCluster(s.id); }}
              />
            );
          })}

          {/* Dots */}
          {nodes.map(n => {
            const { cx, cy } = toSvg(n);
            const isSelected = selected?.id === n.id;
            const isHovered = hovered?.id === n.id;
            const r = dotRadius(n, dotMode, isSelected, isHovered);
            const opacity = dotOpacity(n, dotMode, isSelected, isHovered);
            return (
              <circle
                key={n.id}
                cx={cx} cy={cy}
                r={r}
                fill={nodeColor(n)}
                fillOpacity={opacity}
                stroke={isSelected ? "#fff" : "none"}
                strokeWidth={isSelected ? 2 : 0}
                className="cursor-pointer transition-all"
                onClick={() => { onSelect(n); setActiveCluster(n.cluster ?? null); }}
                onMouseEnter={(e) => {
                  setHovered(n);
                  const rect = svgRef.current?.getBoundingClientRect();
                  setTooltip({ x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) });
                }}
                onMouseLeave={() => setHovered(null)}
              />
            );
          })}

          {/* Cluster labels — in front of dots */}
          {clusterShapes.map(s => {
            const isActive = activeCluster === s.id;
            const labelW = s.name.length * 5.4 + 16;
            const labelH = 14;
            return (
              <g key={`label-${s.id}`} style={{ pointerEvents: "none" }}>
                <rect
                  x={s.cx - labelW / 2} y={s.cy - labelH / 2}
                  width={labelW} height={labelH} rx={3}
                  fill="white" fillOpacity={isActive ? 0.9 : 0.75}
                />
                <text
                  x={s.cx} y={s.cy}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={9} fontFamily="sans-serif" fontWeight={600}
                  fill={isActive ? s.color : "#475569"}
                  fillOpacity={isActive ? 1 : 0.85}
                  style={{ letterSpacing: "0.01em" }}
                >
                  {s.name}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {hovered && (
        <div
          className="absolute pointer-events-none bg-white text-gray-900 text-xs rounded-lg px-3 py-2 shadow-xl border border-gray-200 max-w-xs z-10"
          style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}
        >
          <p className="font-semibold">{hovered.name}</p>
          <p className="text-gray-500 mt-0.5">{hovered.oneLiner}</p>
          <p className="text-gray-400 mt-0.5">{getSector(hovered.subIndustry)} · {hovered.batch}</p>
          {(hovered.employeeCount != null || hovered.followerCount != null) && (
            <p className="text-gray-400 mt-0.5 text-[10px]">
              {hovered.employeeCount != null && `${hovered.employeeCount} employees`}
              {hovered.employeeCount != null && hovered.followerCount != null && " · "}
              {hovered.followerCount != null && `${hovered.followerCount.toLocaleString()} followers`}
            </p>
          )}
          {hovered.clusterName && <p className="text-indigo-400 mt-0.5 text-[10px]">{hovered.clusterName}</p>}
        </div>
      )}

      <div className="absolute bottom-3 right-3 flex gap-2">
        {activeCluster !== null && (
          <button
            onClick={() => { setTransform({ x: 0, y: 0, scale: 1 }); setActiveCluster(null); }}
            className="text-xs text-indigo-600 hover:text-indigo-800 bg-white hover:bg-indigo-50 border border-indigo-200 px-2.5 py-1.5 rounded-md transition shadow-sm"
          >
            ← All clusters
          </button>
        )}
        <button
          onClick={() => { setTransform({ x: 0, y: 0, scale: 1 }); setActiveCluster(null); }}
          className="text-xs text-gray-500 hover:text-gray-800 bg-white hover:bg-gray-100 border border-gray-200 px-2.5 py-1.5 rounded-md transition shadow-sm"
        >
          Reset view (F)
        </button>
      </div>
    </div>
  );
}

// ─── Force Graph wrapper ─────────────────────────────────────────────────────

function ForceGraphView({ graphData, onSelect }: { graphData: GraphData; onSelect: (n: Node) => void }) {
  const fgRef = useRef<any>(null);
  const [hovered, setHovered] = useState<Node | null>(null);

  const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D, scale: number) => {
    const r = 7;
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
    ctx.fillStyle = nodeColor(node as Node);
    ctx.globalAlpha = 1;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (scale > 2.5) {
      ctx.font = `${4}px Sans-Serif`;
      ctx.fillStyle = "#111";
      ctx.textAlign = "center";
      ctx.fillText(node.name, node.x, node.y + 11);
    }
  }, []);

  return (
    <ForceGraph2D
      ref={fgRef}
      graphData={graphData as any}
      backgroundColor="#f8fafc"
      nodeCanvasObject={paintNode}
      nodePointerAreaPaint={(node: any, color, ctx) => {
        ctx.beginPath();
        ctx.arc(node.x, node.y, 10, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
      }}
      linkColor={(l: any) => `rgba(100,116,139,${0.15 + (l.weight - 0.55) * 1.5})`}
      linkWidth={(l: any) => 0.5 + (l.weight - 0.55) * 6}
      onNodeClick={(node: any) => onSelect(node as Node)}
      onNodeHover={(node: any) => setHovered(node as Node | null)}
      nodeLabel={(node: any) => `${(node as Node).name} — ${(node as Node).oneLiner}`}
      cooldownTicks={150}
    />
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function GraphPage() {
  const [view, setView] = useState<"force" | "cluster">("cluster");
  const [dotMode, setDotMode] = useState<DotMode>("followers");
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [umapNodes, setUmapNodes] = useState<UmapNode[]>([]);
  const [clusters, setClusters] = useState<ClusterInfo[]>([]);
  const [selected, setSelected] = useState<Node | null>(null);
  const [selectedSectors, setSelectedSectors] = useState<Set<string>>(new Set());
  const [selectedYears, setSelectedYears] = useState<Set<number>>(new Set([2024, 2025, 2026]));

  const selectNode = useCallback((n: Node) => {
    if (!n.top10 && graphData) {
      const rich = graphData.nodes.find(gn => gn.id === n.id);
      setSelected(rich ?? n);
    } else {
      setSelected(n);
    }
  }, [graphData]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/graph.json").then(r => r.ok ? r.json() : Promise.reject("graph.json not found")),
      fetch("/umap.json").then(r => r.ok ? r.json() : Promise.reject("umap.json not found")),
      fetch("/clusters.json").then(r => r.ok ? r.json() : Promise.resolve([])),
    ])
      .then(([graph, umap, clusterData]) => {
        setGraphData(graph);
        setUmapNodes(umap);
        setClusters(clusterData);
        setLoading(false);
      })
      .catch(e => {
        setError(String(e));
        setLoading(false);
      });
  }, []);

  const batchYear = (batch: string) => parseInt(batch.split(" ").pop() ?? "0");

  const activeSectors = useMemo(() => {
    const all = (umapNodes.length ? umapNodes : graphData?.nodes ?? []).map(n => getSector(n.subIndustry));
    const present = new Set(all);
    return Object.keys(SECTOR_COLORS).filter(s => present.has(s));
  }, [umapNodes, graphData]);

  const activeYears = useMemo(() => {
    const all = (umapNodes.length ? umapNodes : graphData?.nodes ?? []).map(n => batchYear(n.batch));
    return [...new Set(all)].sort();
  }, [umapNodes, graphData]);

  const passesFilters = (n: Node) => {
    if (selectedSectors.size && !selectedSectors.has(getSector(n.subIndustry))) return false;
    if (selectedYears.size && !selectedYears.has(batchYear(n.batch))) return false;
    return true;
  };

  const filteredUmapNodes = useMemo(() =>
    umapNodes.filter(passesFilters),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [umapNodes, selectedSectors, selectedYears]);

  const filteredGraphData = useMemo(() => {
    if (!graphData) return null;
    const nodes = graphData.nodes.filter(passesFilters);
    const ids = new Set(nodes.map(n => n.id));
    const links = graphData.links.filter(l => ids.has(l.source as number) && ids.has(l.target as number));
    return { nodes, links };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphData, selectedSectors, selectedYears]);

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-gray-400 text-sm">Loading graph data…</p>
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center flex-col gap-3">
      <p className="text-red-500 font-medium">Data not ready yet</p>
      <p className="text-gray-500 text-sm max-w-md text-center">
        Run the Python scripts first:<br />
        <code className="text-orange-500">python embed_companies.py</code><br />
        <code className="text-orange-500">python build_graph_umap.py</code>
      </p>
      <a href="/list" className="mt-2 text-sm text-gray-400 hover:text-gray-700 underline">← Back to list</a>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 flex flex-col">
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <a href="/list" className="text-sm px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition">List View</a>
          <h1 className="text-sm font-semibold text-gray-900">YC Physical AI · Similarity Explorer</h1>
          <span className="text-xs text-gray-400">{filteredUmapNodes.length} companies</span>
        </div>
        <div className="flex items-center gap-3">
          {view === "cluster" && (
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              {(["uniform", "employees", "followers"] as DotMode[]).map(m => (
                <button key={m} onClick={() => setDotMode(m)}
                  className={`text-xs px-2.5 py-1.5 rounded-md transition capitalize ${dotMode === m ? "bg-white text-gray-900 shadow-sm font-medium" : "text-gray-400 hover:text-gray-700"}`}>
                  {m === "uniform" ? "Uniform" : m === "employees" ? "By Employees" : "By Followers"}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            <button onClick={() => setView("cluster")}
              className={`text-xs px-3 py-1.5 rounded-md transition ${view === "cluster" ? "bg-orange-500 text-white" : "text-gray-500 hover:text-gray-800"}`}>
              Cluster Map
            </button>
            <button onClick={() => setView("force")}
              className={`text-xs px-3 py-1.5 rounded-md transition ${view === "force" ? "bg-orange-500 text-white" : "text-gray-500 hover:text-gray-800"}`}>
              Similarity Graph
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-44 shrink-0 border-r border-gray-200 bg-white p-4 overflow-y-auto">
          {/* Year filter */}
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Year</p>
            <button
              onClick={() => setSelectedYears(new Set(activeYears))}
              className="text-[10px] text-gray-400 hover:text-gray-700"
            >All</button>
          </div>
          <div className="flex flex-wrap gap-1 mb-5">
            {activeYears.map(y => {
              const on = selectedYears.has(y);
              return (
                <button
                  key={y}
                  onClick={() => setSelectedYears(prev => {
                    const next = new Set(prev);
                    on ? next.delete(y) : next.add(y);
                    return next;
                  })}
                  className={`text-xs px-2 py-0.5 rounded-md border transition ${on ? "bg-orange-500 text-white border-orange-500" : "text-gray-400 border-gray-200 hover:border-gray-400"}`}
                >
                  {y}
                </button>
              );
            })}
          </div>

          {/* Sector filter */}
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Sector</p>
            {selectedSectors.size > 0 && (
              <button onClick={() => setSelectedSectors(new Set())} className="text-[10px] text-gray-400 hover:text-gray-700">Clear</button>
            )}
          </div>
          <div className="space-y-1.5">
            {activeSectors.map(s => {
              const on = selectedSectors.has(s);
              const dimmed = selectedSectors.size > 0 && !on;
              return (
                <button
                  key={s}
                  onClick={() => setSelectedSectors(prev => {
                    const next = new Set(prev);
                    on ? next.delete(s) : next.add(s);
                    return next;
                  })}
                  className={`w-full flex items-center gap-2 px-1.5 py-1 rounded-md transition text-left ${on ? "bg-gray-100" : "hover:bg-gray-50"} ${dimmed ? "opacity-30" : ""}`}
                >
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: SECTOR_COLORS[s] }} />
                  <span className="text-xs text-gray-600 leading-tight">{s}</span>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="flex-1 relative">
          {view === "cluster" && umapNodes.length > 0 && (
            <ClusterMap nodes={filteredUmapNodes} clusters={clusters} selected={selected} onSelect={selectNode} dotMode={dotMode} />
          )}
          {view === "force" && filteredGraphData && (
            <ForceGraphView graphData={filteredGraphData} onSelect={selectNode} />
          )}
          {view === "cluster" && umapNodes.length === 0 && (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">umap.json not loaded</div>
          )}
        </main>
      </div>

      {selected && (
        <CompanyDrawer
          node={selected}
          allNodes={graphData?.nodes ?? umapNodes}
          links={graphData?.links ?? []}
          onClose={() => setSelected(null)}
          onSelect={selectNode}
        />
      )}
    </div>
  );
}
