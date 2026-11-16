import React from 'react';

/**
 * 学院全景（2026-11-16）
 *
 * 16 座建筑对应 16 章，外观由该章点亮进度决定 —— 这是本作最重要的长期动力：
 * 学生看到的不是进度条，而是「我的楼长高了、窗户亮了」。
 *
 * ⛔ 全部用 SVG 画，不引图片、不用外部素材（内网离线 + exe 打包，加载不到网络图）。
 * ⛔ 只做三态（毛坯 / 成型 / 完整），不做逐级生长动画 —— 后者美术量与性能都不可控。
 */
export interface BuildingData {
  chapter_code: string;
  chapter_name: string;
  part: string;
  section_total: number;
  max_stars: number;
  stars: number;
  lit: number;
  percent: number;
}

const PALETTE: Record<string, { roof: string; wall: string; win: string; line: string; text: string }> = {
  必修一: { roof: '#7FB3E8', wall: '#DCEAF8', win: '#4A90D9', line: '#3A72A8', text: '#1E4E7A' },
  必修二: { roof: '#B49BE0', wall: '#EAE3F8', win: '#8B6FD1', line: '#6B52A8', text: '#3F2F6B' },
};

interface Props {
  buildings: BuildingData[];
  onSelect?: (b: BuildingData) => void;
}

/** 单座建筑：level 0=荒地 1=毛坯 2=成型 3=完整 */
function roofOf(level: number, c: typeof PALETTE['必修一']) {
  return level >= 2 ? c.roof : '#D8D6CE';
}

export const BuildingScene: React.FC<Props> = ({ buildings, onSelect }) => {
  const COLS = 4;
  const W = 200;
  const H = 118;
  const rows = Math.ceil(buildings.length / COLS);
  const width = COLS * W;
  const height = rows * H + 10;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: '100%', height: 'auto' }}
      role="img"
    >
      <title>学院全景</title>
      {buildings.map((b, i) => {
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const ox = col * W;
        const oy = row * H;
        const c = PALETTE[b.part] || PALETTE['必修一'];
        const level = b.percent >= 100 ? 3 : b.percent >= 60 ? 2 : b.percent > 0 ? 1 : 0;
        const wallW = 96;
        const wallH = 46 + level * 8;
        const wx = ox + (W - wallW) / 2;
        const wy = oy + 74 - (level > 0 ? level * 8 : 0);

        return (
          <g
            key={b.chapter_code}
            onClick={() => onSelect && onSelect(b)}
            style={{ cursor: onSelect ? 'pointer' : 'default' }}
          >
            <rect x={ox + 6} y={oy + 4} width={W - 12} height={H - 10} rx="8" fill="#FFFFFF" stroke="#E6E4DC" />

            {level === 0 ? (
              <>
                <rect x={wx} y={oy + 72} width={wallW} height={18} rx="3" fill="#F4F3EE" stroke="#C9C7BE" strokeDasharray="4 3" />
                <text x={ox + W / 2} y={oy + 66} fontSize="11" fill="#B4B2A9" textAnchor="middle">未动工</text>
              </>
            ) : (
              <>
                <polygon
                  points={`${wx - 6},${wy} ${wx + wallW / 2},${wy - 26} ${wx + wallW + 6},${wy}`}
                  fill={roofOf(level, c)}
                  stroke={c.line}
                  strokeWidth="1.2"
                />
                <rect x={wx} y={wy} width={wallW} height={wallH} rx="3" fill={level === 1 ? '#F0EEE6' : c.wall} stroke={c.line} strokeWidth="1.2" />
                {level >= 2 && (
                  <>
                    <rect x={wx + 14} y={wy + 14} width="14" height="14" fill={c.win} />
                    <rect x={wx + 41} y={wy + 14} width="14" height="14" fill={c.win} />
                    <rect x={wx + 68} y={wy + 14} width="14" height="14" fill={c.win} />
                  </>
                )}
                {level === 1 && (
                  <rect x={wx + 34} y={wy + 14} width="28" height="16" rx="2" fill="#E2E0D6" stroke="#C9C7BE" strokeDasharray="3 2" />
                )}
                <rect x={wx + 38} y={wy + wallH - 22} width="20" height="22" fill={level >= 2 ? c.win : '#D8D6CE'} />
                {level === 3 && (
                  <>
                    <line x1={wx + wallW / 2} y1={wy - 26} x2={wx + wallW / 2} y2={wy - 40} stroke={c.line} strokeWidth="1.5" />
                    <polygon points={`${wx + wallW / 2},${wy - 40} ${wx + wallW / 2 + 16},${wy - 34} ${wx + wallW / 2},${wy - 28}`} fill={c.win} />
                  </>
                )}
              </>
            )}

            <text x={ox + W / 2} y={oy + 96} fontSize="11" fill={level === 0 ? '#B4B2A9' : c.text} textAnchor="middle">
              {b.chapter_name}
            </text>
            <text x={ox + W / 2} y={oy + 110} fontSize="10" fill="#9A988F" textAnchor="middle">
              {b.lit}/{b.section_total} 节 · {b.percent}%
            </text>
          </g>
        );
      })}
    </svg>
  );
};
