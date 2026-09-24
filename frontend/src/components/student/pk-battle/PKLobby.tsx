// PK 对战列表页：段位卡 + 模式选择 + 匹配/创建/加入 + 排行榜/荣誉/对战历史
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { backendClient } from '../../../api/backendClient';
import { useAuth } from '../../../hooks/useAuth';
import { getRankInfo, renderStars, getRankColorClass } from './utils/pkHelpers';

const HISTORY_PAGE_SIZE = 10;

/** PK 专属荣誉（与后端 pk-socket/pkHonors.js 的 PK_HONORS 一一对应） */
const PK_HONOR_LIST = [
  { type: 'pk_streak_3', name: '连胜达人', icon: '🔥', field: 'pk_streak_3_times', desc: '累计达成 3 连胜（每满 3 场计一次）' },
  { type: 'pk_flawless', name: '零失误', icon: '💎', field: 'pk_flawless_times', desc: '单局全部答对且至少作答 1 题' },
  { type: 'pk_comeback', name: '愈战愈勇', icon: '🚀', field: 'pk_comeback_times', desc: '中场落后但最终反超获胜' },
] as const;

/** 荣誉与战绩摘要（/api/student/honors 的子集） */
interface HonorStatsLite {
  total: number;
  wins: number;
  winStreak: number;
  pk_streak_3_times: number;
  pk_flawless_times: number;
  pk_comeback_times: number;
}

/** 对战历史单条（/api/pk/history） */
interface HistoryRow {
  id: string;
  room_code: string;
  created_at: string;
  result: 'win' | 'lose' | 'draw';
  final_score: number;
  final_correct: number;
  final_wrong: number;
  rank_points_change: number;
  system_points_earned: number;
  bonus_points: number;
  config_name: string | null;
  opp_real_name: string | null;
  opp_username: string | null;
  opp_final_score: number | null;
  from_tier: number | null;
  from_stars: number | null;
  to_tier: number | null;
  to_stars: number | null;
}

/** 对战时间：今天显示时刻，其余显示月-日 时:分 */
const fmtBattleTime = (raw: string): string => {
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (sameDay) return `今天 ${hh}:${mm}`;
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  return `${M}-${D} ${hh}:${mm}`;
};

interface PKProfile {
  tier: number;
  stars: number;
  pk_points: number;
  battles_today: number;
  total_wins: number;
  total_losses: number;
  total_draws: number;
  class_enabled: boolean;
  correct_count: number;
}

interface LeaderEntry {
  id: string;
  username: string;
  real_name: string;
  pk_rank_tier: number;
  pk_rank_stars: number;
  pk_points: number;
}

interface ActiveConfig {
  id: string;
  name: string;
  mode: string;
  duration_seconds: number;
  question_count: number;
  daily_limit: number | null;
  qualification_correct_count: number | null;
  qualification_mastered_count: number | null;
  qualification_mastered_clusters: string[] | string | null;
}

export const PKLobby: React.FC<{
  onMatchQuick: (configId?: string) => void;
  onCreateRoom: (configId?: string) => void;
  onJoinRoom: (code: string) => void;
  matchSearching: boolean;
  hasStoredRoom?: boolean;
  onResumeBattle?: () => void;
  onCancelMatch: () => void;
}> = ({
  onMatchQuick,
  onCreateRoom,
  onJoinRoom,
  matchSearching,
  hasStoredRoom = false,
  onResumeBattle,
  onCancelMatch,
}) => {
  const { profile } = useAuth();
  const [pkProfile, setPkProfile] = useState<PKProfile | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderEntry[]>([]);
  const [activeConfigs, setActiveConfigs] = useState<ActiveConfig[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState<string | undefined>(undefined);
  const [roomCode, setRoomCode] = useState('');
  const [loading, setLoading] = useState(true);
  /** 资格明细：config_id -> { passed, correct:{...}, mastered:{...} }（服务端裁定，口径唯一） */
  const [qualificationMap, setQualificationMap] = useState<Record<string, any>>({});

  // ===== 数据面板页签：排行榜 / 我的荣誉 / 对战历史 =====
  const [panelTab, setPanelTab] = useState<'rank' | 'honor' | 'history'>('rank');
  /** 我的荣誉与战绩（来自 /api/student/honors） */
  const [honorStats, setHonorStats] = useState<HonorStatsLite>({
    total: 0, wins: 0, winStreak: 0,
    pk_streak_3_times: 0, pk_flawless_times: 0, pk_comeback_times: 0,
  });
  const [historyList, setHistoryList] = useState<HistoryRow[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  // 切到「对战历史」页签或翻页时按需拉取（首屏不为不可见面板发请求）
  useEffect(() => {
    if (panelTab === 'history') fetchHistory(historyPage);
  }, [panelTab, historyPage]);

  // 荣誉数据随页签切换拉取一次，保证刚打完一局回来能看到最新次数
  useEffect(() => {
    if (panelTab === 'honor') fetchHonors();
  }, [panelTab]);

  const fetchHonors = async () => {
    const { data } = await backendClient.get('/api/student/honors');
    if (data) {
      const d = data as any;
      setHonorStats({
        total: Number(d.pk_total_battles) || 0,
        wins: Number(d.pk_total_wins) || 0,
        winStreak: Number(d.pk_win_streak) || 0,
        pk_streak_3_times: Number(d.pk_streak_3_times) || 0,
        pk_flawless_times: Number(d.pk_flawless_times) || 0,
        pk_comeback_times: Number(d.pk_comeback_times) || 0,
      });
    }
  };

  const fetchHistory = async (page: number) => {
    setHistoryLoading(true);
    const { data } = await backendClient.get(
      `/api/pk/history?page=${page + 1}&pageSize=${HISTORY_PAGE_SIZE}`
    );
    if (data) {
      const d = data as any;
      setHistoryList((d.list || []) as HistoryRow[]);
      setHistoryTotal(Number(d.total) || 0);
    }
    setHistoryLoading(false);
  };

  const fetchData = async () => {
    setLoading(true);
    const [profileRes, lbRes, cfgRes] = await Promise.all([
      backendClient.get('/api/pk/profile'),
      backendClient.get('/api/pk/leaderboard'),
      backendClient.get('/api/pk/battle-configs/active'),
    ]);
    if (profileRes.data) setPkProfile(profileRes.data as PKProfile);
    if (lbRes.data) setLeaderboard(lbRes.data as LeaderEntry[]);
    if (cfgRes.data) {
      const cfgs = cfgRes.data as ActiveConfig[];
      setActiveConfigs(cfgs);
      if (cfgs.length > 0) setSelectedConfigId(cfgs[0].id);
      // 拉取各配置的资格明细（两项条件由服务端裁定）
      const entries = await Promise.all(
        cfgs.map(async (c) => {
          try {
            const r = await backendClient.get(`/api/student/qualification/pk/${c.id}`);
            return [c.id, r?.data || null] as const;
          } catch {
            return [c.id, null] as const;
          }
        })
      );
      const map: Record<string, any> = {};
      entries.forEach(([id, detail]) => { if (detail) map[id] = detail; });
      setQualificationMap(map);
    }
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <i className="fa-solid fa-circle-notch fa-spin text-3xl text-purple-500"></i>
      </div>
    );
  }

  // 班级未开启
  if (pkProfile && !pkProfile.class_enabled) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8">
        <i className="fa-solid fa-lock text-5xl text-gray-400 mb-4"></i>
        <p className="text-xl text-gray-600">班级未开启 PK 对战</p>
        <p className="text-sm text-gray-400 mt-2">请联系教师开启</p>
      </div>
    );
  }

  const selectedConfig = activeConfigs.find((c) => c.id === selectedConfigId);

  // 资格验证：做对题数与已掌握题数两项需同时满足（服务端裁定，口径唯一）
  const qual = selectedConfig ? qualificationMap[selectedConfig.id] : null;
  const qualRequired = selectedConfig?.qualification_correct_count || 0;
  const myCorrect = pkProfile?.correct_count || 0;
  // 兜底：资格明细尚未返回时，用旧的做对题数规则先做一次初步判断，避免出现"可点但必失败"
  const qualPassed = qual
    ? qual.passed
    : (qualRequired <= 0 || myCorrect >= qualRequired);

  // 今日次数已满
  const dailyLimit = selectedConfig?.daily_limit || activeConfigs[0]?.daily_limit || 20;
  if (pkProfile && pkProfile.battles_today >= dailyLimit) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8">
        <i className="fa-solid fa-clock text-5xl text-gray-400 mb-4"></i>
        <p className="text-xl text-gray-600">今日对战次数已用完</p>
        <p className="text-sm text-gray-400 mt-2">
          今日已对战 {pkProfile.battles_today}/{dailyLimit} 场，明日再来
        </p>
      </div>
    );
  }

  const rankInfo = pkProfile ? getRankInfo(pkProfile.tier, pkProfile.stars) : null;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* 断线恢复入口 */}
      {hasStoredRoom && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 p-4 text-white shadow-lg flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <span className="text-3xl">⚔️</span>
            <div>
              <p className="font-bold text-lg">有进行中的对局</p>
              <p className="text-sm text-white/80">上次对战尚未结束，点击恢复后继续</p>
            </div>
          </div>
          <button
            onClick={onResumeBattle}
            className="px-5 py-2 bg-white text-red-600 rounded-lg font-bold hover:bg-red-50 shrink-0"
          >
            恢复对局
          </button>
        </motion.div>
      )}

      {/* 段位卡 */}
      {rankInfo && pkProfile && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`rounded-xl border-2 p-6 mb-6 ${getRankColorClass(rankInfo.color)}`}
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3">
                <span className="text-3xl">{rankInfo.icon}</span>
                <div>
                  <p className="text-lg font-bold">{rankInfo.name}</p>
                  <p className="text-2xl">{renderStars(pkProfile.tier, pkProfile.stars)}</p>
                </div>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm">PK 积分</p>
              <p className="text-2xl font-bold">{pkProfile.pk_points}</p>
            </div>
          </div>
          <div className="flex gap-4 mt-4 text-sm">
            <span className="px-3 py-1 bg-white/50 rounded-full">
              今日 {pkProfile.battles_today}/{dailyLimit} 场
            </span>
            <span className="px-3 py-1 bg-white/50 rounded-full">
              {pkProfile.total_wins}胜 {pkProfile.total_losses}负 {pkProfile.total_draws}平
            </span>
          </div>
        </motion.div>
      )}

      {/* 今日次数徽章 */}
      <div className="flex justify-end mb-2">
        <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm">
          今日 {pkProfile?.battles_today || 0}/{dailyLimit} 场
        </span>
      </div>

      {/* 模式选择 */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="relative group">
          <div className="border-2 border-purple-300 bg-purple-50 rounded-xl p-4 text-center cursor-help">
            <i className="fa-solid fa-stopwatch text-2xl text-purple-600 mb-2"></i>
            <p className="font-bold text-purple-700">⏱ 限时答题</p>
            <p className="text-xs text-gray-500 mt-1">可用</p>
          </div>
          {/* 悬浮规则说明 */}
          <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-3 w-72 z-20 hidden group-hover:block">
            <div className="bg-gray-900 text-white text-xs rounded-xl shadow-xl p-4">
              <p className="font-bold text-sm mb-2 text-purple-300">⏱ 限时答题对战规则</p>
              <ul className="space-y-1.5 text-gray-200">
                <li>· 2 人对战，双方拿到同一套题，同时开始答题</li>
                <li>· 全局倒计时，做对 +1 分，做错 -1 分</li>
                <li>· 时间结束统一收卷，得分高者胜，平分比总耗时</li>
                <li>· 一方掉线超 60 秒判负，可中途投降</li>
                <li>· 赢方加 PK 积分与段位星，错题自动收入错题集</li>
              </ul>
            </div>
            <div className="w-0 h-0 border-l-8 border-r-8 border-t-8 border-l-transparent border-r-transparent border-t-gray-900 mx-auto"></div>
          </div>
        </div>
        <div className="border-2 border-gray-200 bg-gray-50 rounded-xl p-4 text-center opacity-60">
          <i className="fa-solid fa-bolt text-2xl text-gray-400 mb-2"></i>
          <p className="font-bold text-gray-500">⚡ 抢答模式</p>
          <p className="text-xs text-gray-400 mt-1">敬请期待</p>
        </div>
      </div>

      {/* 对战活动选择（多个配置时才显示） */}
      {activeConfigs.length > 1 && (
        <div className="mb-6">
          <p className="text-sm font-bold text-gray-600 mb-2">
            <i className="fa-solid fa-trophy mr-1"></i>选择对战活动
          </p>
          <div className="grid grid-cols-2 gap-3">
            {activeConfigs.map((cfg) => {
              const active = selectedConfigId === cfg.id;
              return (
                <button
                  key={cfg.id}
                  onClick={() => setSelectedConfigId(cfg.id)}
                  className={`text-left p-3 rounded-xl border-2 transition ${
                    active
                      ? 'border-purple-500 bg-purple-50 ring-2 ring-purple-200'
                      : 'border-gray-200 bg-white hover:border-purple-300'
                  }`}
                >
                  <p className="font-bold text-sm text-gray-800 truncate">{cfg.name}</p>
                  <div className="flex gap-3 mt-1 text-xs text-gray-500">
                    <span><i className="fa-regular fa-clock mr-1"></i>{Math.floor(cfg.duration_seconds / 60)}分钟</span>
                    <span><i className="fa-solid fa-list-ol mr-1"></i>{cfg.question_count}题</span>
                    {cfg.daily_limit && (
                      <span><i className="fa-solid fa-calendar-day mr-1"></i>日限{cfg.daily_limit}</span>
                    )}
                    {!!cfg.qualification_correct_count && cfg.qualification_correct_count > 0 && (
                      <span className="text-blue-600">
                        <i className="fa-solid fa-shield-halved mr-1"></i>需做对{cfg.qualification_correct_count}题
                      </span>
                    )}
                    {!!cfg.qualification_mastered_count && cfg.qualification_mastered_count > 0 && (
                      <span className="text-blue-600">
                        <i className="fa-solid fa-graduation-cap mr-1"></i>需掌握{cfg.qualification_mastered_count}题
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 操作按钮 */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        {matchSearching ? (
          <motion.button
            onClick={onCancelMatch}
            className="col-span-2 bg-red-500 hover:bg-red-600 text-white font-bold py-4 rounded-xl text-lg"
            animate={{ opacity: [1, 0.7, 1] }}
            transition={{ repeat: Infinity, duration: 1.5 }}
          >
            <i className="fa-solid fa-spinner fa-spin mr-2"></i>
            正在匹配对手... 点击取消
          </motion.button>
        ) : (
          <button
            onClick={() => qualPassed && onMatchQuick(selectedConfigId)}
            disabled={!qualPassed}
            className={`${
              qualPassed
                ? 'bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600'
                : 'bg-gray-300 cursor-not-allowed'
            } text-white font-bold py-4 rounded-xl text-lg shadow-lg`}
          >
            🎯 快速匹配
          </button>
        )}
        <button
          onClick={() => qualPassed && onCreateRoom(selectedConfigId)}
          disabled={!qualPassed}
          className={`${
            qualPassed
              ? 'bg-white border-2 border-purple-300 hover:bg-purple-50 text-purple-700'
              : 'bg-gray-100 border-2 border-gray-200 text-gray-400 cursor-not-allowed'
          } font-bold py-4 rounded-xl text-lg`}
        >
          🏠 创建房间
        </button>
      </div>

      {/* 资格不足提示（两项条件分别列出未达标项） */}
      {!qualPassed && (qual?.correct?.enabled || qual?.mastered?.enabled || qualRequired > 0) && (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700 space-y-1">
          <p className="font-medium">
            <i className="fa-solid fa-shield-halved mr-2"></i>
            参加该对战需同时满足以下资格：
          </p>
          {qual ? (
            <>
              {qual.correct?.enabled && (
                <p className="pl-6">
                  · 累计做对 <b>{qual.correct.required}</b> 道题（当前 <b>{qual.correct.current}</b> 道）
                  {qual.correct.passed ? ' ✓' : ''}
                </p>
              )}
              {qual.mastered?.enabled && (
                <p className="pl-6">
                  · 掌握 <b>{qual.mastered.required}</b> 道题
                  {qual.mastered.clusters?.length > 0 ? `（范围：${qual.mastered.clusters.join('/')}）` : '（全部范围）'}
                  （当前 <b>{qual.mastered.current}</b> 道）
                  {qual.mastered.passed ? ' ✓' : ''}
                </p>
              )}
            </>
          ) : (
            <p className="pl-6">· 累计做对 <b>{qualRequired}</b> 道题（当前 <b>{myCorrect}</b> 道）</p>
          )}
          <p className="pl-6 text-amber-600">去练习模块继续加油！</p>
        </div>
      )}

      {/* 房间码加入 */}
      <div className="flex gap-2 mb-6">
        <input
          type="text"
          maxLength={4}
          value={roomCode}
          onChange={(e) => setRoomCode(e.target.value.replace(/\D/g, ''))}
          placeholder="输入4位房间码"
          className="flex-1 px-4 py-3 border-2 border-gray-300 rounded-xl text-center text-2xl tracking-widest"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && roomCode.length === 4) onJoinRoom(roomCode);
          }}
        />
        <button
          onClick={() => roomCode.length === 4 && onJoinRoom(roomCode)}
          disabled={roomCode.length !== 4}
          className="px-6 py-3 bg-purple-500 hover:bg-purple-600 text-white rounded-xl disabled:bg-gray-300"
        >
          加入
        </button>
      </div>

      {/* ===== 数据面板：排行榜 / 我的荣誉 / 对战历史 ===== */}
      <div className="bg-white rounded-xl shadow border border-gray-200">
        <div className="flex border-b border-gray-200">
          {([
            { key: 'rank', label: '🏆 积分排行榜' },
            { key: 'honor', label: '🏅 我的荣誉' },
            { key: 'history', label: '📜 对战历史' },
          ] as const).map((t) => (
            <button
              key={t.key}
              onClick={() => setPanelTab(t.key)}
              className={`px-5 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                panelTab === t.key
                  ? 'border-purple-500 text-purple-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-4">
          {/* ---- 排行榜 ---- */}
          {panelTab === 'rank' && (
            <>
              {leaderboard.length === 0 ? (
                <p className="text-center text-gray-400 py-4">暂无数据</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {leaderboard.map((entry, i) => {
                    const info = getRankInfo(entry.pk_rank_tier, entry.pk_rank_stars);
                    const isMe = entry.id === profile?.id;
                    return (
                      <div
                        key={entry.id}
                        className={`flex items-center gap-3 p-2 rounded-lg ${
                          isMe ? 'bg-purple-100 border border-purple-300' : 'bg-gray-50'
                        }`}
                      >
                        <span className={`font-bold w-8 ${i < 3 ? 'text-yellow-500' : 'text-gray-400'}`}>
                          {i + 1}
                        </span>
                        <span className="text-xl">{info.icon}</span>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">
                            {entry.real_name || '—'}
                            {entry.username && (
                              <span className="ml-2 text-xs text-gray-400 font-normal">
                                {entry.username}
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-gray-500">
                            {info.name} {renderStars(entry.pk_rank_tier, entry.pk_rank_stars)}
                          </p>
                        </div>
                        <span className="font-bold text-purple-600">{entry.pk_points}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* ---- 我的荣誉 ---- */}
          {panelTab === 'honor' && (
            <div>
              {/* 战绩概览：胜场/胜率/连胜/已获得荣誉数 */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                {[
                  { label: 'PK 总场次', value: honorStats.total, icon: '⚔️', color: 'text-blue-600' },
                  { label: '胜场', value: honorStats.wins, icon: '🏆', color: 'text-amber-600' },
                  {
                    label: '胜率',
                    value: honorStats.total > 0 ? `${Math.round((honorStats.wins / honorStats.total) * 100)}%` : '—',
                    icon: '📊', color: 'text-purple-600',
                  },
                  { label: '当前连胜', value: honorStats.winStreak, icon: '🔥', color: 'text-red-600' },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg bg-gray-50 border border-gray-200 p-3 text-center">
                    <p className="text-lg">{s.icon}</p>
                    <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                    <p className="text-xs text-gray-500 mt-1">{s.label}</p>
                  </div>
                ))}
              </div>

              {/* PK 专属荣誉（3 项）：达成次数 > 0 即点亮 */}
              <p className="text-xs font-bold text-gray-600 mb-2">PK 专属荣誉</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {PK_HONOR_LIST.map((h) => {
                  const times = honorStats[h.field] || 0;
                  const owned = times > 0;
                  return (
                    <div
                      key={h.type}
                      className={`rounded-lg border-2 p-3 ${
                        owned ? 'border-purple-300 bg-purple-50' : 'border-gray-200 bg-gray-50 opacity-60'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-2xl">{h.icon}</span>
                        <span className="font-bold text-gray-800">{h.name}</span>
                        {owned && (
                          <span className="ml-auto text-xs font-bold text-purple-600">
                            ×{times}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500">{h.desc}</p>
                      {!owned && (
                        <p className="text-xs text-gray-400 mt-1">
                          <i className="fa-solid fa-lock mr-1"></i>未达成
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ---- 对战历史 ---- */}
          {panelTab === 'history' && (
            <div>
              {historyLoading ? (
                <p className="text-center text-gray-400 py-6">
                  <i className="fa-solid fa-circle-notch fa-spin mr-2"></i>加载中…
                </p>
              ) : historyList.length === 0 ? (
                <p className="text-center text-gray-400 py-6">还没有对战记录，快去打一局吧！</p>
              ) : (
                <>
                  <div className="space-y-2">
                    {historyList.map((h) => {
                      const win = h.result === 'win';
                      const draw = h.result === 'draw';
                      // 段位变化只存在于「真的变了」的局，此时 from/to 一并非空
                      const toRank = h.to_tier != null
                        ? getRankInfo(Number(h.to_tier), Number(h.to_stars) || 0) : null;
                      const fromRank = h.from_tier != null
                        ? getRankInfo(Number(h.from_tier), Number(h.from_stars) || 0) : null;
                      const tierUp = !!fromRank && !!toRank && Number(h.to_tier) > Number(h.from_tier);
                      const tierDown = !!fromRank && !!toRank && Number(h.to_tier) < Number(h.from_tier);
                      return (
                        <div
                          key={h.id}
                          className={`flex items-center gap-3 p-2.5 rounded-lg border ${
                            win ? 'border-green-200 bg-green-50'
                              : draw ? 'border-gray-200 bg-gray-50' : 'border-red-200 bg-red-50'
                          }`}
                        >
                          <span className={`w-10 text-center font-bold text-sm ${
                            win ? 'text-green-600' : draw ? 'text-gray-500' : 'text-red-500'
                          }`}>
                            {win ? '胜' : draw ? '平' : '负'}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800 truncate">
                              vs {h.opp_real_name || '对手已注销'}
                              {h.opp_username && (
                                <span className="ml-2 text-xs text-gray-400 font-normal">
                                  {h.opp_username}
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-gray-500">
                              比分 {h.final_score} : {h.opp_final_score ?? '—'}
                              {' · '}
                              做对 {h.final_correct}/{h.final_correct + h.final_wrong}
                              {h.config_name && ` · ${h.config_name}`}
                              {' · '}{fmtBattleTime(h.created_at)}
                            </p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className={`text-xs font-medium ${
                              h.rank_points_change > 0 ? 'text-green-600'
                                : h.rank_points_change < 0 ? 'text-red-500' : 'text-gray-400'
                            }`}>
                              {h.rank_points_change > 0 ? '+' : ''}{h.rank_points_change} PK
                            </p>
                            {(Number(h.system_points_earned) || 0) + (Number(h.bonus_points) || 0) > 0 && (
                              <p className="text-xs text-amber-600">
                                +{(Number(h.system_points_earned) || 0) + (Number(h.bonus_points) || 0)} 积分
                              </p>
                            )}
                            {toRank && (
                              <p className="text-xs text-gray-500">
                                {toRank.icon} {toRank.name}
                                {tierUp && <span className="ml-1 text-green-600 font-bold">↑</span>}
                                {tierDown && <span className="ml-1 text-red-500 font-bold">↓</span>}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* 分页 */}
                  {historyTotal > HISTORY_PAGE_SIZE && (
                    <div className="flex items-center justify-center gap-3 mt-4">
                      <button
                        onClick={() => setHistoryPage((p) => Math.max(0, p - 1))}
                        disabled={historyPage === 0}
                        className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
                      >
                        上一页
                      </button>
                      <span className="text-xs text-gray-500">
                        {historyPage + 1} / {Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE_SIZE))}
                      </span>
                      <button
                        onClick={() => setHistoryPage((p) => p + 1)}
                        disabled={(historyPage + 1) * HISTORY_PAGE_SIZE >= historyTotal}
                        className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
                      >
                        下一页
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
