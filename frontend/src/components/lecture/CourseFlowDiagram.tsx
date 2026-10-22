import React, { useMemo } from 'react';

export interface FlowNode {
  id: string;
  type: 'start' | 'io' | 'process' | 'decision' | 'end';
  text: string;
}

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
}

export interface FlowSpec {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

const NODE_W = 210;
const NODE_H = 58;
const DECISION_H = 84;
const GAP_Y = 54;
const GAP_X = 30;
const PAD = 24;

const STYLE: Record<string, { fill: string; stroke: string; text: string }> = {
  start: { fill: '#dcfce7', stroke: '#16a34a', text: '#14532d' },
  end: { fill: '#ffe4e6', stroke: '#e11d48', text: '#881337' },
  process: { fill: '#eef2ff', stroke: '#4f46e5', text: '#312e81' },
  io: { fill: '#f5f3ff', stroke: '#7c3aed', text: '#4c1d95' },
  decision: { fill: '#fef3c7', stroke: '#d97706', text: '#78350f' },
};

/**
 * 微课程流程图渲染。
 *
 * 用真实的 SVG 画：起止框（胶囊）、输入输出（平行四边形）、处理框（矩形）、
 * 判断框（菱形），带箭头和「是/否」标签。模型给的节点顺序不一定可靠，
 * 这里按连线做分层（level = 从起点出发的最长路径），同层节点并排，
 * 循环回边画在左侧绕回，看起来就是教材上的当型循环。
 */
export const CourseFlowDiagram: React.FC<{ flow: FlowSpec; className?: string }> = ({ flow, className }) => {
  const layout = useMemo(() => {
    const nodes = (flow.nodes || []).filter((n) => n && n.id && n.text);
    const edges = (flow.edges || []).filter((e) => e && e.from && e.to);
    if (!nodes.length) return null;

    const byId = new Map(nodes.map((n) => [n.id, n]));
    // 起点：优先 start 类型，否则第一个节点
    const startId = (nodes.find((n) => n.type === 'start') || nodes[0]).id;

    const level: Record<string, number> = {};
    nodes.forEach((n) => { level[n.id] = -1; });
    level[startId] = 0;

    // 最长路径分层（最多迭代 12 轮，天然避开环）
    for (let iter = 0; iter < 12; iter += 1) {
      let changed = false;
      for (const e of edges) {
        if (!byId.has(e.from) || !byId.has(e.to)) continue;
        if (level[e.from] < 0) continue;
        const want = level[e.from] + 1;
        // 回边（指向已在上方/同层的节点）不参与分层，避免把循环拉成无限
        if (want > level[e.to] && want <= 8) {
          level[e.to] = want;
          changed = true;
        }
      }
      if (!changed) break;
    }
    // 没被连到的孤立节点，顺排到最后一层
    let maxLevel = Math.max(0, ...nodes.map((n) => level[n.id]));
    nodes.forEach((n) => { if (level[n.id] < 0) { maxLevel += 1; level[n.id] = maxLevel; } });

    const rows: Record<number, FlowNode[]> = {};
    nodes.forEach((n) => {
      const l = level[n.id];
      if (!rows[l]) rows[l] = [];
      rows[l].push(n);
    });

    const levels = Object.keys(rows).map(Number).sort((a, b) => a - b);
    const rowHeights = levels.map((l) => (rows[l].some((n) => n.type === 'decision') ? DECISION_H : NODE_H));
    const yOf: Record<number, number> = {};
    let cursor = PAD;
    levels.forEach((l, i) => { yOf[l] = cursor; cursor += rowHeights[i] + GAP_Y; });
    const height = cursor - GAP_Y + PAD;

    const widest = Math.max(...levels.map((l) => rows[l].length));
    const width = Math.max(PAD * 2 + NODE_W, widest * NODE_W + (widest - 1) * GAP_X + PAD * 2);

    const pos: Record<string, { x: number; y: number; w: number; h: number }> = {};
    levels.forEach((l) => {
      const row = rows[l];
      const rowWidth = row.length * NODE_W + (row.length - 1) * GAP_X;
      const left = (width - rowWidth) / 2;
      row.forEach((n, i) => {
        pos[n.id] = {
          x: left + i * (NODE_W + GAP_X),
          y: yOf[l],
          w: NODE_W,
          h: n.type === 'decision' ? DECISION_H : NODE_H,
        };
      });
    });

    return { nodes, edges, pos, width, height, startId };
  }, [flow]);

  if (!layout) return null;
  const { nodes, edges, pos, width, height } = layout;

  const shape = (n: FlowNode, p: { x: number; y: number; w: number; h: number }) => {
    const s = STYLE[n.type] || STYLE.process;
    const cx = p.x + p.w / 2;
    const cy = p.y + p.h / 2;
    if (n.type === 'decision') {
      const pts = `${cx},${p.y} ${p.x + p.w},${cy} ${cx},${p.y + p.h} ${p.x},${cy}`;
      return <polygon points={pts} fill={s.fill} stroke={s.stroke} strokeWidth={2} />;
    }
    if (n.type === 'io') {
      const k = 18;
      const pts = `${p.x + k},${p.y} ${p.x + p.w},${p.y} ${p.x + p.w - k},${p.y + p.h} ${p.x},${p.y + p.h}`;
      return <polygon points={pts} fill={s.fill} stroke={s.stroke} strokeWidth={2} />;
    }
    const r = n.type === 'start' || n.type === 'end' ? p.h / 2 : 10;
    return <rect x={p.x} y={p.y} width={p.w} height={p.h} rx={r} fill={s.fill} stroke={s.stroke} strokeWidth={2} />;
  };

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ maxHeight: '46vh' }} role="img" aria-label="流程图">
        <defs>
          <marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#475569" />
          </marker>
        </defs>

        {edges.map((e, i) => {
          const a = pos[e.from];
          const b = pos[e.to];
          if (!a || !b) return null;
          const ax = a.x + a.w / 2;
          const ay = a.y + a.h;
          const bx = b.x + b.w / 2;
          const by = b.y;
          const isBack = by <= ay; // 回到上方 → 循环回边，走左侧
          let d: string;
          let lx: number;
          let ly: number;
          if (isBack) {
            const railX = PAD / 2 + 6;
            d = `M ${a.x} ${a.y + a.h / 2} L ${railX} ${a.y + a.h / 2} L ${railX} ${b.y + b.h / 2} L ${b.x} ${b.y + b.h / 2}`;
            lx = railX + 4;
            ly = (a.y + b.y + b.h) / 2;
          } else {
            const midY = ay + (by - ay) / 2;
            d = `M ${ax} ${ay} L ${ax} ${midY} L ${bx} ${midY} L ${bx} ${by}`;
            lx = (ax + bx) / 2 + 6;
            ly = midY - 6;
          }
          return (
            <g key={i}>
              <path d={d} fill="none" stroke="#475569" strokeWidth={2} markerEnd="url(#flow-arrow)" />
              {e.label && (
                <text x={lx} y={ly} fontSize={13} fill="#0f172a" fontWeight={600}>{e.label}</text>
              )}
            </g>
          );
        })}

        {nodes.map((n) => {
          const p = pos[n.id];
          const s = STYLE[n.type] || STYLE.process;
          return (
            <g key={n.id}>
              {shape(n, p)}
              <foreignObject x={p.x + 8} y={p.y + 4} width={p.w - 16} height={p.h - 8}>
                <div
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    height: '100%', textAlign: 'center', fontSize: 15, lineHeight: 1.25,
                    fontWeight: 600, color: s.text, padding: '0 4px',
                  }}
                >
                  {n.text}
                </div>
              </foreignObject>
            </g>
          );
        })}
      </svg>
    </div>
  );
};
