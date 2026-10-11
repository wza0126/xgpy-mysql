import React from 'react';
import { useTaskStore } from '../../store/taskStore';

const fmt = (n: number) => (n > 99 ? '99+' : String(n));

/**
 * 任务入口红点角标（绝对定位款）。
 * 用法：放在一个 `relative` 定位的父元素内（如桌面顶栏的「任务中心」按钮）。
 */
export const TaskBadge: React.FC = () => {
  const count = useTaskStore((s) => s.pendingCount);
  if (!count) return null;
  return (
    <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] leading-none font-medium flex items-center justify-center shadow">
      {fmt(count)}
    </span>
  );
};

/**
 * 内联数字气泡（跟随文字排布款），用于任务中心顶部的「每日任务 / 成就殿堂」Tab。
 * 与 TaskBadge 同语义、同配色，count 为 0 时不渲染。
 */
export const CountPill: React.FC<{ count: number }> = ({ count }) => {
  if (!count) return null;
  return (
    <span className="ml-1.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] leading-none font-medium align-middle">
      {fmt(count)}
    </span>
  );
};

export default TaskBadge;
