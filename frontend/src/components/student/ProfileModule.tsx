import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { backendClient } from '../../api/backendClient';
import { ExchangeRecord, TestRecord, StudentPet, Pet, PET_STAGE_NAMES, getCumulativeThresholdForLevel } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { useGameSystem } from '../../hooks/useGameSystem';
import { API_CONFIG } from '../../api/config';
import { getAuthToken } from '../../utils/authToken';
import { SkinManager } from './SkinManager';

const API_BASE = API_CONFIG.apiUrl;

export const ProfileModule: React.FC = () => {
  const [exchangeHistory, setExchangeHistory] = useState<ExchangeRecord[]>([]);
  const [testHistory, setTestHistory] = useState<TestRecord[]>([]);
  const [studentPet, setStudentPet] = useState<StudentPet | null>(null);
  const [petDetails, setPetDetails] = useState<Pet | null>(null);
  const [stats, setStats] = useState({ total: 0, correct: 0, accuracy: 0 });
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [levelConfig, setLevelConfig] = useState({ baseThreshold: 50, increment: 50, maxStage: 5 });
  // 桌面背景设置状态
  const [bgPermission, setBgPermission] = useState<{ hasPermission: boolean; customBackground: string | null; freePerDay: number; pointsCost: number }>({ hasPermission: false, customBackground: null, freePerDay: 1, pointsCost: 100 });
  const [settingBackground, setSettingBackground] = useState(false);
  const [bgResult, setBgResult] = useState<{ background: any; pointsDeducted: number; freeRemaining: number; message: string } | null>(null);
  const { profile, updatePassword, refreshProfile } = useAuth();
  const gameSystem = useGameSystem();

  useEffect(() => {
    if (profile) {
      fetchData();
      fetchStats();
      fetchBgPermission();
    }
  }, [profile]);

  useEffect(() => {
    if (profile) {
      gameSystem.fetchGameStats();
      gameSystem.fetchHonors();
    }
  }, [profile]);

  // 获取学生背景权限
  const fetchBgPermission = async () => {
    if (!profile) return;
    try {
      const token = getAuthToken();
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      const response = await fetch(`${API_BASE}/api/student/custom-background`, { headers });
      const result = await response.json();
      if (result.data) {
        setBgPermission({
          hasPermission: result.data.hasPermission,
          customBackground: result.data.customBackground,
          freePerDay: result.data.freePerDay || 1,
          pointsCost: result.data.pointsCost || 100
        });
      }
    } catch (error) {
      console.error('获取背景权限失败:', error);
    }
  };

  // 随机设置背景
  const handleSetRandomBackground = async () => {
    if (!profile) return;
    setSettingBackground(true);
    setBgResult(null);
    try {
      const token = getAuthToken();
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      const response = await fetch(`${API_BASE}/api/student/custom-background`, {
        method: 'POST',
        headers
      });
      const result = await response.json();
      if (result.data) {
        setBgResult(result.data);
        fetchBgPermission();
        refreshProfile(); // 刷新积分显示
      } else {
        alert(result.error || '设置失败');
      }
    } catch (error) {
      console.error('设置背景失败:', error);
      alert('设置失败，请稍后重试');
    } finally {
      setSettingBackground(false);
    }
  };

  // 恢复默认背景
  const handleResetBackground = async () => {
    if (!profile) return;
    if (!confirm('确定要恢复默认背景吗？')) return;
    try {
      const token = getAuthToken();
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      const response = await fetch(`${API_BASE}/api/student/custom-background/reset`, {
        method: 'POST',
        headers
      });
      const result = await response.json();
      if (result.data && result.data.success) {
        alert('已恢复默认背景');
        fetchBgPermission();
      } else {
        alert(result.error || '恢复失败');
      }
    } catch (error) {
      console.error('恢复背景失败:', error);
      alert('恢复失败，请稍后重试');
    }
  };

  const fetchData = async () => {
    if (!profile) return;

    const [{ data: exchangeData }, testResult, { data: petData }, { data: configData }] = await Promise.all([
      backendClient.from('exchange_records').select('*, prize:prizes(*)').eq('student_id', profile.id).order('exchanged_at', { ascending: false }),
      fetch(`${API_BASE}/api/student/test-history`, {
        headers: { Authorization: `Bearer ${getAuthToken()}` }
      }).then(r => r.json()),
      backendClient.from('student_pets').select('*, pet:pets(*)').eq('student_id', profile.id).single(),
      backendClient.from('pet_config').select('*').maybeSingle(),
    ]);

    if (exchangeData) setExchangeHistory(exchangeData as ExchangeRecord[]);
    if (testResult?.data) setTestHistory(testResult.data as TestRecord[]);
    if (petData) {
      setStudentPet(petData as StudentPet);
      setPetDetails((petData as any).pet as Pet);
    }
    if (configData) {
      setLevelConfig({
        baseThreshold: configData.level_base_threshold || 50,
        increment: configData.level_threshold_increment || 50,
        maxStage: configData.max_stage || 5,
      });
    }
  };

  const fetchStats = async () => {
    if (!profile) return;
    const { data } = await backendClient
      .from('student_answers')
      .select('is_correct')
      .eq('student_id', profile.id);
    if (data) {
      const total = data.length;
      const correct = data.filter((a) => a.is_correct).length;
      setStats({
        total,
        correct,
        accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
      });
    }
  };

  const handlePasswordChange = async () => {
    setPasswordError('');
    setPasswordSuccess(false);

    if (newPassword.length < 6) {
      setPasswordError('密码长度至少6位');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('两次输入的密码不一致');
      return;
    }

    const { error } = await updatePassword(newPassword);
    if (error) {
      setPasswordError('密码修改失败');
    } else {
      setPasswordSuccess(true);
      setNewPassword('');
      setConfirmPassword('');
    }
  };

  const currentLevel = studentPet?.growth_level || 1;
  const currentStage = Math.min(currentLevel, levelConfig.maxStage);
  const stageName = PET_STAGE_NAMES[currentStage - 1] || `阶段${currentStage}`;
  const currentLevelMinGrowth = getCumulativeThresholdForLevel(currentLevel, levelConfig.baseThreshold, levelConfig.increment);
  const nextLevelMinGrowth = getCumulativeThresholdForLevel(currentLevel + 1, levelConfig.baseThreshold, levelConfig.increment);
  const currentGrowth = studentPet?.growth_value || 0;
  const progress = nextLevelMinGrowth > currentLevelMinGrowth
    ? Math.min(100, Math.max(0, (currentGrowth - currentLevelMinGrowth) / (nextLevelMinGrowth - currentLevelMinGrowth) * 100))
    : 0;

  return (
    <div className="p-6">
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
              <i className="fa-solid fa-user-circle text-blue-500"></i>
              个人信息
            </h3>
            <div className="space-y-3">
              <div className="flex justify-between py-2 border-b border-gray-100">
                <span className="text-gray-500">用户名</span>
                <span className="font-medium text-gray-800">{profile?.username}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-gray-100">
                <span className="text-gray-500">姓名</span>
                <span className="font-medium text-gray-800">{profile?.real_name}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-gray-100">
                <span className="text-gray-500">角色</span>
                <span className="font-medium text-gray-800">
                  {profile?.role === 'student' ? '学生' : '教师'}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
              <i className="fa-solid fa-chart-pie text-green-500"></i>
              学习统计
            </h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-4 bg-blue-50 rounded-lg">
                <p className="text-2xl font-bold text-blue-600">{stats.total}</p>
                <p className="text-sm text-gray-600">总做题数</p>
              </div>
              <div className="text-center p-4 bg-green-50 rounded-lg">
                <p className="text-2xl font-bold text-green-600">{stats.correct}</p>
                <p className="text-sm text-gray-600">正确数</p>
              </div>
              <div className="text-center p-4 bg-purple-50 rounded-lg">
                <p className="text-2xl font-bold text-purple-600">{stats.accuracy}%</p>
                <p className="text-sm text-gray-600">正确率</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
              <i className="fa-solid fa-bolt text-orange-500"></i>
              战力暴击
            </h3>
            <div className="space-y-3">
              <div className="flex justify-between py-2 border-b border-gray-100">
                <span className="text-gray-500">战力倍率</span>
                <span className="group relative font-bold text-orange-600 cursor-help">
                  x{gameSystem.gameStats?.power_multiplier?.toFixed(1) || '1.0'}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 pointer-events-none shadow-lg">
                    战力倍率由宠物等级决定，1 + 0.1×等级。在练习答题中获得积分加成。
                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800"></div>
                  </div>
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-gray-100">
                <span className="text-gray-500">暴击率</span>
                <span className="group relative font-bold text-red-500 cursor-help">
                  {gameSystem.gameStats?.crit_rate || 0}%
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 pointer-events-none shadow-lg">
                    暴击率基础{(gameSystem.gameStats as any)?.crit_base_rate || 5}%，每答对100题+1%，副本通关和成就Buff可额外提升，上限{(gameSystem.gameStats as any)?.crit_max_rate || 30}%。触发暴击获得双倍积分。
                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800"></div>
                  </div>
                </span>
              </div>
              {(gameSystem.gameStats as any)?.crit_rate_breakdown && (
              <div className="py-2">
                <p className="text-sm text-gray-500 mb-1">暴击率来源</p>
                <div className="text-sm text-gray-600 space-y-1 pl-2">
                  <div className="flex justify-between">
                    <span>基础</span>
                    <span className="font-medium">{(gameSystem.gameStats as any).crit_rate_breakdown.base}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span>答对题数加成</span>
                    <span className="font-medium">+{(gameSystem.gameStats as any).crit_rate_breakdown.from_correct_count}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Buff 加成</span>
                    <span className="font-medium text-green-600">
                      +{(gameSystem.gameStats as any).crit_rate_breakdown.from_buffs}%
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-purple-600">装备加成</span>
                    <span className="font-medium text-purple-600">+{(gameSystem.gameStats as any)?.crit_rate_breakdown?.from_equipment || 0}%</span>
                  </div>
                  {(gameSystem.gameStats?.crit_rate_breakdown?.from_skin || 0) > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-pink-600">皮肤加成</span>
                      <span className="font-medium text-pink-600">+{gameSystem.gameStats?.crit_rate_breakdown?.from_skin}%</span>
                    </div>
                  )}
                </div>
              </div>
              )}
              <div className="py-2">
                <p className="text-sm text-gray-500 mb-1">Active Buff</p>
                {(gameSystem.gameStats?.active_buffs || []).length > 0 ? (
                  <div className="space-y-1">
                    {gameSystem.gameStats?.active_buffs.map((buff) => {
                      const buffName = buff.buff_type === 'perfect_crit' ? '十全十美' : buff.buff_type === 'critstreak_crit' ? '暴击新星' : buff.buff_type === 'wrong_debuff' ? '屡败屡战' : buff.buff_type === 'teacher_crit' ? '师恩赋能' : buff.buff_type === 'studious_crit' ? '勤学好问' : buff.buff_type === 'typing_fast_crit' ? '运指如飞' : buff.buff_type;
                      const buffSign = (buff.crit_modifier || 0) >= 0 ? '+' : '';
                      return (
                      <div key={buff.id} className="flex justify-between text-sm">
                        <span className={buff.crit_modifier >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                          {buffName}
                        </span>
                        <span className="text-gray-500">
                          {buffSign}{buff.crit_modifier || 0}% · {Math.max(0, Math.ceil(buff.remaining_seconds / 60))}分钟
                        </span>
                      </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400">无活跃Buff</p>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm p-5 mb-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800 flex items-center gap-2">
                <i className="fa-solid fa-shield-halved text-purple-500"></i>
                装备栏
              </h3>
              <span className="text-sm text-gray-500">
                暴击加成: +{(gameSystem.gameStats as any)?.crit_rate_breakdown?.from_equipment || 0}%
              </span>
            </div>

            {((gameSystem.gameStats as any)?.equipment_list || []).length > 0 ? (
              <div className="grid grid-cols-3 gap-3">
                {((gameSystem.gameStats as any)?.equipment_list || []).map((eq: any) => (
                  <div key={eq.id} className="text-center p-3 bg-purple-50 rounded-lg border border-purple-200">
                    <div className="text-3xl mb-1">{eq.icon}</div>
                    <p className="text-sm font-bold text-purple-700">{eq.name}</p>
                    <p className="text-xs text-purple-500">+{eq.crit_bonus}% 暴击</p>
                    {eq.quantity > 1 && (
                      <p className="text-xs text-gray-500 mt-1">×{eq.quantity}</p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-gray-400 py-4">暂无装备，答题正确有机会掉落装备</p>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
              <i className="fa-solid fa-lock text-orange-500"></i>
              修改密码
            </h3>
            <div className="space-y-4">
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="新密码"
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              />
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="确认新密码"
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              />
              {passwordError && (
                <p className="text-red-500 text-sm">{passwordError}</p>
              )}
              {passwordSuccess && (
                <p className="text-green-500 text-sm">密码修改成功!</p>
              )}
              <button
                onClick={handlePasswordChange}
                className="w-full py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
              >
                修改密码
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
              <i className="fa-solid fa-coins text-yellow-500"></i>
              积分信息
            </h3>
            <div className="space-y-3">
              <div className="flex justify-between py-2 border-b border-gray-100">
                <span className="text-gray-500">当前可用积分</span>
                <span className="font-bold text-yellow-600">{profile?.current_points || 0}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-gray-100">
                <span className="text-gray-500">总计获得积分</span>
                <span className="font-bold text-purple-600">{profile?.total_points_earned || 0}</span>
              </div>
            </div>
          </div>

          {/* 桌面背景设置卡片 */}
          {bgPermission.hasPermission && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                <i className="fa-solid fa-image text-indigo-500"></i>
                桌面背景设置
              </h3>

              <div className="p-4 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-lg mb-4">
                <p className="text-sm text-gray-700">
                  <i className="fa-solid fa-lightbulb text-indigo-500 mr-2"></i>
                  点击按钮随机抽取一张背景图片并设置为你的桌面背景。
                </p>
                <p className="text-xs text-gray-500 mt-2">
                  每日免费 {bgPermission.freePerDay} 次，超出后每次扣除 {bgPermission.pointsCost} 积分。
                </p>
              </div>

              {/* 当前背景预览 */}
              {bgPermission.customBackground && (
                <div className="mb-4">
                  <p className="text-sm font-medium text-gray-700 mb-2">当前背景</p>
                  <div className="rounded-lg overflow-hidden border border-gray-300">
                    <img
                      src={bgPermission.customBackground}
                      alt="当前桌面背景"
                      className="w-full h-32 object-cover"
                    />
                  </div>
                </div>
              )}

              {/* 结果提示 */}
              {bgResult && (
                <div className={`p-4 rounded-lg mb-4 ${
                  bgResult.pointsDeducted > 0 ? 'bg-yellow-50 border border-yellow-200' : 'bg-green-50 border border-green-200'
                }`}>
                  <p className="text-sm font-medium ${
                    bgResult.pointsDeducted > 0 ? 'text-yellow-700' : 'text-green-700'
                  }">
                    <i className={`fa-solid ${bgResult.pointsDeducted > 0 ? 'fa-coins' : 'fa-check-circle'} mr-2`}></i>
                    {bgResult.message}
                  </p>
                  <div className="mt-2 text-xs text-gray-600">
                    <p>背景名称: {bgResult.background?.name || '未命名'}</p>
                    {bgResult.pointsDeducted > 0 && (
                      <p className="text-yellow-600">已扣除 {bgResult.pointsDeducted} 积分</p>
                    )}
                    {bgResult.freeRemaining > 0 && (
                      <p className="text-green-600">剩余免费次数: {bgResult.freeRemaining}</p>
                    )}
                  </div>
                  {/* 新背景预览 */}
                  <div className="mt-3 rounded-lg overflow-hidden border border-gray-300">
                    <img
                      src={bgResult.background?.url}
                      alt="新桌面背景"
                      className="w-full h-24 object-cover"
                    />
                  </div>
                </div>
              )}

              {/* 操作按钮 */}
              <div className="space-y-3">
                <button
                  onClick={handleSetRandomBackground}
                  disabled={settingBackground}
                  className="w-full py-3 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-lg hover:from-indigo-600 hover:to-purple-600 disabled:opacity-50 transition-all flex items-center justify-center gap-2 font-medium"
                >
                  {settingBackground ? (
                    <>
                      <i className="fa-solid fa-circle-notch fa-spin"></i>
                      <span>正在设置...</span>
                    </>
                  ) : (
                    <>
                      <i className="fa-solid fa-random"></i>
                      <span>随机设置背景</span>
                    </>
                  )}
                </button>

                {bgPermission.customBackground && (
                  <button
                    onClick={handleResetBackground}
                    className="w-full py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors flex items-center justify-center gap-2 text-sm"
                  >
                    <i className="fa-solid fa-undo"></i>
                    <span>恢复默认背景</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 皮肤管理卡片 */}
          <SkinManager />

          {studentPet && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                <i className="fa-solid fa-paw text-pink-500"></i>
                萌宠信息
              </h3>
              <div className="flex items-center gap-4 mb-4">
                <div className="w-16 h-16 bg-gradient-to-br from-pink-400 to-purple-400 rounded-full flex items-center justify-center">
                  <i className="fa-solid fa-paw text-white text-2xl"></i>
                </div>
                <div>
                  <p className="font-bold text-gray-800">{petDetails?.name}</p>
                  <p className="text-sm text-purple-600">Lv.{currentLevel} {stageName}</p>
                </div>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3 mb-2">
                <div
                  className="bg-gradient-to-r from-pink-500 to-purple-500 h-3 rounded-full"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
              <p className="text-sm text-gray-500 text-center">
                成长值: {studentPet.growth_value || 0} / {nextLevelMinGrowth}
              </p>
            </div>
          )}

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
              <i className="fa-solid fa-shield-halved text-purple-500"></i>
              荣誉图鉴
            </h3>
            {gameSystem.honorStats ? (
              <div className="grid grid-cols-4 md:grid-cols-5 gap-3">
                <div className="text-center p-3 bg-yellow-50 rounded-lg border border-yellow-200 group relative cursor-help">
                  <div className="text-2xl mb-1">🏆</div>
                  <p className="text-lg font-bold text-yellow-700">{gameSystem.honorStats.perfect_10_times}</p>
                  <p className="text-xs text-gray-600">十全十美</p>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 pointer-events-none shadow-lg">
                    练习连对10题
                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800"></div>
                  </div>
                </div>
                <div className="text-center p-3 bg-red-50 rounded-lg border border-red-200 group relative cursor-help">
                  <div className="text-2xl mb-1">💥</div>
                  <p className="text-lg font-bold text-red-700">{gameSystem.honorStats.triple_crit_times}</p>
                  <p className="text-xs text-gray-600">三连暴击</p>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 pointer-events-none shadow-lg">
                    连续暴击3次
                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800"></div>
                  </div>
                </div>
                <div className="text-center p-3 bg-blue-50 rounded-lg border border-blue-200 group relative cursor-help">
                  <div className="text-2xl mb-1">📚</div>
                  <p className="text-lg font-bold text-blue-700">{gameSystem.honorStats.studious_times ?? 0}</p>
                  <p className="text-xs text-gray-600">勤学好问</p>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 pointer-events-none shadow-lg">
                    当天 AI 答疑成功提问满 10 次（每天一次）
                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800"></div>
                  </div>
                </div>
                <div className="text-center p-3 bg-gray-50 rounded-lg border border-gray-200 group relative cursor-help">
                  <div className="text-2xl mb-1">😈</div>
                  <p className="text-lg font-bold text-gray-700">{gameSystem.honorStats.wrong_3_times}</p>
                  <p className="text-xs text-gray-600">屡败屡战</p>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 pointer-events-none shadow-lg">
                    练习时连错3题
                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800"></div>
                  </div>
                </div>
                <div className="text-center p-3 bg-emerald-50 rounded-lg border border-emerald-200 group relative cursor-help">
                  <div className="text-2xl mb-1">⚡</div>
                  <p className="text-lg font-bold text-emerald-700">{gameSystem.honorStats.typing_fast_times ?? 0}</p>
                  <p className="text-xs text-gray-600">运指如飞</p>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 pointer-events-none shadow-lg">
                    键盘星域单人模式速度达标
                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800"></div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-4">暂无荣誉达成记录</p>
            )}
          </div>

          {testHistory.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-bold text-gray-800 mb-4">最近测试</h3>
              <div className="space-y-2">
                {testHistory.slice(0, 5).map((record) => (
                  <div key={record.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                    <span className="text-gray-700">{(record as any).test_name || '未知测试'}</span>
                    <div className="flex items-center gap-4">
                      <span className="font-bold text-blue-600">{record.score}分</span>
                      <span className="text-sm text-green-600">+{record.points_earned}积分</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
