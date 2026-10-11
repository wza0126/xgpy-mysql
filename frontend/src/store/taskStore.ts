import { create } from 'zustand';
import { backendClient } from '../api/backendClient';

/**
 * 每日任务「可领取」计数
 * ------------------------------------------------------------
 * 桌面任务入口的红点语义 = **有奖励可领**（已达成但本期未领取的任务数），
 * 不是"未读消息"。与通知红点同构：由 Desktop 每 30 秒轮询一次。
 */
interface TaskStoreState {
  pendingCount: number;
  fetchPendingCount: () => Promise<void>;
  reset: () => void;
}

export const useTaskStore = create<TaskStoreState>((set) => ({
  pendingCount: 0,
  fetchPendingCount: async () => {
    try {
      const r = await backendClient.get('/api/student/daily-tasks/pending-count');
      const n = r && r.data ? Number(r.data.count) : 0;
      set({ pendingCount: Number.isFinite(n) && n > 0 ? n : 0 });
    } catch {
      // 静默失败：未登录或网络抖动时不打扰学生，保留上一次计数
    }
  },
  reset: () => set({ pendingCount: 0 }),
}));
