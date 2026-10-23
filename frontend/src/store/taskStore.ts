import { create } from 'zustand';
import { backendClient } from '../api/backendClient';

/**
 * 任务「可领取」计数
 * ------------------------------------------------------------
 * 红点语义 = **有奖励可领**（已达成但本期未领取的任务数），不是"未读消息"。
 * - pendingCount：总数，用于桌面「任务中心」入口红点
 * - dailyCount  ：每日任务可领数，用于任务中心「每日任务」Tab 角标
 * - achieveCount：成就可领数，用于任务中心「成就殿堂」Tab 角标
 * 由 Desktop 每 5 分钟轮询一次（2026-10-23 从 30 秒放宽：红点只表示「有没有奖可领」，
 * 每 30 秒刷一次要跑十几次查询，是当时最慢的常规接口）；完成任务中心内领取后即时刷新。
 */
interface TaskStoreState {
  pendingCount: number;
  dailyCount: number;
  achieveCount: number;
  fetchPendingCount: () => Promise<void>;
  reset: () => void;
}

const norm = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export const useTaskStore = create<TaskStoreState>((set) => ({
  pendingCount: 0,
  dailyCount: 0,
  achieveCount: 0,
  fetchPendingCount: async () => {
    try {
      const r = await backendClient.get('/api/student/daily-tasks/pending-count');
      const d = (r && r.data) || {};
      set({
        pendingCount: norm(d.count),
        dailyCount: norm(d.daily),
        achieveCount: norm(d.once),
      });
    } catch {
      // 静默失败：未登录或网络抖动时不打扰学生，保留上一次计数
    }
  },
  reset: () => set({ pendingCount: 0, dailyCount: 0, achieveCount: 0 }),
}));
