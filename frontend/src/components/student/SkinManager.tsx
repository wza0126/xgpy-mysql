import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { API_CONFIG } from '../../api/config';
import { WINDOW_SKINS, TIER_LABELS, TIER_BG_COLORS, TIER_BORDER_COLORS, WindowSkinConfig, DEFAULT_SKIN } from '../../config/windowSkins';
import { useSkinStore } from '../../store/skinStore';

interface OwnedSkin {
  skin_id: string;
  acquired_at: string;
}

export const SkinManager: React.FC = () => {
  const [ownedSkins, setOwnedSkins] = useState<OwnedSkin[]>([]);
  const [activeSkinId, setActiveSkinId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const { setActiveSkin: setStoreSkin } = useSkinStore();

  useEffect(() => {
    fetchMySkins();
  }, []);

  const fetchMySkins = async () => {
    try {
      const token = localStorage.getItem('xgpy_token');
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

  const handleActivateSkin = async (skinId: string | null) => {
    setLoading(true);
    setMessage(null);
    try {
      const token = localStorage.getItem('xgpy_token');
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
  const ownedSkinsList = WINDOW_SKINS.filter((s) => ownedSkinIds.includes(s.id));

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

      {/* 已拥有的皮肤 */}
      {ownedSkinsList.length === 0 ? (
        <div className="text-center py-8">
          <i className="fa-solid fa-box-open text-4xl text-gray-300 mb-3"></i>
          <p className="text-gray-500 mb-2">您还没有任何皮肤</p>
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
}

const SkinCard: React.FC<SkinCardProps> = ({ skin, isActive, isOwned, onActivate, loading }) => {
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
          ) : null}
        </div>
      </div>
    </motion.div>
  );
};
