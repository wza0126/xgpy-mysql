import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { backendClient } from '../../api/backendClient';
import { useTaskStore } from '../../store/taskStore';

/**
 * 学生端「成就殿堂」（任务二期）
 * ------------------------------------------------------------
 * 与「每日任务」并列，挂在任务中心（taskCenter）内。
 * 数据来自 GET /api/student/achievements —— 只含「一次性成就」（task_type='once'），
 * 进度由服务端按**累计口径**指标实时统计；按「系列」分组展示，达成即可领取。
 *
 * 成就卡三态：
 *   locked  未达成（灰底 + 进度）
 *   ready   可领取（金边 + 呼吸光 + 「领取」）
 *   got     已点亮（金色勋章 + 点亮日期）
 *
 * 红点计数由桌面任务入口统一负责（pending-count 已含成就），本组件不重复处理。
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
  crown: 'fa-crown',
  coin: 'fa-coins',
  fire: 'fa-fire',
  code: 'fa-code',
  paw: 'fa-paw',
  medal: 'fa-medal',
};

const FALLBACK_COLOR = 'var(--brand, #4f46e5)';

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
interface SeriesDef {
  id: string;
  name: string;
  icon: string;
  color: string;
}
interface AchItem {
  id: string;
  name: string;
  description: string;
  icon: string;
  task_type: 'daily' | 'once';
  unit: string;
  target_value: number;
  rewards: RewardItem[];
  series: SeriesDef | null;
  progress: ProgressInfo;
  can_claim: boolean;
  claimed: boolean;
  claimed_at?: string | null;
}
interface Summary {
  total: number;
  got: number;
  ready: number;
  last: { name: string; claimed_at: string } | null;
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

function fmtDate(s?: string | null): string {
  if (!s) return '';
  try {
    return String(s).slice(0, 10);
  } catch {
    return '';
  }
}

/** 圆形进度环（复用于勋章与详情弹窗） */
const Ring: React.FC<{ size: number; r: number; stroke: number; pct: number; color: string; track?: string }> = ({
  size, r, stroke, pct, color, track = '#eef1f6',
}) => {
  const C = 2 * Math.PI * r;
  const off = C * (1 - Math.min(100, Math.max(0, pct)) / 100);
  const cx = size / 2;
  return (
    <svg className="absolute inset-0" width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke={track} strokeWidth={stroke} />
      <circle
        cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeLinecap="round" strokeDasharray={C.toFixed(1)} strokeDashoffset={off.toFixed(1)}
        style={{ transition: 'stroke-dashoffset .6s ease' }}
      />
    </svg>
  );
};

export const AchievementHall: React.FC = () => {
  const [items, setItems] = useState<AchItem[]>([]);
  const [series, setSeries] = useState<SeriesDef[]>([]);
  const [summary, setSummary] = useState<Summary>({ total: 0, got: 0, ready: 0, last: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [claiming, setClaiming] = useState<string | null>(null);
  const [detail, setDetail] = useState<AchItem | null>(null);
  const [reward, setReward] = useState<{ name: string; granted: RewardItem[] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await backendClient.get('/api/student/achievements');
      const d = (r.data || {}) as { items?: AchItem[]; series?: SeriesDef[]; summary?: Summary };
      setItems(d.items || []);
      setSeries(d.series || []);
      setSummary(d.summary || { total: 0, got: 0, ready: 0, last: null });
    } catch (e: any) {
      if (e?.isAuthError || e?.status === 401) setError('登录已失效，请重新登录后再试');
      else setError(e?.message || '加载失败，请稍后重试');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const claim = async (t: AchItem) => {
    if (claiming) return;
    setClaiming(t.id);
    try {
      const r = await backendClient.post(`/api/student/daily-tasks/${t.id}/claim`, {});
      const granted = ((r.data && r.data.granted) || []) as RewardItem[];
      setDetail(null);
      setReward({ name: t.name, granted });
      await load();
      useTaskStore.getState().fetchPendingCount();
    } catch (e: any) {
      if (e?.isAuthError || e?.status === 401) alert('登录已失效，请重新登录后再试');
      else alert(e?.message || '领取失败，请稍后重试');
    }
    setClaiming(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <i className="fa-solid fa-circle-notch fa-spin text-2xl text-amber-500"></i>
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

  const pct = summary.total ? Math.round((summary.got / summary.total) * 100) : 0;
  const shown = filter === 'all' ? items : items.filter((i) => i.series && i.series.id === filter);

  return (
    <div className="max-w-5xl mx-auto p-6">
      {/* 概览 */}
      <div className="grid grid-cols-1 md:grid-cols-[170px_1fr] gap-5 items-center mb-5">
        <div className="flex flex-col items-center gap-2">
          <div className="relative w-[132px] h-[132px]">
            <Ring size={132} r={56} stroke={11} pct={pct} color="#e9a61c" />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold text-gray-800">{pct}%</span>
              <span className="text-xs text-gray-400">{summary.got} / {summary.total}</span>
            </div>
          </div>
          <span className="text-xs text-gray-400">成就完成度</span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <div className="text-xs text-gray-400">已点亮成就</div>
            <div className="text-2xl font-bold text-amber-600">{summary.got}</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <div className="text-xs text-gray-400">可领取奖励</div>
            <div className={`text-2xl font-bold ${summary.ready > 0 ? 'text-red-500' : 'text-gray-800'}`}>{summary.ready}</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <div className="text-xs text-gray-400">最近点亮</div>
            <div className="text-sm font-medium text-gray-700 mt-1.5 truncate" title={summary.last?.name || ''}>
              {summary.last?.name || '—'}
            </div>
          </div>
        </div>
      </div>

      {/* 系列筛选 */}
      <div className="flex gap-2 flex-wrap mb-4">
        {[{ id: 'all', name: '全部', icon: 'star', color: '#4f46e5' } as SeriesDef, ...series].map((s) => {
          const list = s.id === 'all' ? items : items.filter((i) => i.series && i.series.id === s.id);
          const got = list.filter((i) => i.claimed).length;
          const on = filter === s.id;
          return (
            <button
              key={s.id}
              onClick={() => setFilter(s.id)}
              className={`px-3.5 py-1.5 rounded-full text-xs transition-colors border flex items-center gap-1.5 ${
                on ? 'text-white font-medium border-transparent' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
              }`}
              style={on ? { background: s.color } : undefined}
            >
              {s.name}
              <span className={on ? 'text-white/80' : 'text-gray-400'}>{got}/{list.length}</span>
            </button>
          );
        })}
      </div>

      {/* 成就卡网格 */}
      {shown.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
          <i className="fa-solid fa-medal text-3xl text-gray-300 mb-3"></i>
          <p className="text-gray-500">该系列暂无成就</p>
        </div>
      ) : (
        <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(242px, 1fr))' }}>
          {shown.map((t, idx) => {
            const total = t.target_value || 1;
            const p = Math.min(100, Math.round((t.progress.value / total) * 100));
            const color = t.series?.color || FALLBACK_COLOR;
            const barColor = t.claimed || p >= 100 ? '#22c55e' : color;
            const st = t.claimed ? 'got' : t.can_claim ? 'ready' : 'locked';
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(idx, 12) * 0.02, duration: 0.2 }}
                onClick={() => setDetail(t)}
                className={`relative flex flex-col items-center text-center rounded-2xl border p-4 pt-5 cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-lg ${
                  st === 'ready'
                    ? 'border-amber-300 bg-gradient-to-b from-amber-50/60 to-white'
                    : st === 'got'
                      ? 'border-amber-200/70 bg-gradient-to-b from-amber-50/30 to-white'
                      : 'border-gray-100 bg-white opacity-80 hover:opacity-100'
                }`}
              >
                {st === 'ready' && (
                  <span className="absolute -inset-1 rounded-3xl border-2 border-amber-300 animate-ping opacity-30 pointer-events-none" />
                )}

                {/* 勋章 */}
                <div className="relative w-[74px] h-[74px] mb-2.5 flex-shrink-0">
                  <Ring size={74} r={35} stroke={4} pct={p} color={st === 'locked' ? color : '#e9a61c'} />
                  <div
                    className="absolute inset-[7px] rounded-full flex items-center justify-center"
                    style={
                      st === 'got'
                        ? { background: 'linear-gradient(135deg,#f7d572,#e9a61c)', color: '#5b3d05' }
                        : st === 'ready'
                          ? { background: 'linear-gradient(135deg,#ffe3a3,#f5b53d)', color: '#7a4b05' }
                          : { background: '#f1f4f8', color: '#b3bac6' }
                    }
                  >
                    <i className={`fa-solid ${ICON_MAP[t.icon] || 'fa-star'} text-2xl`}></i>
                  </div>
                  {st === 'got' && (
                    <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-sm">
                      <i className="fa-solid fa-crown text-amber-400"></i>
                    </span>
                  )}
                </div>

                <div className="text-sm font-semibold text-gray-800">{t.name}</div>
                <div className="text-[11.5px] text-gray-500 mt-1 min-h-[32px]">{t.description}</div>

                <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden mt-2">
                  <div className="h-full rounded-full transition-all" style={{ width: `${p}%`, background: barColor }}></div>
                </div>
                <div className={`text-[11px] mt-1.5 ${p >= 100 ? 'text-green-600 font-medium' : 'text-gray-500'}`}>
                  {t.progress.value} / {t.target_value}{t.unit || ''}{p >= 100 ? ' ✓' : ''}
                </div>

                <div className="text-[11.5px] text-amber-600 mt-1.5 font-medium">
                  🎁 {rewardText(t.rewards)}
                </div>

                <div className="w-full mt-2.5">
                  {st === 'got' ? (
                    <div className="text-xs py-1.5 rounded-lg bg-green-50 text-green-600 font-medium flex items-center justify-center gap-1">
                      <i className="fa-solid fa-check"></i> 已点亮{fmtDate(t.claimed_at) ? ` · ${fmtDate(t.claimed_at).slice(5)}` : ''}
                    </div>
                  ) : st === 'ready' ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); claim(t); }}
                      disabled={claiming === t.id}
                      className="w-full text-xs py-1.5 rounded-lg text-white font-semibold disabled:opacity-60"
                      style={{ background: 'linear-gradient(135deg,#f7b733,#e59a12)' }}
                    >
                      {claiming === t.id ? '领取中…' : '🎁 领取奖励'}
                    </button>
                  ) : (
                    <div className="text-xs py-1.5 rounded-lg bg-gray-50 text-gray-400 border border-gray-100">
                      进行中 {p}%
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* 成就详情 */}
      <AnimatePresence>
        {detail && (
          <motion.div
            className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setDetail(null)}
          >
            <motion.div
              className="bg-white rounded-2xl w-full max-w-[420px] overflow-hidden shadow-2xl"
              initial={{ scale: 0.94, y: 12 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              {(() => {
                const t = detail;
                const total = t.target_value || 1;
                const p = Math.min(100, Math.round((t.progress.value / total) * 100));
                const st = t.claimed ? 'got' : t.can_claim ? 'ready' : 'locked';
                return (
                  <>
                    <div className={`px-6 pt-7 pb-4 text-center border-b border-gray-100 ${st === 'locked' ? 'bg-gradient-to-b from-slate-50 to-white' : 'bg-gradient-to-b from-amber-50/60 to-white'}`}>
                      <div className="relative w-[88px] h-[88px] mx-auto mb-3">
                        <Ring size={88} r={38} stroke={6} pct={p} color={st === 'locked' ? (t.series?.color || FALLBACK_COLOR) : '#e9a61c'} />
                        <div
                          className="absolute inset-[9px] rounded-full flex items-center justify-center"
                          style={
                            st === 'got'
                              ? { background: 'linear-gradient(135deg,#f7d572,#e9a61c)', color: '#5b3d05' }
                              : st === 'ready'
                                ? { background: 'linear-gradient(135deg,#ffe3a3,#f5b53d)', color: '#7a4b05' }
                                : { background: '#f1f4f8', color: '#b3bac6' }
                          }
                        >
                          <i className={`fa-solid ${ICON_MAP[t.icon] || 'fa-star'} text-3xl`}></i>
                        </div>
                      </div>
                      <h3 className="text-base font-bold text-gray-800">{t.name}</h3>
                      <p className="text-xs text-gray-500 mt-1">{t.description}</p>
                    </div>
                    <div className="px-6 py-4">
                      <div className="flex justify-between text-[13px] py-2 border-b border-dashed border-gray-100">
                        <span className="text-gray-400">所属系列</span>
                        <b className="text-gray-700">{t.series?.name || '—'}</b>
                      </div>
                      <div className="flex justify-between text-[13px] py-2 border-b border-dashed border-gray-100">
                        <span className="text-gray-400">达成条件</span>
                        <b className="text-gray-700">≥ {t.target_value}{t.unit || ''}</b>
                      </div>
                      <div className="py-2 border-b border-dashed border-gray-100">
                        <div className="flex justify-between text-[13px] mb-1.5">
                          <span className="text-gray-400">当前进度</span>
                          <b className="text-gray-700">{t.progress.value} / {t.target_value}{t.unit || ''}</b>
                        </div>
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${p}%`, background: st === 'locked' ? (t.series?.color || FALLBACK_COLOR) : '#22c55e' }}></div>
                        </div>
                        {t.progress.text && <div className="text-[11px] text-gray-400 mt-1">{t.progress.text}</div>}
                      </div>
                      <div className="flex justify-between text-[13px] py-2">
                        <span className="text-gray-400">成就奖励</span>
                        <b className="text-amber-600">{rewardText(t.rewards)}</b>
                      </div>

                      {st === 'got' ? (
                        <button onClick={() => setDetail(null)} className="w-full mt-3 py-2.5 rounded-xl bg-gray-100 text-gray-500 font-medium">
                          已点亮{fmtDate(t.claimed_at) ? ` · ${fmtDate(t.claimed_at)}` : ''}
                        </button>
                      ) : st === 'ready' ? (
                        <button
                          onClick={() => claim(t)}
                          disabled={claiming === t.id}
                          className="w-full mt-3 py-2.5 rounded-xl text-white font-semibold disabled:opacity-60"
                          style={{ background: 'linear-gradient(135deg,#f7b733,#e59a12)' }}
                        >
                          {claiming === t.id ? '领取中…' : '🎁 领取奖励'}
                        </button>
                      ) : (
                        <button onClick={() => setDetail(null)} className="w-full mt-3 py-2.5 rounded-xl bg-gray-100 text-gray-500 font-medium">
                          继续努力（还差 {Math.max(0, t.target_value - t.progress.value)}{t.unit || ''}）
                        </button>
                      )}
                    </div>
                  </>
                );
              })()}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 领取成功 */}
      <AnimatePresence>
        {reward && (
          <motion.div
            className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60]"
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
              <h3 className="text-lg font-bold text-gray-800">成就达成</h3>
              <p className="text-sm text-gray-500 mt-1">「{reward.name}」奖励已发放</p>
              <div className="mt-4 space-y-1.5">
                {reward.granted.map((g, i) => (
                  <div key={i} className="text-amber-600 font-medium text-sm">{g.label || rewardText([g])}</div>
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

export default AchievementHall;
