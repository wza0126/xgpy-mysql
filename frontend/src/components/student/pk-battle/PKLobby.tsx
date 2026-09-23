// PK 对战列表页：段位卡 + 模式选择 + 匹配/创建/加入 + 排行榜
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { backendClient } from '../../../api/backendClient';
import { useAuth } from '../../../hooks/useAuth';
import { getRankInfo, renderStars, getRankColorClass } from './utils/pkHelpers';

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

  useEffect(() => {
    fetchData();
  }, []);

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

      {/* 排行榜 */}
      <div className="bg-white rounded-xl shadow border border-gray-200 p-4">
        <h3 className="font-bold text-gray-800 mb-3">
          🏆 PK 积分排行榜
        </h3>
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
      </div>
    </div>
  );
};
