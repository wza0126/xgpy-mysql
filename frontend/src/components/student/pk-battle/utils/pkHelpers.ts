// PK 对战工具函数：段位渲染、时间格式化等

export interface RankInfo {
  tier: number;
  name: string;
  icon: string;
  color: string;
  stars: number;
}

const RANK_TIERS = [
  { tier: 0, name: '小学生', icon: '🎒', color: 'blue' },
  { tier: 1, name: '初中生', icon: '📚', color: 'cyan' },
  { tier: 2, name: '高中生', icon: '🏫', color: 'green' },
  { tier: 3, name: '本科生', icon: '🎓', color: 'purple' },
  { tier: 4, name: '研究生', icon: '🔬', color: 'gold' },
];

export function getRankInfo(tier: number, stars: number): RankInfo {
  const info = RANK_TIERS[tier] || RANK_TIERS[0];
  return { ...info, stars };
}

/**
 * 渲染星数（最多显示5颗，研究生显示实际数）
 */
export function renderStars(tier: number, stars: number): string {
  if (tier >= 4) {
    // 研究生显示实际星数（最多显示99）
    return '★'.repeat(Math.min(stars, 99));
  }
  const filled = Math.min(stars, 5);
  const empty = 5 - filled;
  return '★'.repeat(filled) + '☆'.repeat(empty);
}

/**
 * 格式化秒数为 mm:ss
 */
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * 格式化毫秒为 mm:ss
 */
export function formatDuration(ms: number): string {
  return formatTime(Math.floor(ms / 1000));
}

/**
 * 段位颜色映射到 Tailwind 类名
 */
export function getRankColorClass(color: string): string {
  const map: Record<string, string> = {
    blue: 'text-blue-600 bg-blue-50 border-blue-200',
    cyan: 'text-cyan-600 bg-cyan-50 border-cyan-200',
    green: 'text-green-600 bg-green-50 border-green-200',
    purple: 'text-purple-600 bg-purple-50 border-purple-200',
    gold: 'text-yellow-600 bg-yellow-50 border-yellow-200',
  };
  return map[color] || map.blue;
}
