import React from 'react';
import { motion } from 'framer-motion';
import { Badge, GameProgress } from '../../../types/python-magic';

interface InventoryProps {
  progress: GameProgress;
  allBadges: Badge[];
  currentChapter: number;
  totalChapters: number;
}

const XP_PER_LEVEL = 200;

function calculateLevel(totalXp: number): { level: number; currentXp: number; nextLevelXp: number } {
  const level = Math.floor(totalXp / XP_PER_LEVEL) + 1;
  const currentXp = totalXp % XP_PER_LEVEL;
  return { level, currentXp, nextLevelXp: XP_PER_LEVEL };
}

function getLevelTitle(level: number): string {
  const titles = [
    '见习学徒',
    '初级学徒',
    '中级学徒',
    '高级学徒',
    '见习法师',
    '初级法师',
    '中级法师',
    '高级法师',
    '大法师',
    '魔导师',
  ];
  if (level <= titles.length) return titles[level - 1];
  return `传奇法师 Lv.${level}`;
}

export const Inventory: React.FC<InventoryProps> = ({
  progress,
  allBadges,
  currentChapter,
  totalChapters,
}) => {
  const { level, currentXp, nextLevelXp } = calculateLevel(progress.total_xp);
  const xpProgress = (currentXp / nextLevelXp) * 100;
  const earnedBadgeIds = new Set(progress.badges);
  const earnedCount = allBadges.filter((b) => earnedBadgeIds.has(b.id)).length;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {/* 角色信息卡片 */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-gray-900 via-indigo-950 to-gray-900 p-6 shadow-2xl"
      >
        <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-gradient-to-br from-yellow-500/20 to-purple-600/20 blur-3xl" />
        <div className="absolute -bottom-6 -left-6 h-24 w-24 rounded-full bg-gradient-to-tr from-purple-500/10 to-indigo-500/10 blur-2xl" />

        <div className="relative flex items-center gap-5">
          {/* 等级徽章 */}
          <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-yellow-400 to-amber-600 shadow-lg shadow-yellow-500/30">
            <div className="text-center">
              <div className="text-2xl font-bold leading-none text-white">{level}</div>
              <div className="mt-0.5 text-[10px] font-medium tracking-wide text-yellow-100/80">
                等级
              </div>
            </div>
          </div>

          {/* 角色信息 */}
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-white">{getLevelTitle(level)}</h2>
            <p className="mt-0.5 text-sm text-purple-200/70">
              总经验值 {progress.total_xp}
            </p>
            <div className="mt-3 flex items-center gap-4 text-xs text-gray-400">
              <span className="flex items-center gap-1">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-yellow-400" />
                徽章 {earnedCount}/{allBadges.length}
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-400" />
                章节 {currentChapter}/{totalChapters}
              </span>
            </div>
          </div>
        </div>

        {/* 经验值进度条 */}
        <div className="relative mt-5">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="font-medium text-yellow-300/90">经验值</span>
            <span className="text-gray-400">
              {currentXp} / {nextLevelXp}
            </span>
          </div>
          <div className="h-4 overflow-hidden rounded-full bg-gray-800/60">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${xpProgress}%` }}
              transition={{ duration: 1, ease: 'easeOut' }}
              className="relative h-full rounded-full bg-gradient-to-r from-purple-500 via-yellow-400 to-amber-500 shadow-[0_0_12px_rgba(234,179,8,0.3)]"
            >
              <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.15)_50%,transparent_100%)] animate-pulse" />
            </motion.div>
          </div>
        </div>

        {/* 章节进度 */}
        <div className="relative mt-4">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="font-medium text-blue-300/90">章节进度</span>
            <span className="text-gray-400">
              {currentChapter} / {totalChapters}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-gray-800/60">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(currentChapter / totalChapters) * 100}%` }}
              transition={{ duration: 1, delay: 0.3, ease: 'easeOut' }}
              className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.3)]"
            />
          </div>
        </div>
      </motion.div>

      {/* 徽章展示区 */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="rounded-2xl bg-gradient-to-br from-gray-900 via-indigo-950 to-gray-900 p-6 shadow-2xl"
      >
        <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br from-yellow-500/10 to-purple-600/10 blur-2xl pointer-events-none" />

        <div className="relative">
          <div className="flex items-center justify-between mb-5">
            <h3 className="flex items-center gap-2 text-lg font-bold text-white">
              <span className="text-yellow-400">🏅</span>
              成就徽章
            </h3>
            <span className="rounded-full bg-purple-500/20 px-3 py-1 text-xs text-purple-300">
              {earnedCount} / {allBadges.length}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-4 sm:grid-cols-4">
            {allBadges.map((badge, index) => {
              const earned = earnedBadgeIds.has(badge.id);
              return (
                <motion.div
                  key={badge.id}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.3 + index * 0.05 }}
                  className={`group relative flex flex-col items-center rounded-xl p-4 text-center transition-all duration-300 ${
                    earned
                      ? 'bg-gradient-to-b from-yellow-500/10 to-amber-600/5 shadow-[0_0_16px_rgba(234,179,8,0.08)]'
                      : 'bg-gray-800/30'
                  }`}
                >
                  {/* 徽章图标 */}
                  <div
                    className={`flex h-14 w-14 items-center justify-center rounded-2xl text-2xl transition-all duration-300 ${
                      earned
                        ? 'bg-gradient-to-br from-yellow-400 to-amber-500 shadow-lg shadow-yellow-500/20 group-hover:scale-110 group-hover:shadow-yellow-500/40'
                        : 'bg-gray-700/50 grayscale'
                    }`}
                  >
                    {badge.icon}
                  </div>

                  {/* 徽章名称 */}
                  <p
                    className={`mt-2 text-xs font-semibold transition-colors ${
                      earned ? 'text-yellow-200' : 'text-gray-500'
                    }`}
                  >
                    {badge.name}
                  </p>

                  {/* 描述提示 */}
                  <p
                    className={`mt-0.5 text-[10px] leading-tight transition-colors ${
                      earned ? 'text-yellow-300/60' : 'text-gray-600'
                    }`}
                  >
                    {badge.description}
                  </p>

                  {/* 未获得覆盖层 */}
                  {!earned && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-gray-900/40 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                      <span className="rounded-full bg-gray-800 px-2 py-0.5 text-[10px] text-gray-400">
                        未获得
                      </span>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>

          {allBadges.length === 0 && (
            <div className="py-10 text-center text-gray-500">
              <span className="text-4xl">🔮</span>
              <p className="mt-3 text-sm">暂无可用徽章</p>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};
