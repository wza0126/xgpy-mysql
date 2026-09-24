import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { API_CONFIG } from '../../api/config';
import { WINDOW_SKINS, TIER_LABELS, TIER_BG_COLORS, TIER_BORDER_COLORS, WindowSkinConfig, DEFAULT_SKIN, RANK_SKINS } from '../../config/windowSkins';
import { useSkinStore } from '../../store/skinStore';
import { getAuthToken } from '../../utils/authToken';

interface OwnedSkin {
  skin_id: string;
  acquired_at: string;
}

export const SkinManager: React.FC = () => {
  const [ownedSkins, setOwnedSkins] = useState<OwnedSkin[]>([]);
  const [activeSkinId, setActiveSkinId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  /** 当前 PK 段位层级（用于展示段位皮肤的解锁进度） */
  const [pkTier, setPkTier] = useState<number>(0);
  const { setActiveSkin: setStoreSkin } = useSkinStore();

  useEffect(() => {
    fetchMySkins();
    fetchPkTier();
  }, []);

  const fetchMySkins = async () => {
    try {
      const token = getAuthToken();
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      const response = await fetch(`${API_CONFIG.apiUrl}/api/student/my-skins`, { headers });
      const result = await response.json();
      if (result.data) {
        setOwnedSkins(result.data.ownedSkins || []);
        setActiveSkinId(result.data.activeSkinId);
      }
    } catch (error) {
      console.error('获取皮肤列表失败:', error);
    }
  };

  // 段位皮肤解锁状态由「当前段位」决定；后端在升段时已自动补发皮肤，
  // 这里再拉一次段位是为了给「未解锁」的皮肤显示进度提示。
  const fetchPkTier = async () => {
    try {
      const token = getAuthToken();
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      const response = await fetch(`${API_CONFIG.apiUrl}/api/pk/profile`, { headers });
      const result = await response.json();
      if (result.data) setPkTier(Number(result.data.tier) || 0);
    } catch {
      // 段位拉取失败不影响皮肤管理主流程
    }
  };

  const handleActivateSkin = async (skinId: string | null) => {
    setLoading(true);
    setMessage(null);
    try {
      const token = getAuthToken();
      const response = await fetch(`${API_CONFIG.apiUrl}/api/student/active-skin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ skinId }),
      });
      const result = await response.json();

      if (response.ok && result.data?.success) {
        setActiveSkinId(skinId);
        // 更新全局皮肤 store
        const skinConfig = skinId ? WINDOW_SKINS.find((s) => s.id === skinId) : null;
        setStoreSkin(skinConfig || null);
        setMessage({ type: 'success', text: result.data.message || '设置成功' });
      } else {
        setMessage({ type: 'error', text: result.error || '设置失败' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: '网络错误，请稍后重试' });
    } finally {
      setLoading(false);
    }
  };

  const ownedSkinIds = ownedSkins.map((s) => s.skin_id);
  const ownedSkinsList = WINDOW_SKINS.filter(
    (s) => ownedSkinIds.includes(s.id) && s.unlockSource !== 'rank'
  );
  // 段位专属皮肤单独分组：未解锁的也要展示（让学生看到"再升一级能拿到什么"）
  const rankSkinsList = RANK_SKINS;
  const myTier = Number(pkTier) || 0;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
        <i className="fa-solid fa-palette text-pink-500"></i>
        皮肤管理
      </h3>

      <div className="p-4 bg-gradient-to-r from-pink-50 to-purple-50 rounded-lg mb-4">
        <p className="text-sm text-gray-700">
          <i className="fa-solid fa-lightbulb text-pink-500 mr-2"></i>
          激活皮肤后，桌面所有窗口将应用该皮肤外观，并永久获得暴击率加成。
        </p>
        <p className="text-xs text-gray-500 mt-2">
          当前激活：{activeSkinId ? WINDOW_SKINS.find((s) => s.id === activeSkinId)?.name : '默认蓝'}
          {activeSkinId && (
            <span className="ml-2 text-green-600">
              暴击 +{WINDOW_SKINS.find((s) => s.id === activeSkinId)?.critBonus}%
            </span>
          )}
        </p>
      </div>

      {message && (
        <div className={`p-3 rounded-lg mb-4 text-sm ${
          message.type === 'success' ? 'bg-green-50 text-green-700' :
          message.type === 'error' ? 'bg-red-50 text-red-700' :
          'bg-blue-50 text-blue-700'
        }`}>
          {message.text}
        </div>
      )}

      {/* 已拥有的皮肤（积分兑换类） */}
      {ownedSkinsList.length === 0 ? (
        <div className="text-center py-6">
          <i className="fa-solid fa-box-open text-4xl text-gray-300 mb-3"></i>
          <p className="text-gray-500 mb-2">您还没有可兑换的皮肤</p>
          <p className="text-sm text-gray-400">
            <i className="fa-solid fa-gift mr-1"></i>
            前往「兑换中心」兑换皮肤奖品
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {/* 默认皮肤卡片 */}
          <SkinCard
            skin={DEFAULT_SKIN}
            isActive={activeSkinId === null}
            isOwned={true}
            onActivate={() => handleActivateSkin(null)}
            loading={loading}
          />
          {ownedSkinsList.map((skin) => (
            <SkinCard
              key={skin.id}
              skin={skin}
              isActive={activeSkinId === skin.id}
              isOwned={true}
              onActivate={() => handleActivateSkin(skin.id)}
              loading={loading}
            />
          ))}
        </div>
      )}

      {/* 段位专属皮肤：达到段位永久解锁，掉段不回收 */}
      <div className="mt-6">
        <div className="flex items-center gap-2 mb-1">
          <i className="fa-solid fa-crown text-amber-500"></i>
          <h4 className="font-bold text-gray-800">段位专属皮肤</h4>
          <span className="text-xs text-gray-400">
            当前段位：
            <span className="text-purple-600 font-medium">
              {['小学生', '初中生', '高中生', '本科生', '研究生'][myTier] || '小学生'}
            </span>
          </span>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          达到对应 PK 段位即<span className="text-amber-600 font-medium">永久解锁</span>，无需积分、掉段也不回收。
          每套皮肤附带更高的暴击率加成，是实力的证明。
        </p>
        <div className="grid grid-cols-2 gap-3">
          {rankSkinsList.map((skin) => {
            const requiredTier = skin.requiredRankTier ?? 0;
            const owned = ownedSkinIds.includes(skin.id);
            return (
              <SkinCard
                key={skin.id}
                skin={skin}
                isActive={activeSkinId === skin.id}
                isOwned={owned}
                onActivate={() => handleActivateSkin(skin.id)}
                loading={loading}
                // 未解锁时额外提示所需段位，明确"再升几级能拿到"
                lockedHint={`需达到「${skin.rankName || ''}」段位${
                  requiredTier > myTier ? `（还差 ${requiredTier - myTier} 级）` : ''
                }`}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};

// 皮肤卡片组件
interface SkinCardProps {
  skin: WindowSkinConfig;
  isActive: boolean;
  isOwned: boolean;
  onActivate: () => void;
  loading: boolean;
  /** 未拥有时的解锁提示（段位皮肤用：「需达到『高中生』段位（还差 1 级）」） */
  lockedHint?: string;
}

const SkinCard: React.FC<SkinCardProps> = ({
  skin,
  isActive,
  isOwned,
  onActivate,
  loading,
  lockedHint,
}) => {
  return (
    <motion.div
      whileHover={isOwned ? { scale: 1.02 } : {}}
      className={`relative rounded-lg overflow-hidden border-2 transition-all ${
        isActive
          ? 'border-pink-500 ring-2 ring-pink-300'
          : isOwned
          ? TIER_BORDER_COLORS[skin.tier]
          : 'border-gray-200 opacity-50'
      }`}
    >
      {/* 段位徽标：一眼看出这是段位专属皮肤 */}
      {skin.unlockSource === 'rank' && (
        <span className="absolute top-1 left-1 z-10 px-1.5 py-0.5 bg-black/50 text-white text-[10px] rounded">
          {isOwned ? '👑 已解锁' : `🔒 ${skin.rankName || ''}`}
        </span>
      )}
      {/* 预览区：模拟窗口标题栏 */}
      <div className={`relative h-16 ${skin.titleBarClass} flex items-center justify-between px-3 overflow-hidden`}>
        <span className={`${skin.titleTextClass} text-xs font-medium truncate`}>
          {skin.previewEmoji} 窗口预览
        </span>
        <div className="flex gap-1">
          <div className={`w-2 h-2 rounded-full ${skin.titleTextClass} opacity-60`}></div>
          <div className={`w-2 h-2 rounded-full ${skin.titleTextClass} opacity-60`}></div>
          <div className="w-2 h-2 rounded-full bg-red-400"></div>
        </div>
      </div>
      {/* 内容区预览 */}
      <div className={`h-8 ${skin.contentBgClass} flex items-center px-3`}>
        <div className="flex gap-1">
          <div className="w-6 h-1.5 bg-gray-300 rounded-full"></div>
          <div className="w-4 h-1.5 bg-gray-300 rounded-full"></div>
        </div>
      </div>

      {/* 皮肤信息 */}
      <div className="p-2.5 bg-white">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-bold text-gray-800">{skin.name}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${TIER_BG_COLORS[skin.tier]}`}>
            {TIER_LABELS[skin.tier]}
          </span>
        </div>
        <p className="text-[11px] text-gray-500 mb-2 truncate">{skin.description}</p>
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-orange-600 font-medium">
            <i className="fa-solid fa-bolt mr-0.5"></i>
            暴击 +{skin.critBonus}%
          </span>
          {isActive ? (
            <span className="text-[11px] text-pink-600 font-medium">
              <i className="fa-solid fa-check mr-0.5"></i>已激活
            </span>
          ) : isOwned ? (
            <button
              onClick={onActivate}
              disabled={loading}
              className="text-[11px] px-2 py-0.5 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 transition-colors"
            >
              激活
            </button>
          ) : lockedHint ? (
            <span className="text-[10px] text-gray-400">
              <i className="fa-solid fa-lock mr-0.5"></i>未解锁
            </span>
          ) : null}
        </div>
        {/* 未解锁的段位皮肤：明确告知怎么拿到，形成升级动力 */}
        {!isOwned && lockedHint && (
          <p className="text-[10px] text-amber-600 mt-1.5 text-center bg-amber-50 rounded py-0.5">
            {lockedHint}
          </p>
        )}
      </div>
    </motion.div>
  );
};
