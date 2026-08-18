import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BuffInfo } from '../../../hooks/useGameSystem';

interface HonorBadgeProps {
  currentStreak: number;
  currentCritStreak: number;
  currentWrong: number;
  buffs: BuffInfo[];
}

const getBuffStyle = (buffType: string) => {
  switch (buffType) {
    case 'perfect_crit':
      return {
        border: 'border-green-500',
        bg: 'bg-green-50',
        text: 'text-green-700',
        label: '十全十美',
      };
    case 'critstreak_crit':
      return {
        border: 'border-yellow-500',
        bg: 'bg-yellow-50',
        text: 'text-yellow-700',
        label: '暴击新星',
      };
    case 'wrong_debuff':
      return {
        border: 'border-red-500',
        bg: 'bg-red-50',
        text: 'text-red-700',
        label: '屡败屡战',
      };
    case 'teacher_crit':
      return {
        border: 'border-purple-500',
        bg: 'bg-purple-50',
        text: 'text-purple-700',
        label: '师恩赋能',
      };
    case 'studious_crit':
      return {
        border: 'border-blue-500',
        bg: 'bg-blue-50',
        text: 'text-blue-700',
        label: '勤学好问',
      };
    case 'typing_fast_crit':
      return {
        border: 'border-cyan-500',
        bg: 'bg-cyan-50',
        text: 'text-cyan-700',
        label: '运指如飞',
      };
    default:
      return {
        border: 'border-gray-500',
        bg: 'bg-gray-50',
        text: 'text-gray-700',
        label: buffType,
      };
  }
};

const formatRemainingTime = (seconds: number): string => {
  if (seconds <= 0) return '已过期';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins > 0) {
    return `${mins}分${secs}秒`;
  }
  return `${secs}秒`;
};

export const HonorBadge: React.FC<HonorBadgeProps> = ({
  currentStreak,
  currentCritStreak,
  currentWrong,
  buffs,
}) => {
  return (
    <div className="flex items-center justify-between px-4 py-2 bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="flex items-center gap-4">
        <AnimatePresence mode="popLayout">
          {currentStreak > 0 && (
            <motion.div
              key="streak"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 15 }}
              className="flex items-center gap-1 px-3 py-1 bg-green-100 rounded-full"
            >
              <span className="text-sm">🔥</span>
              <span className="text-sm font-bold text-green-700">{currentStreak}</span>
            </motion.div>
          )}
          {currentCritStreak > 0 && (
            <motion.div
              key="critStreak"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 15 }}
              className="flex items-center gap-1 px-3 py-1 bg-yellow-100 rounded-full"
            >
              <span className="text-sm">⚡</span>
              <span className="text-sm font-bold text-yellow-700">{currentCritStreak}</span>
            </motion.div>
          )}
          {currentWrong > 0 && (
            <motion.div
              key="wrong"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 15 }}
              className="flex items-center gap-1 px-3 py-1 bg-red-100 rounded-full"
            >
              <span className="text-sm">💔</span>
              <span className="text-sm font-bold text-red-700">{currentWrong}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-center gap-2">
        <AnimatePresence>
          {buffs.map((buff) => {
            const style = getBuffStyle(buff.buff_type);
            return (
              <motion.div
                key={buff.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className={`flex items-center gap-2 px-3 py-1 rounded-lg border ${style.border} ${style.bg}`}
              >
                <span className={`text-xs font-medium ${style.text}`}>{style.label}</span>
                <span className="text-xs text-gray-500">
                  {formatRemainingTime(buff.remaining_seconds)}
                </span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
};
