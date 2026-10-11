import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { backendClient } from '../../api/backendClient';

/**
 * 学生端「每日任务」面板
 * ------------------------------------------------------------
 * 与「课堂任务」并列，挂在任务中心（taskCenter）内。
 * 数据来自 GET /api/student/daily-tasks，进度由服务端按指标实时统计；
 * 达标即亮「领取」按钮（桌面入口同时显示红点，计数来自 pending-count）。
 */

const ICON_MAP: Record<string, string> = {
  star: 'fa-star',
  bolt: 'fa-bolt',
  book: 'fa-book',
  trophy: 'fa-trophy',
  check: 'fa-circle-check',
  target: 'fa-bullseye',
  sword: 'fa-khanda',
  clock: 'fa-clock',
};

interface RewardItem {
  type: string;
  value: number;
  target_id?: string | null;
  label?: string;
  codes?: string[];
}
interface ProgressInfo {
  value: number;
  text?: string;
  error?: string | null;
}
interface DailyTaskItem {
  id: string;
  name: string;
  description: string;
  icon: string;
  task_type: 'daily' | 'once';
  unit: string;
  target_value: number;
  rewards: RewardItem[];
  progress: ProgressInfo;
  can_claim: boolean;
  claimed: boolean;
}

function rewardText(rewards: RewardItem[]): string {
  return rewards
    .map((r) => {
      if (r.type === 'points') return `+${r.value} 积分`;
      if (r.type === 'internet_code') return `上网码 ×${r.value}`;
      if (r.type === 'app') return '应用解锁';
      if (r.type === 'equipment') return `装备 ×${r.value}`;
      return r.type;
    })
    .join(' · ');
}

export const DailyTasks: React.FC = () => {
  const [items, setItems] = useState<DailyTaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'daily' | 'once'>('daily');
  const [claiming, setClaiming] = useState<string | null>(null);
  const [reward, setReward] = useState<{ name: string; granted: RewardItem[] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await backendClient.get('/api/student/daily-tasks?type=all');
      setItems((r.data as DailyTaskItem[]) || []);
    } catch (e: any) {
      if (e?.isAuthError || e?.status === 401) setError('登录已失效，请重新登录后再试');
      else setError(e?.message || '加载失败，请稍后重试');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const claim = async (t: DailyTaskItem) => {
    if (claiming) return;
    setClaiming(t.id);
    try {
      const r = await backendClient.post(`/api/student/daily-tasks/${t.id}/claim`, {});
      const granted = ((r.data && r.data.granted) || []) as RewardItem[];
      setReward({ name: t.name, granted });
      await load();
    } catch (e: any) {
      if (e?.isAuthError || e?.status === 401) alert('登录已失效，请重新登录后再试');
      else alert(e?.message || '领取失败，请稍后重试');
    }
    setClaiming(null);
  };

  const daily = items.filter((i) => i.task_type === 'daily');
  const achieve = items.filter((i) => i.task_type === 'once');
  const list = tab === 'daily' ? daily : achieve;
  const readyCount = items.filter((i) => i.can_claim).length;
  const doneCount = daily.filter((i) => i.claimed || i.progress.value >= i.target_value).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <i className="fa-solid fa-circle-notch fa-spin text-2xl text-indigo-500"></i>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
          <i className="fa-solid fa-triangle-exclamation text-3xl text-amber-400 mb-3"></i>
          <p className="text-gray-600 mb-4">{error}</p>
          <button onClick={load} className="px-5 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600">
            重新加载
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="text-xs text-gray-400">今日任务完成</div>
          <div className="text-2xl font-bold text-gray-800">
            {doneCount} <span className="text-sm font-normal text-gray-300">/ {daily.length}</span>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="text-xs text-gray-400">待领取奖励</div>
          <div className={`text-2xl font-bold ${readyCount > 0 ? 'text-red-500' : 'text-gray-800'}`}>
            {readyCount} <span className="text-sm font-normal text-gray-300">个</span>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="text-xs text-gray-400">我的成就</div>
          <div className="text-2xl font-bold text-gray-800">
            {achieve.filter((a) => a.claimed).length} <span className="text-sm font-normal text-gray-300">/ {achieve.length}</span>
          </div>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setTab('daily')}
          className={`px-4 py-2 rounded-lg text-sm transition-colors ${tab === 'daily' ? 'bg-indigo-50 text-indigo-600 font-medium' : 'text-gray-500 hover:text-gray-700'}`}
        >
          每日任务
        </button>
        <button
          onClick={() => setTab('once')}
          className={`px-4 py-2 rounded-lg text-sm transition-colors ${tab === 'once' ? 'bg-indigo-50 text-indigo-600 font-medium' : 'text-gray-500 hover:text-gray-700'}`}
        >
          我的成就
        </button>
      </div>

      {list.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
          <i className="fa-solid fa-clipboard-list text-3xl text-gray-300 mb-3"></i>
          <p className="text-gray-500">{tab === 'daily' ? '暂无每日任务' : '暂无成就任务'}</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {list.map((t, idx) => {
            const ok = t.progress.value >= t.target_value;
            const pct = Math.min(100, Math.round((t.progress.value / (t.target_value || 1)) * 100));
            const barColor = t.claimed || ok ? '#22c55e' : '#6366f1';
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.03, duration: 0.2 }}
                className={`flex items-center gap-4 p-4 rounded-2xl border transition-colors ${
                  t.can_claim ? 'border-amber-300 bg-amber-50/50' : 'border-gray-100 bg-white'
                }`}
              >
                <div
                  className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    t.claimed ? 'bg-green-50 text-green-500' : 'bg-indigo-50 text-indigo-500'
                  }`}
                >
                  <i className={`fa-solid ${t.claimed ? 'fa-check' : ICON_MAP[t.icon] || 'fa-star'}`}></i>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-800">{t.name}</span>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full ${t.task_type === 'daily' ? 'bg-indigo-50 text-indigo-500' : 'bg-amber-50 text-amber-600'}`}>
                      {t.task_type === 'daily' ? '每日' : '成就'}
                    </span>
                  </div>
                  {t.description && <div className="text-xs text-gray-500 mt-0.5">{t.description}</div>}
                  <div className="flex items-center gap-2 mt-2">
                    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden max-w-xs">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: barColor }}></div>
                    </div>
                    <span className={`text-xs ${ok ? 'text-green-600 font-medium' : 'text-gray-500'}`}>
                      {t.progress.value} / {t.target_value}
                      {t.unit || ''}
                      {ok ? ' ✓' : ''}
                    </span>
                  </div>
                  {t.progress.text && <div className="text-[11px] text-gray-400 mt-0.5">{t.progress.text}</div>}
                </div>

                <div className="text-right flex-shrink-0 min-w-[96px]">
                  <div className="text-xs text-amber-600">{rewardText(t.rewards)}</div>
                  {t.claimed ? (
                    <div className="mt-1.5 text-xs px-4 py-1.5 rounded-lg bg-gray-100 text-gray-400 flex items-center justify-center gap-1">
                      <i className="fa-solid fa-check"></i>已领取
                    </div>
                  ) : t.can_claim ? (
                    <button
                      onClick={() => claim(t)}
                      disabled={claiming === t.id}
                      className="mt-1.5 w-full text-xs px-4 py-1.5 rounded-lg bg-amber-500 text-white font-medium hover:bg-amber-600 disabled:opacity-60"
                    >
                      {claiming === t.id ? '领取中…' : '领 取'}
                    </button>
                  ) : (
                    <div className="mt-1.5 text-xs px-4 py-1.5 rounded-lg border border-gray-200 text-gray-400">
                      继续努力
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {reward && (
          <motion.div
            className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="bg-white rounded-2xl p-8 w-80 text-center shadow-2xl"
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0 }}
            >
              <div className="w-20 h-20 mx-auto rounded-full bg-amber-100 flex items-center justify-center mb-4">
                <i className="fa-solid fa-gift text-3xl text-amber-500"></i>
              </div>
              <h3 className="text-lg font-bold text-gray-800">领取成功</h3>
              <p className="text-sm text-gray-500 mt-1">「{reward.name}」奖励已发放</p>
              <div className="mt-4 space-y-1.5">
                {reward.granted.map((g, i) => (
                  <div key={i} className="text-amber-600 font-medium text-sm">
                    {g.label || rewardText([g])}
                  </div>
                ))}
              </div>
              {reward.granted.some((g) => g.codes && g.codes.length) && (
                <div className="mt-3 p-3 bg-gray-50 rounded-lg text-left">
                  <div className="text-xs text-gray-500 mb-1">上网码（可复制）</div>
                  {reward.granted
                    .filter((g) => g.codes && g.codes.length)
                    .flatMap((g) => g.codes as string[])
                    .map((c, i) => (
                      <div key={i} className="font-mono text-sm text-gray-800 select-all">{c}</div>
                    ))}
                </div>
              )}
              <button
                onClick={() => setReward(null)}
                className="mt-6 w-full py-2.5 bg-indigo-500 text-white rounded-xl font-medium hover:bg-indigo-600"
              >
                开心收下
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default DailyTasks;
