// PK 结算复盘页：对比数据 + 逐题复盘 + 错题导入
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { backendClient } from '../../../api/backendClient';
import { useAuth } from '../../../hooks/useAuth';
import { getRankInfo, renderStars, formatDuration } from './utils/pkHelpers';

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
}

interface ReviewData {
  room: any;
  players: ReviewPlayer[];
  answers: ReviewAnswer[];
}

export const PKResult: React.FC<{
  roomId: string;
  onBackToLobby: () => void;
}> = ({ roomId, onBackToLobby }) => {
  const { profile, refreshProfile } = useAuth();
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

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

  // 收集题目（去重）
  const questionMap = new Map<string, ReviewAnswer>();
  data.answers.forEach((a) => {
    if (!questionMap.has(a.question_id)) {
      questionMap.set(a.question_id, a);
    }
  });

  return (
    <div className="p-6 max-w-4xl mx-auto">
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
        <h3 className="font-bold mb-3">逐题复盘</h3>
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
                  <tr key={qid} className="border-b border-gray-100">
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
