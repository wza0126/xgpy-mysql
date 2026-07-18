import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { backendClient } from '../../api/backendClient';
import { API_CONFIG } from '../../api/config';
import { useAuth } from '../../hooks/useAuth';
import { PET_STAGE_NAMES } from '../../types';

interface LeaderboardItem {
  student_id: string;
  username: string;
  real_name: string;
  class_id: string;
  class_name: string;
  total_answers: number;
  correct_answers: number;
  accuracy: number;
  current_points: number;
  max_points: number;
  total_points_earned: number;
  perfect_10_times: number;
  pet_level: number;
  pet_growth: number;
}

type SortField = 'total_answers' | 'correct_answers' | 'accuracy' | 'total_points_earned' | 'pet_growth' | 'perfect_10_times';

export const Leaderboard: React.FC = () => {
  const { profile } = useAuth();
  const [data, setData] = useState<LeaderboardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<SortField>('total_points_earned');
  const [sortDesc, setSortDesc] = useState(true);
  const [selectedStudent, setSelectedStudent] = useState<LeaderboardItem | null>(null);
  const [lastUpdateTime, setLastUpdateTime] = useState<string>('');
  const [maxStage, setMaxStage] = useState(5);

  useEffect(() => {
    if (profile) {
      fetchLeaderboardData();
    }
  }, [profile]);

  const fetchLeaderboardData = async () => {
    setLoading(true);
    try {
      const [response, { data: configData }] = await Promise.all([
        fetch(`${API_CONFIG.apiUrl}/api/leaderboard`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filterType: 'class',
            classId: profile?.class_id,
          }),
        }),
        backendClient.from('pet_config').select('*').maybeSingle(),
      ]);

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || '获取数据失败');
      }

      const fetchedData = result.data || [];
      setData(fetchedData);
      setLastUpdateTime(new Date().toLocaleTimeString());

      if (configData) {
        setMaxStage(configData.max_stage || 5);
      }
    } catch (error) {
      console.error('获取排行榜数据失败:', error);
    }
    setLoading(false);
  };

  const handleRefresh = () => {
    fetchLeaderboardData();
  };

  const sortedData = useMemo(() => {
    const sorted = [...data].sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];
      
      // 主排序逻辑
      let comparison = sortDesc ? (bVal - aVal) : (aVal - bVal);
      
      // 如果主排序键相等，则使用学生ID作为次要排序键（稳定排序）
      if (comparison === 0) {
        // 使用字符串比较来确保ID的排序一致性
        return a.student_id.localeCompare(b.student_id);
      }
      
      return comparison;
    });
    return sorted;
  }, [data, sortField, sortDesc]);

  const myRank = useMemo(() => {
    if (!profile) return null;
    const index = sortedData.findIndex((item) => item.student_id === profile.id);
    return index >= 0 ? index + 1 : null;
  }, [sortedData, profile]);

  const myData = useMemo(() => {
    if (!profile) return null;
    return data.find((item) => item.student_id === profile.id);
  }, [data, profile]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDesc(!sortDesc);
    } else {
      setSortField(field);
      setSortDesc(true);
    }
  };

  const getRankStyle = (rank: number) => {
    if (rank === 1) return 'bg-yellow-100 text-yellow-700 border-yellow-300';
    if (rank === 2) return 'bg-gray-100 text-gray-600 border-gray-300';
    if (rank === 3) return 'bg-orange-100 text-orange-700 border-orange-300';
    if (rank <= 10) return 'bg-blue-50 text-blue-600 border-blue-200';
    return 'bg-white text-gray-500 border-gray-100';
  };

  const getRankIcon = (rank: number) => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return rank;
  };

  const getPetStageName = (level: number) => {
    const stage = Math.min(level, maxStage);
    return PET_STAGE_NAMES[stage - 1] || `阶段${stage}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <i className="fa-solid fa-circle-notch fa-spin text-3xl text-blue-500"></i>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-50">
      <div className="bg-white border-b border-gray-200 p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <span className="text-2xl">🏆</span>
            本班排行榜
          </h2>
          <button
            onClick={handleRefresh}
            className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-sm hover:bg-blue-100 transition-colors flex items-center gap-1"
            title="刷新数据"
          >
            <i className="fa-solid fa-rotate"></i>
            刷新
          </button>
        </div>
        <p className="text-xs text-gray-400 flex items-center gap-1">
          <i className="fa-solid fa-sync"></i>
          实时更新中: {lastUpdateTime}
        </p>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="grid grid-cols-12 gap-2 p-3 bg-gray-50 text-xs font-medium text-gray-600 border-b border-gray-200">
            <div className="col-span-1 text-center">排名</div>
            <div className="col-span-2">姓名</div>
            <button
              onClick={() => handleSort('total_answers')}
              className={`col-span-1 text-center flex items-center justify-center gap-1 hover:text-blue-600 ${
                sortField === 'total_answers' ? 'text-blue-600' : ''
              }`}
            >
              <i className="fa-solid fa-pen"></i>
              做题
              {sortField === 'total_answers' && (
                <i className={`fa-solid fa-sort-${sortDesc ? 'down' : 'up'}`}></i>
              )}
            </button>
            <button
              onClick={() => handleSort('correct_answers')}
              className={`col-span-1 text-center flex items-center justify-center gap-1 hover:text-teal-600 ${
                sortField === 'correct_answers' ? 'text-teal-600' : ''
              }`}
            >
              <i className="fa-solid fa-check"></i>
              做对
              {sortField === 'correct_answers' && (
                <i className={`fa-solid fa-sort-${sortDesc ? 'down' : 'up'}`}></i>
              )}
            </button>
            <button
              onClick={() => handleSort('accuracy')}
              className={`col-span-2 text-center flex items-center justify-center gap-1 hover:text-green-600 ${
                sortField === 'accuracy' ? 'text-green-600' : ''
              }`}
            >
              <i className="fa-solid fa-chart-pie"></i>
              正确率
              {sortField === 'accuracy' && (
                <i className={`fa-solid fa-sort-${sortDesc ? 'down' : 'up'}`}></i>
              )}
            </button>
            <button
              onClick={() => handleSort('total_points_earned')}
              className={`col-span-2 text-center flex items-center justify-center gap-1 hover:text-purple-600 ${
                sortField === 'total_points_earned' ? 'text-purple-600' : ''
              }`}
            >
              <i className="fa-solid fa-gem"></i>
              总积分
              {sortField === 'total_points_earned' && (
                <i className={`fa-solid fa-sort-${sortDesc ? 'down' : 'up'}`}></i>
              )}
            </button>
            <button
              onClick={() => handleSort('perfect_10_times')}
              className={`col-span-1 text-center flex items-center justify-center gap-1 hover:text-green-600 ${
                sortField === 'perfect_10_times' ? 'text-green-600' : ''
              }`}
            >
              🏆
              十全
              {sortField === 'perfect_10_times' && (
                <i className={`fa-solid fa-sort-${sortDesc ? 'down' : 'up'}`}></i>
              )}
            </button>
            <button
              onClick={() => handleSort('pet_growth')}
              className={`col-span-2 text-center flex items-center justify-center gap-1 hover:text-orange-600 ${
                sortField === 'pet_growth' ? 'text-orange-600' : ''
              }`}
            >
              <i className="fa-solid fa-paw"></i>
              萌宠成长
              {sortField === 'pet_growth' && (
                <i className={`fa-solid fa-sort-${sortDesc ? 'down' : 'up'}`}></i>
              )}
            </button>
          </div>

          <div className="divide-y divide-gray-100">
            {sortedData.map((item, index) => {
              const rank = index + 1;
              const isMe = item.student_id === profile?.id;
              return (
                <motion.div
                  key={item.student_id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.03 }}
                  onClick={() => setSelectedStudent(item)}
                  className={`grid grid-cols-12 gap-2 p-3 items-center cursor-pointer hover:bg-gray-50 transition-colors ${
                    isMe ? 'bg-blue-50/50 border-l-4 border-blue-500' : ''
                  }`}
                >
                  <div className="col-span-1 text-center">
                    <span
                      className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold border ${
                        rank <= 3
                          ? 'text-lg'
                          : rank <= 10
                          ? 'bg-gray-100 text-gray-600'
                          : 'text-gray-400'
                      }`}
                    >
                      {getRankIcon(rank)}
                    </span>
                  </div>
                  <div className="col-span-2 font-medium text-gray-800 truncate">
                    {item.real_name}
                  </div>
                  <div className="col-span-1 text-center text-blue-600 font-medium">
                    {item.total_answers}
                  </div>
                  <div className="col-span-1 text-center text-teal-600 font-medium">
                    {item.correct_answers}
                  </div>
                  <div className="col-span-2 text-center text-green-600 font-medium">
                    {item.accuracy}%
                  </div>
                  <div className="col-span-2 text-center text-purple-600 font-medium">
                    {item.total_points_earned}
                  </div>
                  <div className="col-span-1 text-center text-green-600 font-medium">
                    {item.perfect_10_times || 0}
                  </div>
                  <div className="col-span-2 text-center text-orange-600 font-medium text-xs">
                    {item.pet_growth}成长值
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>

      {myData && myRank && (
        <div className="bg-white border-t border-gray-200 p-4 shadow-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl font-bold text-blue-600">#{myRank}</span>
              <span className="font-medium text-gray-800">我的排名</span>
            </div>
            <div className="flex gap-6 text-sm">
              <div className="text-center">
                <span className="text-blue-600 font-bold">{myData.total_answers}</span>
                <span className="text-gray-400 text-xs ml-1">做题</span>
              </div>
              <div className="text-center">
                <span className="text-teal-600 font-bold">{myData.correct_answers}</span>
                <span className="text-gray-400 text-xs ml-1">做对</span>
              </div>
              <div className="text-center">
                <span className="text-green-600 font-bold">{myData.accuracy}%</span>
                <span className="text-gray-400 text-xs ml-1">正确率</span>
              </div>
              <div className="text-center">
                <span className="text-purple-600 font-bold">{myData.total_points_earned}</span>
                <span className="text-gray-400 text-xs ml-1">总积分</span>
              </div>
              <div className="text-center">
                <span className="text-green-600 font-bold">{myData.perfect_10_times || 0}</span>
                <span className="text-gray-400 text-xs ml-1">十全十美</span>
              </div>
              <div className="text-center">
                <span className="text-orange-600 font-bold">{myData.pet_growth}</span>
                <span className="text-gray-400 text-xs ml-1">成长值</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <AnimatePresence>
        {selectedStudent && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setSelectedStudent(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl p-6 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-800">
                  {selectedStudent.real_name} 的数据详情
                </h3>
                <button
                  onClick={() => setSelectedStudent(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <i className="fa-solid fa-times"></i>
                </button>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-blue-50 p-3 rounded-lg text-center">
                    <p className="text-xs text-gray-500">累计做题</p>
                    <p className="text-xl font-bold text-blue-600">{selectedStudent.total_answers}</p>
                  </div>
                  <div className="bg-teal-50 p-3 rounded-lg text-center">
                    <p className="text-xs text-gray-500">做对题目</p>
                    <p className="text-xl font-bold text-teal-600">{selectedStudent.correct_answers}</p>
                  </div>
                  <div className="bg-green-50 p-3 rounded-lg text-center">
                    <p className="text-xs text-gray-500">正确率</p>
                    <p className="text-xl font-bold text-green-600">{selectedStudent.accuracy}%</p>
                  </div>
                  <div className="bg-purple-50 p-3 rounded-lg text-center">
                    <p className="text-xs text-gray-500">总积分</p>
                    <p className="text-xl font-bold text-purple-600">{selectedStudent.total_points_earned}</p>
                  </div>
                  <div className="bg-green-50 p-3 rounded-lg text-center">
                    <p className="text-xs text-gray-500">🏆 十全十美</p>
                    <p className="text-xl font-bold text-green-600">{selectedStudent.perfect_10_times || 0}</p>
                  </div>
                </div>

                <div className="bg-orange-50 p-4 rounded-lg">
                  <div className="flex items-center gap-3">
                    <i className="fa-solid fa-paw text-2xl text-orange-500"></i>
                    <div>
                      <p className="font-medium text-gray-800">
                        萌宠等级: Lv.{selectedStudent.pet_level} {getPetStageName(selectedStudent.pet_level)}
                      </p>
                      <p className="text-sm text-gray-500">成长值: {selectedStudent.pet_growth}</p>
                    </div>
                  </div>
                </div>

                <div className="text-center text-sm text-gray-400">
                  班级: {selectedStudent.class_name}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
