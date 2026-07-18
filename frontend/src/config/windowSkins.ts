// 窗口皮肤配置
// 视觉配置存前端代码（Tailwind 类名），元数据存数据库

export type SkinTier = 'common' | 'rare' | 'legendary';
export type SkinAnimation = 'shimmer' | 'pulse' | 'gold-flow' | 'galaxy';

export interface WindowSkinConfig {
  id: string;
  name: string;
  description: string;
  tier: SkinTier;
  critBonus: number;        // 暴击率加成百分比
  pointsCost: number;       // 建议积分价格（教师可调整）
  previewEmoji: string;     // 预览图标
  // 视觉配置
  titleBarClass: string;    // 标题栏样式
  titleTextClass: string;   // 标题文字样式
  borderClass: string;      // 边框样式
  shadowClass: string;      // 阴影样式
  contentBgClass: string;   // 内容区背景
  buttonHoverClass: string; // 窗口按钮 hover 样式
  closeButtonClass: string; // 关闭按钮样式
  animation?: SkinAnimation; // 动画类型
  accentColor: string;      // 主色调（用于预览和动画）
}

export const WINDOW_SKINS: WindowSkinConfig[] = [
  // ========== 普通档 ==========
  {
    id: 'skin_minimal_white',
    name: '极简白',
    description: '简约纯净，返璞归真',
    tier: 'common',
    critBonus: 1,
    pointsCost: 100,
    previewEmoji: '⚪',
    titleBarClass: 'bg-gradient-to-r from-gray-300 to-gray-400',
    titleTextClass: 'text-gray-800',
    borderClass: 'border border-gray-300',
    shadowClass: 'shadow-md',
    contentBgClass: 'bg-white',
    buttonHoverClass: 'hover:bg-gray-600/20',
    closeButtonClass: 'hover:bg-red-500',
    accentColor: 'gray',
  },
  {
    id: 'skin_forest_green',
    name: '森林绿',
    description: '清新自然，绿意盎然',
    tier: 'common',
    critBonus: 1,
    pointsCost: 150,
    previewEmoji: '🌲',
    titleBarClass: 'bg-gradient-to-r from-green-500 to-emerald-600',
    titleTextClass: 'text-white',
    borderClass: 'border-2 border-green-400',
    shadowClass: 'shadow-lg shadow-green-500/20',
    contentBgClass: 'bg-green-50',
    buttonHoverClass: 'hover:bg-white/20',
    closeButtonClass: 'hover:bg-red-500',
    accentColor: 'green',
  },
  {
    id: 'skin_ocean_blue',
    name: '海洋蓝',
    description: '深海湛蓝，心旷神怡',
    tier: 'common',
    critBonus: 2,
    pointsCost: 250,
    previewEmoji: '🌊',
    titleBarClass: 'bg-gradient-to-r from-cyan-500 to-blue-500',
    titleTextClass: 'text-white',
    borderClass: 'border-2 border-cyan-300',
    shadowClass: 'shadow-lg shadow-cyan-500/30',
    contentBgClass: 'bg-cyan-50',
    buttonHoverClass: 'hover:bg-white/20',
    closeButtonClass: 'hover:bg-red-500',
    accentColor: 'cyan',
  },

  // ========== 好看档 ==========
  {
    id: 'skin_aurora_purple',
    name: '紫霞幻彩',
    description: '紫霞流转，梦幻绮丽',
    tier: 'rare',
    critBonus: 3,
    pointsCost: 800,
    previewEmoji: '🌌',
    titleBarClass: 'bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500',
    titleTextClass: 'text-white drop-shadow',
    borderClass: 'border-2 border-purple-400',
    shadowClass: 'shadow-xl shadow-purple-500/40',
    contentBgClass: 'bg-gradient-to-br from-purple-50 to-pink-50',
    buttonHoverClass: 'hover:bg-white/25',
    closeButtonClass: 'hover:bg-red-500',
    animation: 'shimmer',
    accentColor: 'purple',
  },
  {
    id: 'skin_sunset_gold',
    name: '日落橙金',
    description: '落日熔金，温暖绚烂',
    tier: 'rare',
    critBonus: 3,
    pointsCost: 800,
    previewEmoji: '🌅',
    titleBarClass: 'bg-gradient-to-r from-orange-500 via-amber-500 to-yellow-500',
    titleTextClass: 'text-white',
    borderClass: 'border-2 border-amber-400',
    shadowClass: 'shadow-xl shadow-amber-500/40',
    contentBgClass: 'bg-gradient-to-br from-orange-50 to-amber-50',
    buttonHoverClass: 'hover:bg-white/25',
    closeButtonClass: 'hover:bg-red-500',
    animation: 'pulse',
    accentColor: 'amber',
  },

  // ========== 超级华丽档 ==========
  {
    id: 'skin_royal_gold',
    name: '流光金黑',
    description: '帝王尊享，金碧辉煌',
    tier: 'legendary',
    critBonus: 5,
    pointsCost: 2500,
    previewEmoji: '👑',
    titleBarClass: 'bg-gradient-to-r from-gray-900 via-yellow-700 to-gray-900',
    titleTextClass: 'text-yellow-300 drop-shadow-lg',
    borderClass: 'border-2 border-yellow-500/60',
    shadowClass: 'shadow-2xl shadow-yellow-500/50',
    contentBgClass: 'bg-gradient-to-br from-gray-50 to-yellow-50',
    buttonHoverClass: 'hover:bg-yellow-500/30',
    closeButtonClass: 'hover:bg-red-500',
    animation: 'gold-flow',
    accentColor: 'yellow',
  },
  {
    id: 'skin_galaxy_star',
    name: '星河璀璨',
    description: '银河倒泻，星海璀璨',
    tier: 'legendary',
    critBonus: 5,
    pointsCost: 2500,
    previewEmoji: '✨',
    titleBarClass: 'bg-gradient-to-r from-indigo-900 via-purple-800 to-blue-900',
    titleTextClass: 'text-cyan-200',
    borderClass: 'border-2 border-cyan-400/50',
    shadowClass: 'shadow-2xl shadow-cyan-500/60',
    contentBgClass: 'bg-gradient-to-br from-indigo-50 to-blue-50',
    buttonHoverClass: 'hover:bg-cyan-400/30',
    closeButtonClass: 'hover:bg-red-500',
    animation: 'galaxy',
    accentColor: 'cyan',
  },
];

export const TIER_LABELS: Record<SkinTier, string> = {
  common: '普通',
  rare: '好看',
  legendary: '超级华丽',
};

export const TIER_COLORS: Record<SkinTier, string> = {
  common: 'gray',
  rare: 'purple',
  legendary: 'yellow',
};

export const TIER_BORDER_COLORS: Record<SkinTier, string> = {
  common: 'border-gray-300',
  rare: 'border-purple-400',
  legendary: 'border-yellow-400',
};

export const TIER_BG_COLORS: Record<SkinTier, string> = {
  common: 'bg-gray-100 text-gray-700',
  rare: 'bg-purple-100 text-purple-700',
  legendary: 'bg-gradient-to-r from-yellow-100 to-amber-100 text-amber-800',
};

// 默认皮肤配置（未激活任何皮肤时使用）
export const DEFAULT_SKIN: WindowSkinConfig = {
  id: 'default',
  name: '默认蓝',
  description: '系统默认皮肤',
  tier: 'common',
  critBonus: 0,
  pointsCost: 0,
  previewEmoji: '🔵',
  titleBarClass: 'bg-gradient-to-r from-blue-600 to-blue-700',
  titleTextClass: 'text-white',
  borderClass: 'border border-gray-200',
  shadowClass: 'shadow-2xl',
  contentBgClass: 'bg-gray-50',
  buttonHoverClass: 'hover:bg-white/20',
  closeButtonClass: 'hover:bg-red-500',
  accentColor: 'blue',
};

// 根据 ID 获取皮肤配置
export function getSkinById(skinId: string | null | undefined): WindowSkinConfig | null {
  if (!skinId) return null;
  return WINDOW_SKINS.find((s) => s.id === skinId) || null;
}

// 后端镜像：皮肤 ID → 暴击加成映射（供后端使用）
export const SKIN_CRIT_BONUS_MAP: Record<string, number> = WINDOW_SKINS.reduce(
  (map, skin) => {
    map[skin.id] = skin.critBonus;
    return map;
  },
  {} as Record<string, number>
);
