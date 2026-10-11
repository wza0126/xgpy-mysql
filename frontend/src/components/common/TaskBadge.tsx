import React from 'react';
import { useTaskStore } from '../../store/taskStore';

/**
 * 任务入口红点角标：显示「有奖励可领」的任务数。
 * 用法：放在一个 `relative` 定位的父元素内（如桌面顶栏的「任务中心」按钮）。
 */
export const TaskBadge: React.FC = () => {
  const count = useTaskStore((s) => s.pendingCount);
  if (!count) return null;
  return (
    <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] leading-none font-medium flex items-center justify-center shadow">
      {count > 99 ? '99+' : count}
    </span>
  );
};

export default TaskBadge;
