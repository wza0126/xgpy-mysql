import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { backendClient } from '../../api/backendClient';
import { Prize, InternetCode, Class, PrizeClassVisibility } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { formatDateTime } from '../../utils/dateUtils';
import { LicenseGuard } from '../common/LicenseGuard';
import { WINDOW_SKINS, TIER_LABELS } from '../../config/windowSkins';

const PAGE_SIZE = 100;

type PrizeFormData = {
  name: string;
  description: string;
  points_cost: number;
  type: 'normal' | 'internet_code' | 'equipment' | 'skin';
  stock: number;
  daily_limit: number;
  is_active: boolean;
  equipment_id: string | null;
  skin_id: string | null;
};

export const PrizeManager: React.FC = () => {
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [codes, setCodes] = useState<InternetCode[]>([]);
  const [codeStats, setCodeStats] = useState({ total: 0, used: 0, unused: 0 });
  const [loading, setLoading] = useState(true);
  const [showPrizeModal, setShowPrizeModal] = useState(false);
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [showClassConfigModal, setShowClassConfigModal] = useState(false);
  const [editingPrize, setEditingPrize] = useState<Prize | null>(null);
  const [selectedPrizeForClass, setSelectedPrizeForClass] = useState<Prize | null>(null);
  const [classes, setClasses] = useState<Class[]>([]);
  const [prizeClassVisibility, setPrizeClassVisibility] = useState<PrizeClassVisibility[]>([]);
  const [newCodes, setNewCodes] = useState('');
  const [currentPage, setCurrentPage] = useState(0);
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set());
  const [formData, setFormData] = useState<PrizeFormData>({
    name: '',
    description: '',
    points_cost: 0,
    type: 'normal',
    stock: -1,
    daily_limit: 0,
    is_active: true,
    equipment_id: null,
    skin_id: null,
  });
  const [equipments, setEquipments] = useState<any[]>([]);
  const { profile } = useAuth();

  useEffect(() => {
    if (profile) {
      fetchData();
    }
  }, [profile, currentPage]);

  const fetchData = async () => {
    try {
      const [{ data: prizesData, error: prizesError }, { data: codesData, error: codesError }, { count: totalCount }, { count: usedCount }, { data: classesData }, equipResult] = await Promise.all([
        backendClient.from('prizes').select('*'),
        backendClient.from('internet_codes').select('*').range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1),
        backendClient.from('internet_codes').count(),
        backendClient.from('internet_codes').eq('is_used', true).count(),
        backendClient.from('classes').select('*'),
        backendClient.get('/api/teacher/equipments'),
      ]);

      if (prizesError) {
        console.error('获取奖品失败:', prizesError);
      } else if (prizesData) {
        setPrizes(prizesData as Prize[]);
      }

      if (codesError) {
        console.error('获取认证码失败:', codesError);
      } else if (codesData) {
        setCodes(codesData as InternetCode[]);
      }

      if (classesData) {
        setClasses(classesData as Class[]);
      }

      if (equipResult?.data) {
        setEquipments(equipResult.data);
      }

      const total = totalCount || 0;
      const used = usedCount || 0;
      setCodeStats({
        total,
        used,
        unused: total - used,
      });
    } catch (error) {
      console.error('获取数据失败:', error);
    }
    setLoading(false);
  };

  const fetchPrizeClassVisibility = async (prizeId: string) => {
    const { data } = await backendClient
      .from('prize_class_visibility')
      .select('*')
      .eq('prize_id', prizeId);
    if (data) {
      setPrizeClassVisibility(data as PrizeClassVisibility[]);
    }
  };

  const handleOpenClassConfig = async (prize: Prize) => {
    setSelectedPrizeForClass(prize);
    await fetchPrizeClassVisibility(prize.id);
    setShowClassConfigModal(true);
  };

  const handleToggleClassVisibility = async (classId: string, isVisible: boolean) => {
    if (!selectedPrizeForClass) return;

    const existing = prizeClassVisibility.find(v => v.class_id === classId);

    if (existing) {
      await backendClient
        .from('prize_class_visibility')
        .update({ is_visible: isVisible })
        .eq('id', existing.id);
    } else {
      await backendClient
        .from('prize_class_visibility')
        .insert({
          prize_id: selectedPrizeForClass.id,
          class_id: classId,
          is_visible: isVisible,
        });
    }

    await fetchPrizeClassVisibility(selectedPrizeForClass.id);
  };

  const isPrizeVisibleToClass = (classId: string) => {
    const visibility = prizeClassVisibility.find(v => v.class_id === classId);
    return visibility ? visibility.is_visible : true;
  };

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [showCleanupConfirm, setShowCleanupConfirm] = useState(false);

  const handleDeletePrize = (id: string) => {
    setDeleteTargetId(id);
    setShowDeleteConfirm(true);
  };

  const confirmDeletePrize = async () => {
    if (!deleteTargetId) return;
    await backendClient.from('prizes').delete().eq('id', deleteTargetId);
    setShowDeleteConfirm(false);
    setDeleteTargetId(null);
    fetchData();
  };

  const handleCleanupCodes = () => {
    setShowCleanupConfirm(true);
  };

  const handleSelectCode = (codeId: string, selected: boolean) => {
    const newSelected = new Set(selectedCodes);
    if (selected) {
      newSelected.add(codeId);
    } else {
      newSelected.delete(codeId);
    }
    setSelectedCodes(newSelected);
  };

  const handleSelectAllCodes = (selected: boolean) => {
    if (selected) {
      setSelectedCodes(new Set(codes.map(c => c.id)));
    } else {
      setSelectedCodes(new Set());
    }
  };

  const handleBatchDeleteCodes = async () => {
    if (selectedCodes.size === 0) return;
    const confirmed = window.confirm(`确定要删除选中的 ${selectedCodes.size} 个认证码吗？`);
    if (!confirmed) return;

    try {
      const { error } = await backendClient
        .from('internet_codes')
        .delete()
        .in('id', Array.from(selectedCodes));

      if (error) throw error;
      setSelectedCodes(new Set());
      fetchData();
    } catch (error) {
      console.error('批量删除认证码失败:', error);
      alert('删除失败: ' + (error as Error).message);
    }
  };

  const confirmCleanupCodes = async () => {
    try {
      const { data, error } = await backendClient.rpc('cleanup_old_used_codes');
      if (error) throw error;
      setShowCleanupConfirm(false);
      alert(`清理完成，已删除 ${data?.count || 0} 条记录`);
      fetchData();
    } catch (error) {
      console.error('清理认证码失败:', error);
      alert('清理失败: ' + (error as Error).message);
    }
  };

  const handleSavePrize = async () => {
    if (!profile) return;

    try {
      const data = { ...formData };

      if (editingPrize) {
        const { error } = await backendClient.from('prizes').update(data).eq('id', editingPrize.id);
        if (error) throw error;
      } else {
        const { error } = await backendClient.from('prizes').insert(data);
        if (error) throw error;
      }

      setShowPrizeModal(false);
      setEditingPrize(null);
      resetForm();
      fetchData();
    } catch (error) {
      console.error('保存奖品失败:', error);
      alert('保存奖品失败: ' + (error as Error).message);
    }
  };


  const handleTogglePrizeActive = async (prize: Prize) => {
    const { error } = await backendClient
      .from('prizes')
      .update({ is_active: !prize.is_active })
      .eq('id', prize.id);

    if (error) {
      console.error('切换奖品状态失败:', error);
      alert('操作失败: ' + error.message);
    } else {
      fetchData();
    }
  };

  const handleAddCodes = async () => {
    if (!newCodes.trim()) return;

    try {
      const codeList = newCodes.split('\n').map((c) => c.trim()).filter(Boolean);
      const inserts = codeList.map((code) => ({ code }));

      const { error } = await backendClient.from('internet_codes').insert(inserts);
      if (error) throw error;

      setNewCodes('');
      setShowCodeModal(false);
      fetchData();
    } catch (error) {
      console.error('导入认证码失败:', error);
      alert('导入认证码失败: ' + (error as Error).message);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      points_cost: 0,
      type: 'normal',
      stock: -1,
      daily_limit: 0,
      is_active: true,
      equipment_id: null,
      skin_id: null,
    });
  };

  const openEdit = (prize: Prize) => {
    setEditingPrize(prize);
    setFormData({
      name: prize.name,
      description: prize.description || '',
      points_cost: prize.points_cost || 0,
      type: prize.type,
      stock: prize.stock || -1,
      daily_limit: prize.daily_limit || 0,
      is_active: prize.is_active || false,
      equipment_id: (prize as any).equipment_id || null,
      skin_id: (prize as any).skin_id || null,
    });
    setShowPrizeModal(true);
  };

  const totalPages = Math.ceil(codeStats.total / PAGE_SIZE);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <i className="fa-solid fa-circle-notch fa-spin text-3xl text-blue-500"></i>
      </div>
    );
  }

  return (
    <LicenseGuard featureName="积分兑换管理" featureIcon="fa-gift">
      <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">积分兑换管理</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCodeModal(true)}
            className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors"
          >
            <i className="fa-solid fa-wifi mr-2"></i>
            导入认证码
          </button>
          <button
            onClick={() => {
              setEditingPrize(null);
              resetForm();
              setShowPrizeModal(true);
            }}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            <i className="fa-solid fa-plus mr-2"></i>
            添加奖品
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-6">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-4 text-left text-sm font-medium text-gray-600">奖品名称</th>
              <th className="px-6 py-4 text-left text-sm font-medium text-gray-600">类型</th>
              <th className="px-6 py-4 text-center text-sm font-medium text-gray-600">所需积分</th>
              <th className="px-6 py-4 text-center text-sm font-medium text-gray-600">库存</th>
              <th className="px-6 py-4 text-center text-sm font-medium text-gray-600">每日限制</th>
              <th className="px-6 py-4 text-center text-sm font-medium text-gray-600">状态</th>
              <th className="px-6 py-4 text-right text-sm font-medium text-gray-600">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {prizes.map((prize) => (
              <tr key={prize.id} className="hover:bg-gray-50">
                <td className="px-6 py-4">
                  <p className="font-medium text-gray-800">{prize.name}</p>
                  <p className="text-sm text-gray-500">{prize.description}</p>
                </td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-1 rounded-full text-xs ${
                    prize.type === 'internet_code' ? 'bg-purple-100 text-purple-600' :
                    prize.type === 'equipment' ? 'bg-orange-100 text-orange-600' :
                    prize.type === 'skin' ? 'bg-pink-100 text-pink-600' :
                    'bg-blue-100 text-blue-600'
                  }`}>
                    {prize.type === 'internet_code' ? '上网认证码' :
                     prize.type === 'equipment' ? '装备奖品' :
                     prize.type === 'skin' ? '皮肤奖品' :
                     '普通奖品'}
                  </span>
                </td>
                <td className="px-6 py-4 text-center text-yellow-600 font-medium">{prize.points_cost}</td>
                <td className="px-6 py-4 text-center text-gray-600">
                  {prize.stock === -1 ? '无限' : prize.stock}
                </td>
                <td className="px-6 py-4 text-center text-gray-600">
                  {prize.daily_limit > 0 ? `${prize.daily_limit}个/天` : '无限制'}
                </td>
                <td className="px-6 py-4 text-center">
                  <span className={`px-2 py-1 rounded-full text-xs ${
                    prize.is_active ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {prize.is_active ? '启用' : '禁用'}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex gap-2 justify-end items-center">
                    <label className="flex items-center gap-1 cursor-pointer mr-2">
                      <input
                        type="checkbox"
                        checked={prize.is_active}
                        onChange={() => handleTogglePrizeActive(prize)}
                        className="rounded text-blue-500 focus:ring-blue-500"
                      />
                      <span className="text-xs text-gray-600">{prize.is_active ? '启用' : '禁用'}</span>
                    </label>
                    {prize.type === 'internet_code' && (
                      <button
                        onClick={() => handleOpenClassConfig(prize)}
                        className="text-purple-600 hover:bg-purple-50 px-2 py-1 rounded transition-colors"
                        title="班级配置"
                      >
                        <i className="fa-solid fa-users-cog"></i>
                      </button>
                    )}
                    <button
                      onClick={() => openEdit(prize)}
                      className="text-blue-600 hover:bg-blue-50 px-2 py-1 rounded transition-colors"
                    >
                      <i className="fa-solid fa-edit"></i>
                    </button>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleDeletePrize(prize.id);
                      }}
                      className="text-red-600 hover:bg-red-50 px-2 py-1 rounded transition-colors"
                      type="button"
                    >
                      <i className="fa-solid fa-trash"></i>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {prizes.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <i className="fa-solid fa-gift text-4xl mb-4"></i>
            <p>暂无奖品</p>
          </div>
        )}
      </div>

      {codes.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-gray-800">认证码管理</h3>
            <div className="flex items-center gap-4">
              <div className="flex gap-4 text-sm">
                <span className="text-gray-600">总数: <span className="font-bold text-blue-600">{codeStats.total}</span></span>
                <span className="text-gray-600">已使用: <span className="font-bold text-red-600">{codeStats.used}</span></span>
                <span className="text-gray-600">未使用: <span className="font-bold text-green-600">{codeStats.unused}</span></span>
              </div>
              {selectedCodes.size > 0 && (
                <button
                  onClick={handleBatchDeleteCodes}
                  className="px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
                >
                  <i className="fa-solid fa-trash mr-1"></i>
                  删除选中 ({selectedCodes.size})
                </button>
              )}
              <button
                onClick={handleCleanupCodes}
                className="px-3 py-1 text-sm bg-orange-500 text-white rounded hover:bg-orange-600 transition-colors"
              >
                <i className="fa-solid fa-broom mr-1"></i>
                清理旧码
              </button>
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedCodes.size === codes.length && codes.length > 0}
                        onChange={(e) => handleSelectAllCodes(e.target.checked)}
                        className="rounded text-blue-500 focus:ring-blue-500"
                      />
                      <span>全选</span>
                    </label>
                  </th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">认证码</th>
                  <th className="px-6 py-3 text-center text-sm font-medium text-gray-600">状态</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">使用者</th>
                  <th className="px-6 py-3 text-right text-sm font-medium text-gray-600">使用时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {codes.map((code) => (
                  <tr key={code.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedCodes.has(code.id)}
                        onChange={(e) => handleSelectCode(code.id, e.target.checked)}
                        className="rounded text-blue-500 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-6 py-3 font-mono text-gray-800">{code.code}</td>
                    <td className="px-6 py-3 text-center">
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        code.is_used ? 'bg-gray-100 text-gray-600' : 'bg-green-100 text-green-600'
                      }`}>
                        {code.is_used ? '已使用' : '未使用'}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-sm text-gray-600">
                      {code.used_by_username || (code.used_by ? '未知用户' : '-')}
                    </td>
                    <td className="px-6 py-3 text-right text-gray-500">
                      {code.used_at ? formatDateTime(code.used_at) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 py-4 border-t border-gray-200">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                  disabled={currentPage === 0}
                  className="px-3 py-1 text-sm bg-gray-100 text-gray-600 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  上一页
                </button>
                <span className="text-sm text-gray-600">
                  第 {currentPage + 1} / {totalPages} 页
                </span>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={currentPage >= totalPages - 1}
                  className="px-3 py-1 text-sm bg-gray-100 text-gray-600 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  下一页
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <AnimatePresence>
        {showPrizeModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setShowPrizeModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="bg-white rounded-2xl p-6 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-gray-800 mb-4">
                {editingPrize ? '编辑奖品' : '添加奖品'}
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">奖品名称</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full p-3 border border-gray-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
                  <input
                    type="text"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full p-3 border border-gray-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">类型</label>
                  <select
                    value={formData.type}
                    onChange={(e) => {
                      const newType = e.target.value as 'normal' | 'internet_code' | 'equipment' | 'skin';
                      setFormData({
                        ...formData,
                        type: newType,
                        equipment_id: newType === 'equipment' ? formData.equipment_id : null,
                        skin_id: newType === 'skin' ? formData.skin_id : null,
                      });
                    }}
                    className="w-full p-3 border border-gray-300 rounded-lg"
                  >
                    <option value="normal">普通奖品</option>
                    <option value="internet_code">上网认证码</option>
                    <option value="equipment">装备奖品</option>
                    <option value="skin">皮肤奖品</option>
                  </select>
                </div>

                {formData.type === 'equipment' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">选择装备</label>
                    <select
                      value={formData.equipment_id || ''}
                      onChange={(e) => setFormData({ ...formData, equipment_id: e.target.value || null })}
                      className="w-full p-3 border border-gray-300 rounded-lg"
                    >
                      <option value="">请选择装备...</option>
                      {equipments.filter(eq => eq.is_active).map((eq) => (
                        <option key={eq.id} value={eq.id}>
                          {eq.icon} {eq.name} (暴击+{eq.crit_bonus}%)
                        </option>
                      ))}
                    </select>
                    {equipments.filter(eq => eq.is_active).length === 0 && (
                      <p className="text-xs text-red-500 mt-1">请先在「打怪系统-装备管理」中添加装备</p>
                    )}
                  </div>
                )}

                {formData.type === 'skin' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">选择皮肤</label>
                    <select
                      value={formData.skin_id || ''}
                      onChange={(e) => {
                        const skinId = e.target.value || null;
                        const skin = WINDOW_SKINS.find(s => s.id === skinId);
                        setFormData({
                          ...formData,
                          skin_id: skinId,
                          name: skin ? `${skin.name}（皮肤）` : formData.name,
                          description: skin ? skin.description : formData.description,
                          points_cost: skin ? skin.pointsCost : formData.points_cost,
                        });
                      }}
                      className="w-full p-3 border border-gray-300 rounded-lg"
                    >
                      <option value="">请选择皮肤...</option>
                      {WINDOW_SKINS.map((skin) => (
                        <option key={skin.id} value={skin.id}>
                          {skin.previewEmoji} {skin.name} [{TIER_LABELS[skin.tier]}] 暴击+{skin.critBonus}% (建议{skin.pointsCost}积分)
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">所需积分</label>
                  <input
                    type="number"
                    value={formData.points_cost}
                    onChange={(e) => setFormData({ ...formData, points_cost: parseInt(e.target.value) || 0 })}
                    className="w-full p-3 border border-gray-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">库存 (-1为无限)</label>
                  <input
                    type="number"
                    value={formData.stock}
                    onChange={(e) => setFormData({ ...formData, stock: parseInt(e.target.value) || -1 })}
                    className="w-full p-3 border border-gray-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">每日兑换限制 (0为无限制)</label>
                  <input
                    type="number"
                    value={formData.daily_limit}
                    onChange={(e) => setFormData({ ...formData, daily_limit: parseInt(e.target.value) || 0 })}
                    className="w-full p-3 border border-gray-300 rounded-lg"
                  />
                </div>

                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.is_active}
                    onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                    className="rounded"
                  />
                  <span>启用</span>
                </label>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowPrizeModal(false)}
                  className="flex-1 py-2 bg-gray-200 text-gray-700 rounded-lg"
                >
                  取消
                </button>
                <button
                  onClick={handleSavePrize}
                  disabled={!formData.name || (formData.type === 'equipment' && !formData.equipment_id) || (formData.type === 'skin' && !formData.skin_id)}
                  className="flex-1 py-2 bg-blue-500 text-white rounded-lg disabled:opacity-50"
                >
                  保存
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCodeModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setShowCodeModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="bg-white rounded-2xl p-6 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-gray-800 mb-4">导入上网认证码</h3>
              <p className="text-sm text-gray-500 mb-4">每行输入一个认证码</p>
              <textarea
                value={newCodes}
                onChange={(e) => setNewCodes(e.target.value)}
                className="w-full h-40 p-3 border border-gray-300 rounded-lg"
                placeholder="CODE001&#10;CODE002&#10;CODE003"
              />
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowCodeModal(false)}
                  className="flex-1 py-2 bg-gray-200 text-gray-700 rounded-lg"
                >
                  取消
                </button>
                <button
                  onClick={handleAddCodes}
                  disabled={!newCodes.trim()}
                  className="flex-1 py-2 bg-purple-500 text-white rounded-lg disabled:opacity-50"
                >
                  导入
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showDeleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setShowDeleteConfirm(false)}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="bg-white rounded-2xl p-6 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-gray-800 mb-4">
                <i className="fa-solid fa-exclamation-triangle text-red-500 mr-2"></i>
                确认删除
              </h3>
              <p className="text-gray-600 mb-6">
                确定要删除这个奖品吗？此操作不可恢复！
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setDeleteTargetId(null);
                  }}
                  className="flex-1 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={confirmDeletePrize}
                  className="flex-1 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                >
                  确认删除
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCleanupConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setShowCleanupConfirm(false)}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="bg-white rounded-2xl p-6 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-gray-800 mb-4">
                <i className="fa-solid fa-exclamation-triangle text-orange-500 mr-2"></i>
                确认清理
              </h3>
              <p className="text-gray-600 mb-6">
                确定要清理一周前已使用的认证码吗？此操作不可恢复！
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowCleanupConfirm(false)}
                  className="flex-1 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={confirmCleanupCodes}
                  className="flex-1 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
                >
                  确认清理
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showClassConfigModal && selectedPrizeForClass && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setShowClassConfigModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="bg-white rounded-2xl p-6 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-gray-800 mb-2">
                <i className="fa-solid fa-users-cog text-purple-500 mr-2"></i>
                班级可见性配置
              </h3>
              <p className="text-sm text-gray-500 mb-4">
                奖品: {selectedPrizeForClass.name}
              </p>

              <div className="space-y-2 max-h-80 overflow-y-auto">
                {classes.length === 0 ? (
                  <p className="text-gray-500 text-center py-4">暂无班级数据</p>
                ) : (
                  classes.map((cls) => (
                    <div
                      key={cls.id}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <i className="fa-solid fa-users text-gray-400"></i>
                        <span className="font-medium text-gray-700">{cls.name}</span>
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isPrizeVisibleToClass(cls.id)}
                          onChange={(e) => handleToggleClassVisibility(cls.id, e.target.checked)}
                          className="rounded text-purple-500 focus:ring-purple-500 w-5 h-5"
                        />
                        <span className="text-sm text-gray-600">
                          {isPrizeVisibleToClass(cls.id) ? '可见' : '隐藏'}
                        </span>
                      </label>
                    </div>
                  ))
                )}
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowClassConfigModal(false)}
                  className="flex-1 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  关闭
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    </LicenseGuard>
  );
};
