import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import { backendClient } from '../../../api/backendClient';

interface LeaderboardRow {
  user_id: string;
  real_name: string;
  username: string;
  class_name: string;
  best_score: number;
  best_wpm: number;
  best_accuracy: string;
  best_chapter: number;
}

export const LeaderboardView: React.FC = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [myRank, setMyRank] = useState(-1);
  const [loading, setLoading] = useState(true);

  const fetchBoard = useCallback(async () => {
    setLoading(true);
    try {
      const res = await backendClient.get('/api/typing/leaderboard');
      const d = res?.data;
      setRows(d?.rows || []);
      setMyRank(d?.my_rank ?? -1);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBoard(); }, [fetchBoard]);

  return (
    <div className="h-full flex flex-col px-5 py-4">
      <div className="shrink-0 flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-amber-300"><i className="fa-solid fa-trophy mr-2"></i>班级排行榜</h2>
        <button onClick={fetchBoard} className="px-2.5 py-1 rounded-lg text-xs bg-white/10 hover:bg-white/20 text-indigo-200 transition-colors">
          <i className="fa-solid fa-rotate-right mr-1"></i>刷新
        </button>
      </div>

      {!user ? (
        <div className="flex-1 flex items-center justify-center text-sm text-indigo-300">登录后可查看班级排行榜</div>
      ) : loading ? (
        <div className="flex-1 flex items-center justify-center text-indigo-300"><i className="fa-solid fa-circle-notch fa-spin mr-2"></i>加载中...</div>
      ) : rows.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-indigo-300">
          <p className="mb-3">还没有成绩，快去单人游戏打一局吧！</p>
          <i className="fa-solid fa-rocket text-3xl"></i>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0">
              <tr className="border-b border-indigo-400/30 text-left text-indigo-300 bg-[#101736]">
                <th className="py-2 pr-3">名次</th>
                <th className="py-2 pr-3">学生</th>
                <th className="py-2 pr-3">班级</th>
                <th className="py-2 pr-3">最高得分</th>
                <th className="py-2 pr-3">速度</th>
                <th className="py-2 pr-3">正确率</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const isMe = r.user_id === user.id;
                return (
                  <tr key={r.user_id} className={`border-b border-indigo-400/10 ${isMe ? 'bg-amber-400/10' : ''}`}>
                    <td className="py-2 pr-3">
                      <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${i < 3 ? 'bg-amber-400/20 text-amber-300' : 'bg-white/10 text-indigo-300'}`}>
                        {i + 1}
                      </span>
                    </td>
                    <td className="py-2 pr-3 font-medium">
                      {r.real_name || r.username || '未知'}
                      {isMe && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-amber-400/30 text-amber-200">我</span>}
                    </td>
                    <td className="py-2 pr-3 text-indigo-300">{r.class_name || '-'}</td>
                    <td className="py-2 pr-3 font-black text-amber-300">{r.best_score}</td>
                    <td className="py-2 pr-3 text-emerald-300">{r.best_wpm} WPM</td>
                    <td className="py-2 pr-3 text-emerald-300">{r.best_accuracy}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {myRank > 0 && (
            <div className="mt-3 text-center text-xs text-indigo-300">
              我的最佳名次：第 <b className="text-amber-300">{myRank}</b> 名
            </div>
          )}
        </div>
      )}
    </div>
  );
};
