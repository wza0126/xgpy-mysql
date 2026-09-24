// PK 结算复盘页：对比数据 + 逐题复盘 + 错题导入
import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { backendClient } from '../../../api/backendClient';
import { useAuth } from '../../../hooks/useAuth';
import { getRankInfo, renderStars, formatDuration } from './utils/pkHelpers';
import {
  normalizeOptions,
  normalizeAnswers,
  questionTypeLabel,
} from '../../../utils/questionDisplay';

interface ReviewPlayer {
  user_id: string;
  username: string;
  real_name: string;
  result: string;
  final_score: number;
  final_correct: number;
  final_wrong: number;
  final_duration_ms: number;
  rank_points_change: number;
  system_points_earned: number;
}

interface ReviewAnswer {
  user_id: string;
  question_id: string;
  answer: string | null;
  is_correct: number;
  cost_ms: number;
  question_text: string;
  question_type: string;
  correct_answer: string;
  /** 选项（包裹对象 {options:[...]} 或数组，渲染前须经 normalizeOptions 拆包） */
  options?: unknown;
  /** 解析文本 */
  explanation?: string | null;
}

/** 本局段位变化（迁移 087；平局或段位未变时该玩家没有对应行） */
interface RankChange {
  user_id: string;
  from_tier: number;
  from_stars: number;
  to_tier: number;
  to_stars: number;
  result: 'win' | 'lose' | 'draw';
}

interface ReviewData {
  room: any;
  players: ReviewPlayer[];
  answers: ReviewAnswer[];
  rank_changes?: RankChange[];
}

/** 本局掉落的装备（由 socket 的 pk:battle_end 载荷传入） */
export interface PKResultDrop {
  id: string;
  name: string;
  icon: string;
  crit_bonus: number;
}

/** 本局达成的荣誉 */
export interface PKResultHonor {
  type: string;
  name: string;
  icon?: string;
  description?: string;
}

/**
 * 本局参与类奖励明细（来自 socket 载荷 bonuses）
 * 注意：0 表示「今天已经发过」，不是「获得 0 分」，展示时必须过滤掉 0
 */
export interface PKResultBonus {
  first_battle?: number;
  daily_battles?: number;
}

export const PKResult: React.FC<{
  roomId: string;
  onBackToLobby: () => void;
  /** 本局掉落（来自 socket 载荷），结算页顶部先展示，避免学生漏看 */
  droppedEquipments?: PKResultDrop[];
  /** 本局新达成的荣誉 */
  newHonors?: PKResultHonor[];
  /** 本局参与类奖励明细（首战 / 单日满场） */
  bonuses?: PKResultBonus | null;
  /** 单日满场奖励所需场次（用于文案「单日满 N 场」） */
  dailyTarget?: number;
}> = ({
  roomId,
  onBackToLobby,
  droppedEquipments = [],
  newHonors = [],
  bonuses = null,
  dailyTarget = 0,
}) => {
  const { profile, refreshProfile } = useAuth();
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  /** 双击题干打开的题目详情（选项 / 答案 / 解析） */
  const [detailQuestion, setDetailQuestion] = useState<ReviewAnswer | null>(null);

  useEffect(() => {
    fetchReview();
    refreshProfile(); // 刷新积分
  }, [roomId]);

  const fetchReview = async () => {
    setLoading(true);
    setLoadError(false);
    const { data } = await backendClient.get(`/api/pk/history/${roomId}`);
    if (data) {
      setData(data as ReviewData);
    } else {
      setLoadError(true);
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

  if (loadError || !data) {
    return (
      <div className="p-6 text-center">
        <p className="text-gray-500">结算数据加载失败</p>
        <button
          onClick={() => {
            setData(null);
            fetchReview();
          }}
          className="mt-4 px-6 py-2 bg-purple-500 text-white rounded-lg"
        >
          重新加载
        </button>
        <button onClick={onBackToLobby} className="mt-4 ml-3 px-6 py-2 bg-gray-200 rounded-lg">
          返回列表
        </button>
      </div>
    );
  }

  const me = data.players.find((p) => p.user_id === profile?.id);
  const opp = data.players.find((p) => p.user_id !== profile?.id);

  if (!me || !opp) {
    return (
      <div className="p-6 text-center">
        <p className="text-gray-500">结算数据不完整，请重试</p>
        <button
          onClick={() => {
            setData(null);
            fetchReview();
          }}
          className="mt-4 px-6 py-2 bg-purple-500 text-white rounded-lg"
        >
          重新加载
        </button>
        <button onClick={onBackToLobby} className="mt-4 ml-3 px-6 py-2 bg-gray-200 rounded-lg">
          返回列表
        </button>
      </div>
    );
  }

  const isWin = me.result === 'win';
  const isDraw = me.result === 'draw';
  const myCorrectRate = me.final_correct + me.final_wrong > 0
    ? Math.round((me.final_correct / (me.final_correct + me.final_wrong)) * 100)
    : 0;
  const oppCorrectRate = opp.final_correct + opp.final_wrong > 0
    ? Math.round((opp.final_correct / (opp.final_correct + opp.final_wrong)) * 100)
    : 0;
  // 本局我的错题数（结算时已自动加入错题本）
  const myWrongCount = data.answers.filter(
    (a) => a.user_id === me.user_id && !a.is_correct
  ).length;

  // 本局我的段位变化（平局或未变化时没有记录）
  const myRankChange = (data.rank_changes || []).find((r) => r.user_id === me.user_id);
  const myFromRank = myRankChange ? getRankInfo(myRankChange.from_tier, myRankChange.from_stars) : null;
  const myToRank = myRankChange ? getRankInfo(myRankChange.to_tier, myRankChange.to_stars) : null;
  const tierUp = myRankChange ? myRankChange.to_tier > myRankChange.from_tier : false;
  const tierDown = myRankChange ? myRankChange.to_tier < myRankChange.from_tier : false;

  // 参与类奖励明细（首战 / 单日满场）：0 表示「今日已发过」，必须过滤，否则会误报"获得 0 分"
  const firstBattlePts = Number(bonuses?.first_battle) || 0;
  const dailyBattlesPts = Number(bonuses?.daily_battles) || 0;
  const bonusTotal = firstBattlePts + dailyBattlesPts;

  // 收集题目（去重）
  const questionMap = new Map<string, ReviewAnswer>();
  data.answers.forEach((a) => {
    if (!questionMap.has(a.question_id)) {
      questionMap.set(a.question_id, a);
    }
  });

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* 本局获得的装备与荣誉（来自 socket 载荷）—— 放在最上方，
          避免被下方复盘表格推到屏幕外而漏看 */}
      {(droppedEquipments.length > 0 || newHonors.length > 0 || bonusTotal > 0) && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 grid gap-3 md:grid-cols-2"
        >
          {/* 参与类奖励（首战 / 单日满场）—— 原先只落库不回执，学生"分了积分却不知道" */}
          {bonusTotal > 0 && (
            <div className="rounded-xl border-2 border-emerald-300 bg-gradient-to-r from-emerald-50 to-teal-50 p-4">
              <p className="text-sm font-bold text-emerald-700 mb-2">💰 本局额外奖励</p>
              <div className="flex flex-wrap gap-2">
                {firstBattlePts > 0 && (
                  <span className="flex items-center gap-1 px-3 py-1 bg-white rounded-lg border border-emerald-200 text-sm">
                    <span className="text-lg">🌅</span>
                    <span className="font-medium text-gray-800">每日首战</span>
                    <span className="font-bold text-emerald-600">+{firstBattlePts}</span>
                  </span>
                )}
                {dailyBattlesPts > 0 && (
                  <span className="flex items-center gap-1 px-3 py-1 bg-white rounded-lg border border-emerald-200 text-sm">
                    <span className="text-lg">🔥</span>
                    <span className="font-medium text-gray-800">
                      {dailyTarget > 0 ? `单日满 ${dailyTarget} 场` : '单日满场'}
                    </span>
                    <span className="font-bold text-emerald-600">+{dailyBattlesPts}</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-emerald-600 mt-2">
                共 +{bonusTotal} 积分，已计入「我的积分」（参与类奖励每日限一次）
              </p>
            </div>
          )}
          {droppedEquipments.length > 0 && (
            <div className="rounded-xl border-2 border-amber-300 bg-gradient-to-r from-amber-50 to-yellow-50 p-4">
              <p className="text-sm font-bold text-amber-700 mb-2">🎁 本局获得装备</p>
              <div className="flex flex-wrap gap-2">
                {droppedEquipments.map((eq) => (
                  <span
                    key={eq.id}
                    className="flex items-center gap-1 px-3 py-1 bg-white rounded-lg border border-amber-200 text-sm"
                  >
                    <span className="text-lg">{eq.icon || '⚔️'}</span>
                    <span className="font-medium text-gray-800">{eq.name}</span>
                    {eq.crit_bonus > 0 && (
                      <span className="text-xs text-amber-600">+{eq.crit_bonus}% 暴击</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}
          {newHonors.length > 0 && (
            <div className="rounded-xl border-2 border-purple-300 bg-gradient-to-r from-purple-50 to-fuchsia-50 p-4">
              <p className="text-sm font-bold text-purple-700 mb-2">🏅 本局达成荣誉</p>
              <div className="flex flex-wrap gap-2">
                {newHonors.map((h) => (
                  <span
                    key={h.type}
                    className="flex items-center gap-1 px-3 py-1 bg-white rounded-lg border border-purple-200 text-sm"
                    title={h.description || ''}
                  >
                    <span className="text-lg">{h.icon || '🎉'}</span>
                    <span className="font-medium text-gray-800">{h.name}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* 结果横幅 */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className={`text-center mb-8 py-8 rounded-xl ${
          isWin ? 'bg-gradient-to-r from-yellow-400 to-orange-400' : isDraw ? 'bg-gradient-to-r from-gray-300 to-gray-400' : 'bg-gradient-to-r from-blue-300 to-blue-400'
        }`}
      >
        <p className="text-4xl font-bold text-white">
          {isWin ? '🏆 胜利！' : isDraw ? '🤝 平局' : '💪 失败'}
        </p>
        <div className="flex justify-center gap-8 mt-4 text-white">
          <div>
            <p className="text-sm">段位变化</p>
            <p className="text-xl font-bold">
              {me.rank_points_change > 0 ? '+' : ''}{me.rank_points_change} PK 积分
            </p>
          </div>
          <div>
            <p className="text-sm">获得积分</p>
            <p className="text-xl font-bold">+{me.system_points_earned}</p>
          </div>
        </div>

        {/* 段位升降级（迁移 087）：只在真的变了时展示，避免"段位变化：无"的噪音 */}
        {myRankChange && myFromRank && myToRank && (
          <div className="mt-4 inline-flex items-center gap-3 px-5 py-2 bg-white/25 rounded-full text-white font-bold">
            <span>{myFromRank.icon} {myFromRank.name} {renderStars(myRankChange.from_tier, myRankChange.from_stars)}</span>
            <span className="text-lg">→</span>
            <span className={tierUp ? 'text-green-100' : tierDown ? 'text-red-100' : ''}>
              {myToRank.icon} {myToRank.name} {renderStars(myRankChange.to_tier, myRankChange.to_stars)}
            </span>
            {tierUp && <span className="px-2 py-0.5 bg-white/30 rounded-full text-xs">晋级！</span>}
            {tierDown && <span className="px-2 py-0.5 bg-black/20 rounded-full text-xs">掉段</span>}
          </div>
        )}
      </motion.div>

      {/* 数据对比卡 */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className={`rounded-xl border-2 p-4 ${isWin ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
          <p className="font-bold mb-3">{me.real_name}（{isWin ? '胜' : isDraw ? '平' : '负'}）</p>
          <div className="space-y-1 text-sm">
            <p>净得分：{me.final_score}</p>
            <p>做对：{me.final_correct} 题</p>
            <p>做错：{me.final_wrong} 题</p>
            <p>正确率：{myCorrectRate}%</p>
            <p>总耗时：{formatDuration(me.final_duration_ms)}</p>
          </div>
        </div>
        <div className="rounded-xl border-2 border-gray-200 bg-gray-50 p-4">
          <p className="font-bold mb-3">{opp.real_name}（{opp.result === 'win' ? '胜' : opp.result === 'draw' ? '平' : '负'}）</p>
          <div className="space-y-1 text-sm">
            <p>净得分：{opp.final_score}</p>
            <p>做对：{opp.final_correct} 题</p>
            <p>做错：{opp.final_wrong} 题</p>
            <p>正确率：{oppCorrectRate}%</p>
            <p>总耗时：{formatDuration(opp.final_duration_ms)}</p>
          </div>
        </div>
      </div>

      {/* 逐题复盘 */}
      <div className="bg-white rounded-xl shadow border border-gray-200 p-4 mb-6">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="font-bold">逐题复盘</h3>
          <span className="text-xs text-gray-400">双击题干可查看选项、答案与解析</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-2">题号</th>
                <th className="text-left py-2 px-2">题干摘要</th>
                <th className="text-center py-2 px-2">我</th>
                <th className="text-center py-2 px-2">对手</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(questionMap.entries()).map(([qid, ans], i) => {
                const myAns = data.answers.find((a) => a.question_id === qid && a.user_id === me.user_id);
                const oppAns = data.answers.find((a) => a.question_id === qid && a.user_id === opp.user_id);
                return (
                  <tr
                    key={qid}
                    onDoubleClick={() => setDetailQuestion(ans)}
                    title="双击查看选项、答案与解析"
                    className="border-b border-gray-100 cursor-pointer hover:bg-purple-50 transition-colors"
                  >
                    <td className="py-2 px-2">{i + 1}</td>
                    <td className="py-2 px-2 max-w-xs truncate">
                      {ans.question_text?.substring(0, 30)}...
                    </td>
                    <td className="text-center py-2 px-2">
                      {!myAns ? '—' : myAns.is_correct ? '✓' : '✗'}
                    </td>
                    <td className="text-center py-2 px-2">
                      {!oppAns ? '—' : oppAns.is_correct ? '✓' : '✗'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ===== 题目详情弹窗（双击题干打开，便于逐题讲解） ===== */}
      {detailQuestion && (() => {
        const opts = normalizeOptions(detailQuestion.options);
        const answers = normalizeAnswers(detailQuestion.correct_answer);
        const isCorrectKey = (k: string) => answers.includes(k);
        // 我的作答（用于标出"我选了哪个"）
        const myAnswerText = detailQuestion.answer;
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={() => setDetailQuestion(null)}
          >
            <div
              className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-start justify-between rounded-t-xl">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 bg-orange-100 text-orange-600 text-xs rounded font-medium">
                      {questionTypeLabel(detailQuestion.question_type)}
                    </span>
                    <span
                      className={`text-xs font-medium ${
                        detailQuestion.is_correct ? 'text-green-600' : 'text-red-600'
                      }`}
                    >
                      {detailQuestion.is_correct ? '✓ 我答对了' : '✗ 我答错了'}
                    </span>
                  </div>
                  <p className="text-gray-800 font-medium whitespace-pre-wrap break-words">
                    {detailQuestion.question_text}
                  </p>
                </div>
                <button
                  onClick={() => setDetailQuestion(null)}
                  className="ml-4 text-gray-400 hover:text-gray-700 flex-shrink-0"
                  title="关闭"
                >
                  <i className="fa-solid fa-xmark text-xl"></i>
                </button>
              </div>

              <div className="px-6 py-4">
                {opts.length > 0 ? (
                  <ul className="space-y-2 mb-4">
                    {opts.map((o) => {
                      const hit = isCorrectKey(o.key);
                      return (
                        <li
                          key={o.key}
                          className={`flex items-start gap-3 px-3 py-2 rounded-lg border ${
                            hit ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-gray-50'
                          }`}
                        >
                          <span className={`font-bold flex-shrink-0 ${hit ? 'text-green-600' : 'text-gray-500'}`}>
                            {o.key}.
                          </span>
                          <span className="text-gray-800 whitespace-pre-wrap break-words flex-1">{o.text}</span>
                          {hit && (
                            <span className="flex-shrink-0 text-green-600 text-xs font-bold">
                              <i className="fa-solid fa-check mr-1"></i>正确
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="mb-4 px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-500">
                    （本题无选项，或选项数据缺失）
                  </div>
                )}

                <div className="mb-4 px-3 py-2 rounded-lg bg-green-50 border border-green-200">
                  <p className="text-xs font-bold text-green-700 mb-1">
                    <i className="fa-solid fa-circle-check mr-1"></i>正确答案
                  </p>
                  <p className="text-sm font-medium text-green-800">
                    {answers.length > 0 ? answers.join('、') : '（答案缺失）'}
                  </p>
                </div>

                {myAnswerText && (
                  <div className="mb-4 px-3 py-2 rounded-lg bg-gray-50 border border-gray-200">
                    <p className="text-xs font-bold text-gray-600 mb-1">我的作答</p>
                    <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">{myAnswerText}</p>
                  </div>
                )}

                <div className="px-3 py-2 rounded-lg bg-blue-50 border border-blue-200">
                  <p className="text-xs font-bold text-blue-700 mb-1">
                    <i className="fa-solid fa-lightbulb mr-1"></i>解析
                  </p>
                  <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">
                    {detailQuestion.explanation || '（本题暂无解析）'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 操作按钮 */}
      <div className="flex gap-3">
        {myWrongCount > 0 ? (
          <p className="flex-1 py-3 bg-orange-50 text-orange-600 rounded-xl font-bold text-center">
            📝 本局 {myWrongCount} 道错题已自动加入错题本
          </p>
        ) : (
          <p className="flex-1 py-3 bg-green-50 text-green-600 rounded-xl font-bold text-center">
            ✅ 本局无错题
          </p>
        )}
        <button
          onClick={onBackToLobby}
          className="flex-1 py-3 bg-purple-500 hover:bg-purple-600 text-white rounded-xl font-bold"
        >
          🔁 再来一局
        </button>
        <button
          onClick={onBackToLobby}
          className="flex-1 py-3 bg-gray-200 hover:bg-gray-300 rounded-xl font-bold"
        >
          ← 返回列表
        </button>
      </div>
    </div>
  );
};
