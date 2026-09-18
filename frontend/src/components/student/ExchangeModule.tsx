import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { backendClient } from '../../api/backendClient';
import { Prize, ExchangeRecord, PrizeClassVisibility } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { getSkinById, TIER_LABELS, TIER_BG_COLORS } from '../../config/windowSkins';

export const ExchangeModule: React.FC = () => {
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [exchangeHistory, setExchangeHistory] = useState<ExchangeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showConfirm, setShowConfirm] = useState<{ item: Prize; type: 'prize' } | null>(null);
  const [isExchanging, setIsExchanging] = useState(false); // 防重复提交标志
  // 学生已拥有的皮肤ID：同一皮肤只能兑换一次，已拥有的直接禁用兑换按钮
  const [ownedSkinIds, setOwnedSkinIds] = useState<string[]>([]);
  const { profile, refreshProfile } = useAuth();

  useEffect(() => {
    if (profile) {
      fetchData();
    }
  }, [profile]);

  const fetchData = async () => {
    if (!profile) return;

    const [{ data: prizesData }, { data: historyData }, { data: visibilityData }] = await Promise.all([
      backendClient.from('prizes').select('*').eq('is_active', true).order('points_cost', { ascending: true }),
      backendClient.from('exchange_records').select('*, prize:prizes(name, type)').eq('student_id', profile.id).order('exchanged_at', { ascending: false }),
      backendClient.from('prize_class_visibility').select('*'),
    ]);

    if (prizesData) {
      const allPrizes = prizesData as Prize[];
      const visibility = visibilityData as PrizeClassVisibility[] || [];

      const canExchangeInternetCode = profile.can_exchange_internet_code ?? true;

      const filteredPrizes = allPrizes.filter((prize) => {
        if (prize.type !== 'internet_code') return true;

        if (!canExchangeInternetCode) return false;

        const prizeVisibility = visibility.filter((v) => v.prize_id === prize.id);
        if (prizeVisibility.length === 0) return true;

        const studentClassId = profile.class_id;
        if (!studentClassId) return true;

        const classVisibility = prizeVisibility.find((v) => v.class_id === studentClassId);
        return classVisibility ? classVisibility.is_visible : true;
      });

      setPrizes(filteredPrizes);
    }
    if (historyData) setExchangeHistory(historyData as ExchangeRecord[]);

    // 拉取已拥有皮肤，用于「已拥有」标记与按钮禁用
    try {
      const skinResult: any = await backendClient.get('/api/student/my-skins');
      const owned = skinResult?.data?.ownedSkins;
      if (Array.isArray(owned)) {
        setOwnedSkinIds(owned.map((s: any) => s.skin_id).filter(Boolean));
      }
    } catch (error) {
      console.warn('获取已拥有皮肤失败，将不做「已拥有」标记:', error);
    }

    setLoading(false);
  };

  /** 皮肤类奖品且学生已拥有 → 不可再兑换（重复兑换只是多买一个同款，效果完全一样） */
  const isSkinOwned = (prize: Prize): boolean => {
    if (prize.type !== 'skin') return false;
    const skinId = (prize as any).skin_id;
    return !!skinId && ownedSkinIds.includes(skinId);
  };

  const canExchangeToday = async (prize: Prize): Promise<boolean> => {
    if (!profile || prize.daily_limit === 0) return true;

    const today = new Date().toISOString().split('T')[0];
    const { data } = await backendClient
      .from('exchange_records')
      .select('*')
      .eq('student_id', profile.id)
      .eq('prize_id', prize.id)
      .gte('exchanged_at', today);

    return (data?.length || 0) < (prize.daily_limit || 1);
  };

  const [exchangeResult, setExchangeResult] = useState<{ name: string; code?: string; isEquipment?: boolean; isSkin?: boolean } | null>(null);

  const handleExchange = async () => {
    if (!showConfirm || !profile || isExchanging) return;

    setIsExchanging(true); // 开始兑换中，防止重复提交

    try {
      const { item } = showConfirm;
      const cost = item.points_cost || 0;

      if ((profile.current_points || 0) < cost) {
        alert('积分不足!');
        setShowConfirm(null);
        return;
      }

      const prize = item as Prize;

      // 皮肤：同一皮肤只能兑换一次（多个相同皮肤与一个的效果完全一样，重复兑换只是浪费积分）
      if (isSkinOwned(prize)) {
        alert('您已拥有该皮肤，同一皮肤只能兑换一次');
        setShowConfirm(null);
        return;
      }

      // 使用新的业务API进行兑换（认证码由后端在事务内自动分配，避免并发竞争）
      try {
        const result = await backendClient.businessExchangePrize({
          student_id: profile.id,
          prize_id: prize.id,
          prize_points: cost
        });

        if (result.error) {
          alert(result.error || '兑换失败，请重试');
          return;
        }

        // 兑换成功
        setExchangeResult({
          name: prize.name,
          code: result.data?.code,
          isEquipment: prize.type === 'equipment',
          isSkin: prize.type === 'skin',
        });

        // 更新本地用户信息
        if (result.data?.student) {
          refreshProfile();
        }
      } catch (apiError: any) {
        alert(apiError.message || '兑换失败，请重试');
        return;
      }

      await refreshProfile();
      await fetchData();
      setShowConfirm(null);
    } finally {
      setIsExchanging(false); // 兑换结束
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <i className="fa-solid fa-circle-notch fa-spin text-3xl text-blue-500"></i>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-800">积分兑换</h2>
        <div className="flex items-center gap-2 bg-yellow-100 px-4 py-2 rounded-full">
          <i className="fa-solid fa-coins text-yellow-600"></i>
          <span className="font-bold text-yellow-700">{profile?.current_points || 0} 积分</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {prizes.map((prize) => {
          const skinConfig = prize.type === 'skin' ? getSkinById((prize as any).skin_id) : null;
          const skinOwned = isSkinOwned(prize);
          return (
          <motion.div
            key={prize.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`relative bg-white rounded-xl shadow-sm border p-4 hover:shadow-md transition-shadow ${
              prize.type === 'equipment' ? 'border-orange-300' :
              prize.type === 'skin' ? 'border-pink-300' :
              'border-gray-200'
            }`}
          >
            {skinOwned && (
              <span className="absolute top-2 right-2 bg-gray-500/90 text-white text-[10px] px-2 py-0.5 rounded-full">
                已拥有
              </span>
            )}
            {prize.type === 'skin' && skinConfig ? (
              // 皮肤奖品：显示迷你窗口预览
              <div className="mb-3">
                <div className={`rounded-lg overflow-hidden border-2 border-gray-200`}>
                  <div className={`h-10 ${skinConfig.titleBarClass} flex items-center justify-between px-2`}>
                    <span className={`${skinConfig.titleTextClass} text-[10px] font-medium`}>
                      {skinConfig.previewEmoji} 窗口预览
                    </span>
                    <div className="flex gap-0.5">
                      <div className={`w-1.5 h-1.5 rounded-full ${skinConfig.titleTextClass} opacity-60`}></div>
                      <div className="w-1.5 h-1.5 rounded-full bg-red-400"></div>
                    </div>
                  </div>
                  <div className={`h-4 ${skinConfig.contentBgClass}`}></div>
                </div>
                <div className="flex items-center justify-center gap-2 mt-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${TIER_BG_COLORS[skinConfig.tier]}`}>
                    {TIER_LABELS[skinConfig.tier]}
                  </span>
                  <span className="text-[10px] text-orange-600 font-medium">
                    <i className="fa-solid fa-bolt mr-0.5"></i>暴击+{skinConfig.critBonus}%
                  </span>
                </div>
              </div>
            ) : (
              <div className={`w-16 h-16 rounded-xl mx-auto mb-3 flex items-center justify-center ${
                prize.type === 'equipment' ? 'bg-gradient-to-br from-orange-400 to-yellow-400' :
                prize.type === 'internet_code' ? 'bg-gradient-to-br from-blue-400 to-purple-400' :
                'bg-gradient-to-br from-blue-400 to-purple-400'
              }`}>
                <i className={`fa-solid ${prize.type === 'equipment' ? 'fa-shield-halved' : prize.type === 'internet_code' ? 'fa-wifi' : 'fa-gift'} text-white text-2xl`}></i>
              </div>
            )}
            <h3 className="font-bold text-gray-800 text-center mb-1">{prize.name}</h3>
            {prize.type === 'equipment' ? (
              <p className="text-sm text-orange-500 text-center mb-3 font-medium">暴击率永久加成</p>
            ) : prize.type === 'skin' ? (
              <p className="text-sm text-pink-500 text-center mb-3 font-medium">窗口皮肤 · 暴击加成</p>
            ) : (
              <p className="text-sm text-gray-500 text-center mb-3">{prize.description}</p>
            )}
            <div className="flex items-center justify-between">
              <span className="text-yellow-600 font-bold">
                <i className="fa-solid fa-coins mr-1"></i>
                {prize.points_cost}
              </span>
              <button
                onClick={() => !skinOwned && setShowConfirm({ item: prize, type: 'prize' })}
                disabled={skinOwned || (profile?.current_points || 0) < (prize.points_cost || 0)}
                className={`px-4 py-1 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm ${
                  skinOwned ? 'bg-gray-400' :
                  prize.type === 'equipment' ? 'bg-orange-500 hover:bg-orange-600' :
                  prize.type === 'skin' ? 'bg-pink-500 hover:bg-pink-600' :
                  'bg-blue-500 hover:bg-blue-600'
                }`}
              >
                {skinOwned ? '已拥有' : '兑换'}
              </button>
            </div>
            {skinOwned ? (
              <p className="text-xs text-pink-500 text-center mt-2">
                <i className="fa-solid fa-circle-check mr-1"></i>同一皮肤只能兑换一次
              </p>
            ) : prize.type === 'skin' ? (
              <p className="text-xs text-gray-400 text-center mt-2">
                同一皮肤限兑一次
              </p>
            ) : (prize.daily_limit || 0) > 0 ? (
              <p className="text-xs text-gray-400 text-center mt-2">
                每日限兑 {prize.daily_limit} 个
              </p>
            ) : null}
          </motion.div>
          );
        })}
      </div>

      {exchangeHistory.length > 0 && (
        <div className="mt-8">
          <h3 className="text-lg font-bold text-gray-800 mb-4">兑换记录</h3>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">物品</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">消耗积分</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">兑换时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {exchangeHistory.slice(0, 10).map((record: any) => (
                  <tr key={record.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-800">
                      <div className="flex flex-col">
                        <span>{record.prize_name || record.prize?.name || '未知物品'}</span>
                        {record.code && (
                          <div className="mt-2 flex items-center gap-2">
                            <span className="text-xs text-blue-600 font-mono bg-blue-50 px-2 py-1 rounded">
                              {record.code}
                            </span>
                            <button
                              onClick={() => {
                                const textArea = document.createElement('textarea');
                                textArea.value = record.code;
                                textArea.style.position = 'fixed';
                                textArea.style.left = '-999999px';
                                document.body.appendChild(textArea);
                                textArea.focus();
                                textArea.select();
                                try {
                                  document.execCommand('copy');
                                  alert('认证码已复制: ' + record.code);
                                } catch (err) {
                                  alert('复制失败，请手动复制: ' + record.code);
                                }
                                document.body.removeChild(textArea);
                              }}
                              className="text-xs text-blue-500 hover:text-blue-700 underline"
                            >
                              点击复制
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-red-600">-{record.points_cost}</td>
                    <td className="px-4 py-3 text-right text-sm text-gray-500">
                      {new Date(record.exchanged_at || '').toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AnimatePresence>
        {showConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            onClick={() => setShowConfirm(null)}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-gray-800 mb-4">确认兑换</h3>
              <p className="text-gray-600 mb-6">
                确定要兑换 <span className="font-bold">{showConfirm.item.name}</span> 吗？
                <br />
                将消耗 <span className="text-yellow-600 font-bold">{showConfirm.item.points_cost}</span> 积分
              </p>
              {showConfirm.item.type === 'equipment' && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-4">
                  <p className="text-sm text-orange-600 text-center">
                    <i className="fa-solid fa-shield-halved mr-1"></i>
                    兑换后装备将直接生效，暴击率永久提升
                  </p>
                </div>
              )}
              {showConfirm.item.type === 'skin' && (
                <div className="bg-pink-50 border border-pink-200 rounded-lg p-3 mb-4">
                  <p className="text-sm text-pink-600 text-center">
                    <i className="fa-solid fa-circle-info mr-1"></i>
                    同一皮肤只能兑换一次，不会重复扣分
                  </p>
                </div>
              )}
              <div className="flex gap-3">
                <button
                  onClick={() => setShowConfirm(null)}
                  disabled={isExchanging}
                  className="flex-1 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  取消
                </button>
                <button
                  onClick={handleExchange}
                  disabled={isExchanging}
                  className="flex-1 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isExchanging ? (
                    <>
                      <i className="fa-solid fa-circle-notch fa-spin"></i>
                      兑换中...
                    </>
                  ) : (
                    '确认'
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {exchangeResult && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            onClick={() => setExchangeResult(null)}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-center mb-4">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <i className="fa-solid fa-check text-green-500 text-2xl"></i>
                </div>
                <h3 className="text-lg font-bold text-gray-800">兑换成功!</h3>
              </div>
              <p className="text-gray-600 text-center mb-4">
                您已成功兑换 <span className="font-bold">{exchangeResult.name}</span>
              </p>
              {exchangeResult.isEquipment && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-4">
                  <p className="text-sm text-orange-600 text-center">
                    <i className="fa-solid fa-shield-halved mr-1"></i>
                    装备已添加到个人中心，暴击率永久提升！
                  </p>
                </div>
              )}
              {exchangeResult.code && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                  <p className="text-sm text-gray-600 text-center mb-2">您的上网认证码</p>
                  <p className="text-2xl font-bold text-blue-600 text-center tracking-wider">{exchangeResult.code}</p>
                  <p className="text-xs text-gray-400 text-center mt-2">请妥善保存，兑换记录中也可查看</p>
                </div>
              )}
              <button
                onClick={() => setExchangeResult(null)}
                className="w-full py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
              >
                知道了
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
