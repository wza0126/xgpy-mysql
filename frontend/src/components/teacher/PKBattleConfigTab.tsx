import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { backendClient } from '../../api/backendClient';

// 聚类树：一级类目 → 二级类目集合（与 ExamManager 同款定义）
type ClusterTree = Record<string, Set<string>>;

// 把 cluster_id 拆成 [一级, 二级]；无斜杠时二级为空串
const splitCluster = (clusterId: string | null | undefined): [string, string] | null => {
  if (!clusterId || typeof clusterId !== 'string') return null;
  const trimmed = clusterId.trim();
  if (!trimmed) return null;
  const idx = trimmed.indexOf('/');
  if (idx < 0) return [trimmed, ''];
  const primary = trimmed.slice(0, idx).trim();
  const secondary = trimmed.slice(idx + 1).trim();
  return primary ? [primary, secondary] : null;
};

// 解析 JSON 字段为 string[]（兼容已解析数组 / JSON 字符串 / 逗号分隔）
const parseJsonArray = (v: any): string[] => {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return v.split(',').map((t: string) => t.trim()).filter(Boolean);
    }
  }
  return [];
};

const toBool = (v: any) => v === true || v === 1 || v === '1';

interface PKBattleConfig {
  id: string;
  teacher_id: string;
  name: string;
  mode: 'timed' | 'rush';
  duration_seconds: number;
  question_count: number;
  tag_filters: string[] | string | null;
  cluster_filters: string[] | string | null;
  difficulty_min: number | null;
  difficulty_max: number | null;
  is_active: number | boolean;
  daily_limit: number | null;
  qualification_correct_count: number | null;
  created_at: string;
  updated_at: string;
}

interface Props {
  clusterTree: ClusterTree;
  allTags: string[];
}

export const PKBattleConfigTab: React.FC<Props> = ({ clusterTree, allTags }) => {
  const [configs, setConfigs] = useState<PKBattleConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    mode: 'timed' as 'timed' | 'rush',
    duration_seconds: 180,
    question_count: 20,
    difficulty_min: '' as string | number,
    difficulty_max: '' as string | number,
    is_active: true,
    daily_limit: '' as string | number,
    qualification_correct_count: '' as string | number,
  });
  // 表单内筛选 state（独立于 ExamManager 的题目选择器筛选）
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [filterClusterPrimary, setFilterClusterPrimary] = useState<string[]>([]);
  const [filterClusterSecondary, setFilterClusterSecondary] = useState<string[]>([]);

  useEffect(() => {
    fetchConfigs();
  }, []);

  const fetchConfigs = async () => {
    setLoading(true);
    try {
      const { data, error } = await backendClient.get('/api/pk/battle-configs');
      if (error) {
        console.error('查对战配置失败:', error);
      } else {
        setConfigs((data || []) as PKBattleConfig[]);
      }
    } catch (e) {
      console.error('查对战配置异常:', e);
    }
    setLoading(false);
  };

  const resetForm = () => {
    setFormData({
      name: '',
      mode: 'timed',
      duration_seconds: 180,
      question_count: 20,
      difficulty_min: '',
      difficulty_max: '',
      is_active: true,
      daily_limit: '',
      qualification_correct_count: '',
    });
    setFilterTags([]);
    setFilterClusterPrimary([]);
    setFilterClusterSecondary([]);
    setEditingId(null);
  };

  const openCreate = () => {
    resetForm();
    setShowModal(true);
  };

  const openEdit = (cfg: PKBattleConfig) => {
    setFormData({
      name: cfg.name || '',
      mode: (cfg.mode as 'timed' | 'rush') || 'timed',
      duration_seconds: cfg.duration_seconds || 180,
      question_count: cfg.question_count || 20,
      difficulty_min: cfg.difficulty_min ?? '',
      difficulty_max: cfg.difficulty_max ?? '',
      is_active: toBool(cfg.is_active),
      daily_limit: cfg.daily_limit ?? '',
      qualification_correct_count: cfg.qualification_correct_count ?? '',
    });
    setFilterTags(parseJsonArray(cfg.tag_filters));
    // 还原聚类选中状态：fullKey 列表 → 一级 + 二级
    const clusterList = parseJsonArray(cfg.cluster_filters);
    const primarySet = new Set<string>();
    const secondary: string[] = [];
    clusterList.forEach((fullKey) => {
      const parts = splitCluster(fullKey);
      if (parts) {
        const [p, s] = parts;
        primarySet.add(p);
        if (s) secondary.push(fullKey);
      }
    });
    setFilterClusterPrimary(Array.from(primarySet));
    setFilterClusterSecondary(secondary);
    setEditingId(cfg.id);
    setShowModal(true);
  };

  const toggleClusterPrimary = (primary: string) => {
    setFilterClusterPrimary((prev) => {
      if (prev.includes(primary)) {
        const prefix = `${primary}/`;
        setFilterClusterSecondary((sec) => sec.filter((s) => !s.startsWith(prefix)));
        return prev.filter((p) => p !== primary);
      }
      return [...prev, primary];
    });
  };

  const toggleClusterSecondary = (fullKey: string) => {
    setFilterClusterSecondary((prev) =>
      prev.includes(fullKey) ? prev.filter((s) => s !== fullKey) : [...prev, fullKey]
    );
  };

  const toggleTag = (tag: string) => {
    setFilterTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  // 计算 cluster_filters：完整 cluster_id fullKey 列表（与后端 battleEngine 的 cluster_id IN(...) 精确匹配一致）
  // 只选一级未选二级时，展开为该一级下所有二级 fullKey；一级下无二级时存一级 primary
  const buildClusterFilters = (): string[] => {
    const result: string[] = [...filterClusterSecondary];
    filterClusterPrimary.forEach((p) => {
      const hasSelectedSecondary = filterClusterSecondary.some((s) => s.startsWith(`${p}/`));
      if (!hasSelectedSecondary) {
        const secondaries = Array.from(clusterTree[p] || []);
        if (secondaries.length > 0) {
          result.push(...secondaries.map((s) => `${p}/${s}`));
        } else {
          result.push(p);
        }
      }
    });
    return Array.from(new Set(result));
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      alert('请输入活动名称');
      return;
    }
    setSaving(true);
    const clusterFilters = buildClusterFilters();
    const payload = {
      name: formData.name.trim(),
      mode: formData.mode,
      duration_seconds: Number(formData.duration_seconds) || 180,
      question_count: Number(formData.question_count) || 20,
      tag_filters: filterTags.length > 0 ? filterTags : null,
      cluster_filters: clusterFilters.length > 0 ? clusterFilters : null,
      difficulty_min: formData.difficulty_min === '' ? null : Number(formData.difficulty_min),
      difficulty_max: formData.difficulty_max === '' ? null : Number(formData.difficulty_max),
      is_active: formData.is_active,
      daily_limit: formData.daily_limit === '' ? null : Number(formData.daily_limit),
      qualification_correct_count:
        formData.qualification_correct_count === ''
          ? null
          : Number(formData.qualification_correct_count),
    };
    try {
      if (editingId) {
        const { error } = await backendClient.put(`/api/pk/battle-configs/${editingId}`, payload);
        if (error) {
          alert('保存失败: ' + (error.message || JSON.stringify(error)));
          setSaving(false);
          return;
        }
      } else {
        const { error } = await backendClient.post('/api/pk/battle-configs', payload);
        if (error) {
          alert('创建失败: ' + (error.message || JSON.stringify(error)));
          setSaving(false);
          return;
        }
      }
      setShowModal(false);
      resetForm();
      fetchConfigs();
    } catch (e) {
      alert('保存失败: ' + ((e as Error).message || String(e)));
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('确定删除此对战配置吗？此操作不可恢复。')) return;
    try {
      const { error } = await backendClient.delete(`/api/pk/battle-configs/${id}`);
      if (error) {
        alert('删除失败: ' + (error.message || JSON.stringify(error)));
        return;
      }
      fetchConfigs();
    } catch (e) {
      alert('删除失败: ' + ((e as Error).message || String(e)));
    }
  };

  // 启用/禁用切换：需带上全部字段（后端 PUT 为全量更新）
  const handleToggleActive = async (cfg: PKBattleConfig) => {
    const tags = parseJsonArray(cfg.tag_filters);
    const clusters = parseJsonArray(cfg.cluster_filters);
    try {
      const { error } = await backendClient.put(`/api/pk/battle-configs/${cfg.id}`, {
        name: cfg.name,
        mode: cfg.mode,
        duration_seconds: cfg.duration_seconds,
        question_count: cfg.question_count,
        tag_filters: tags.length > 0 ? tags : null,
        cluster_filters: clusters.length > 0 ? clusters : null,
        difficulty_min: cfg.difficulty_min,
        difficulty_max: cfg.difficulty_max,
        is_active: !toBool(cfg.is_active),
        daily_limit: cfg.daily_limit,
        qualification_correct_count: cfg.qualification_correct_count,
      });
      if (error) {
        alert('切换失败: ' + (error.message || JSON.stringify(error)));
        return;
      }
      fetchConfigs();
    } catch (e) {
      alert('切换失败: ' + ((e as Error).message || String(e)));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <i className="fa-solid fa-circle-notch fa-spin text-3xl text-purple-500"></i>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-bold text-gray-800">PK 对战配置</h3>
          <p className="text-sm text-gray-500 mt-1">配置限时答题对战的时长、题量、题库范围等参数</p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors"
        >
          <i className="fa-solid fa-plus mr-2"></i>新建配置
        </button>
      </div>

      {configs.length === 0 ? (
        <div className="text-center py-12 text-gray-500 bg-white rounded-lg border border-gray-200">
          <i className="fa-solid fa-trophy text-6xl mb-4"></i>
          <p>暂无对战配置</p>
          <p className="text-sm mt-2">点击上方按钮创建第一份对战配置</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {configs.map((cfg) => {
            const tags = parseJsonArray(cfg.tag_filters);
            const clusters = parseJsonArray(cfg.cluster_filters);
            const active = toBool(cfg.is_active);
            return (
              <div
                key={cfg.id}
                className={`bg-white rounded-lg shadow-sm border p-4 ${active ? 'border-gray-200' : 'border-gray-300 bg-gray-50'}`}
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-2">
                    <i className="fa-solid fa-trophy text-purple-500"></i>
                    <h4 className="font-bold text-gray-800">{cfg.name}</h4>
                    {!active && (
                      <span className="px-2 py-0.5 bg-gray-200 text-gray-500 text-xs rounded">已禁用</span>
                    )}
                    <span className="px-2 py-0.5 bg-purple-100 text-purple-600 text-xs rounded">
                      {cfg.mode === 'timed' ? '限时答题' : '抢答模式'}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleToggleActive(cfg)}
                      className={`text-sm ${active ? 'text-yellow-600 hover:text-yellow-800' : 'text-green-600 hover:text-green-800'}`}
                      title={active ? '禁用配置' : '启用配置'}
                    >
                      <i className={`fa-solid ${active ? 'fa-ban' : 'fa-check'}`}></i>
                    </button>
                    <button onClick={() => openEdit(cfg)} className="text-blue-600 hover:text-blue-800 text-sm" title="编辑配置">
                      <i className="fa-solid fa-edit"></i>
                    </button>
                    <button onClick={() => handleDelete(cfg.id)} className="text-red-600 hover:text-red-800 text-sm" title="删除配置">
                      <i className="fa-solid fa-trash"></i>
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                  <span>
                    <i className="fa-solid fa-clock mr-1"></i>
                    {cfg.duration_seconds} 秒
                  </span>
                  <span>
                    <i className="fa-solid fa-list mr-1"></i>
                    {cfg.question_count} 道题
                  </span>
                  {cfg.difficulty_min != null && (
                    <span>
                      <i className="fa-solid fa-signal mr-1"></i>
                      难度 ≥ {cfg.difficulty_min}
                    </span>
                  )}
                  {cfg.difficulty_max != null && <span>难度 ≤ {cfg.difficulty_max}</span>}
                  {cfg.daily_limit != null && (
                    <span>
                      <i className="fa-solid fa-calendar-day mr-1"></i>
                      每生每日上限 {cfg.daily_limit}
                    </span>
                  )}
                  {cfg.qualification_correct_count != null && cfg.qualification_correct_count > 0 && (
                    <span>
                      <i className="fa-solid fa-shield-halved mr-1"></i>
                      需做对 {cfg.qualification_correct_count} 题
                    </span>
                  )}
                  {tags.length > 0 && (
                    <span>
                      <i className="fa-solid fa-tags mr-1"></i>
                      标签 {tags.length} 个
                    </span>
                  )}
                  {clusters.length > 0 && (
                    <span>
                      <i className="fa-solid fa-layer-group mr-1"></i>
                      聚类 {clusters.length} 个
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => {
              setShowModal(false);
              resetForm();
            }}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-center p-6 border-b border-gray-200">
                <h3 className="text-lg font-bold text-gray-800">
                  <i className="fa-solid fa-trophy text-purple-500 mr-2"></i>
                  {editingId ? '编辑对战配置' : '新建对战配置'}
                </h3>
                <button
                  onClick={() => {
                    setShowModal(false);
                    resetForm();
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <i className="fa-solid fa-times text-xl"></i>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {/* 活动名称 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">活动名称</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="如：期中复习PK"
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                  />
                </div>

                {/* 模式 + 时长 */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">对战模式</label>
                    <select
                      value={formData.mode}
                      onChange={(e) => setFormData({ ...formData, mode: e.target.value as 'timed' | 'rush' })}
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                    >
                      <option value="timed">限时答题（同步做题）</option>
                      <option value="rush">抢答模式（敬请期待）</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">总时长（秒）</label>
                    <input
                      type="number"
                      value={formData.duration_seconds}
                      min={30}
                      step={30}
                      onChange={(e) => setFormData({ ...formData, duration_seconds: Number(e.target.value) })}
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                    />
                  </div>
                </div>

                {/* 题量 + 每日上限 */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">题量</label>
                    <input
                      type="number"
                      value={formData.question_count}
                      min={5}
                      step={5}
                      onChange={(e) => setFormData({ ...formData, question_count: Number(e.target.value) })}
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">每生每日上限（空=不限）</label>
                    <input
                      type="number"
                      value={formData.daily_limit}
                      min={1}
                      onChange={(e) => setFormData({ ...formData, daily_limit: e.target.value })}
                      placeholder="如：20"
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                    />
                  </div>
                </div>

                {/* 资格验证 */}
                <div className="p-4 bg-blue-50 rounded-xl">
                  <label className="block text-sm font-medium text-blue-800 mb-1">对战资格验证（可选）</label>
                  <p className="text-xs text-gray-500 mb-2">设置学生参加此对战所需的最低做对题目数量</p>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600 whitespace-nowrap">需要做对</span>
                    <input
                      type="number"
                      value={formData.qualification_correct_count}
                      onChange={(e) =>
                        setFormData({ ...formData, qualification_correct_count: e.target.value })
                      }
                      className="w-24 p-2 border border-gray-300 rounded-lg text-center"
                      min={0}
                    />
                    <span className="text-sm text-gray-600 whitespace-nowrap">道题才能参加</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">留空或填0表示不限制</p>
                </div>

                {/* 难度范围 */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">难度下限（空=不限）</label>
                    <input
                      type="number"
                      value={formData.difficulty_min}
                      min={1}
                      max={5}
                      onChange={(e) => setFormData({ ...formData, difficulty_min: e.target.value })}
                      placeholder="1-5"
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">难度上限（空=不限）</label>
                    <input
                      type="number"
                      value={formData.difficulty_max}
                      min={1}
                      max={5}
                      onChange={(e) => setFormData({ ...formData, difficulty_max: e.target.value })}
                      placeholder="1-5"
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                    />
                  </div>
                </div>

                {/* 启用开关 */}
                <div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.is_active}
                      onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                      className="w-5 h-5 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                    />
                    <span className="text-sm text-gray-700">启用此配置</span>
                  </label>
                </div>

                {/* 标签筛选 */}
                {allTags.length > 0 && (
                  <div>
                    <p className="text-sm text-gray-600 mb-2">标签筛选（任一命中即可，OR）：</p>
                    <div className="flex flex-wrap gap-2">
                      {allTags.map((tag) => (
                        <button
                          key={tag}
                          onClick={() => toggleTag(tag)}
                          className={`px-3 py-1 text-sm rounded-full transition-colors ${
                            filterTags.includes(tag)
                              ? 'bg-blue-500 text-white'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          {tag}
                        </button>
                      ))}
                      {filterTags.length > 0 && (
                        <button
                          onClick={() => setFilterTags([])}
                          className="px-3 py-1 text-sm text-gray-500 hover:text-gray-700"
                        >
                          清除筛选
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* AI 聚类筛选 */}
                {Object.keys(clusterTree).length > 0 && (
                  <div>
                    <p className="text-sm text-gray-600 mb-2">
                      AI 聚类筛选：
                      {(filterClusterPrimary.length > 0 || filterClusterSecondary.length > 0) && (
                        <span className="ml-2 text-violet-600">
                          已选 一级 {filterClusterPrimary.length} / 二级 {filterClusterSecondary.length}
                        </span>
                      )}
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {/* 一级类目 */}
                      <div className="border border-gray-200 rounded-lg p-3">
                        <div className="text-xs text-gray-500 mb-2 font-semibold">一级类目</div>
                        <div className="flex flex-wrap gap-2">
                          {Object.keys(clusterTree).map((primary) => {
                            const act = filterClusterPrimary.includes(primary);
                            const cnt = (clusterTree[primary] || new Set()).size;
                            return (
                              <button
                                key={primary}
                                onClick={() => toggleClusterPrimary(primary)}
                                className={`px-3 py-1.5 rounded-full text-sm transition-all ${
                                  act
                                    ? 'bg-violet-500 text-white'
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                }`}
                                title={cnt > 0 ? `${cnt} 个二级类目` : '仅一级'}
                              >
                                {primary}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      {/* 二级类目 */}
                      <div className="border border-gray-200 rounded-lg p-3">
                        <div className="text-xs text-gray-500 mb-2 font-semibold">
                          二级类目
                          <span className="ml-1 text-gray-400">
                            {filterClusterPrimary.length === 0
                              ? '（请先选择一级类目）'
                              : '（仅显示已选一级下的二级）'}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2 min-h-[40px] max-h-[160px] overflow-y-auto pr-1">
                          {filterClusterPrimary.length === 0 ? (
                            <span className="text-xs text-gray-400 self-center">未选一级类目</span>
                          ) : (() => {
                              const list: { fullKey: string; label: string }[] = [];
                              filterClusterPrimary.forEach((p) => {
                                Array.from(clusterTree[p] || []).forEach((s) => {
                                  list.push({ fullKey: `${p}/${s}`, label: s });
                                });
                              });
                              if (list.length === 0) {
                                return <span className="text-xs text-gray-400 self-center">所选一级下无二级类目</span>;
                              }
                              const seen = new Set<string>();
                              const uniqueList = list.filter((it) => {
                                if (seen.has(it.fullKey)) return false;
                                seen.add(it.fullKey);
                                return true;
                              });
                              return uniqueList.map((it) => {
                                const act = filterClusterSecondary.includes(it.fullKey);
                                return (
                                  <button
                                    key={it.fullKey}
                                    onClick={() => toggleClusterSecondary(it.fullKey)}
                                    className={`px-3 py-1.5 rounded-full text-sm transition-all ${
                                      act
                                        ? 'bg-indigo-500 text-white'
                                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                    }`}
                                  >
                                    {it.label}
                                  </button>
                                );
                              });
                            })()}
                        </div>
                      </div>
                    </div>
                    {(filterClusterPrimary.length > 0 || filterClusterSecondary.length > 0) && (
                      <button
                        onClick={() => {
                          setFilterClusterPrimary([]);
                          setFilterClusterSecondary([]);
                        }}
                        className="mt-2 text-sm text-gray-500 hover:text-gray-700"
                      >
                        清除聚类筛选
                      </button>
                    )}
                  </div>
                )}

                <div className="text-xs text-gray-400 bg-gray-50 rounded p-3">
                  <i className="fa-solid fa-info-circle mr-1"></i>
                  说明：只选一级类目时，会自动包含该一级下所有二级题目；难度、标签、聚类均为"或"关系筛选。
                </div>
              </div>

              {/* 操作栏 */}
              <div className="flex gap-3 p-6 border-t border-gray-200">
                <button
                  onClick={() => {
                    setShowModal(false);
                    resetForm();
                  }}
                  className="flex-1 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 disabled:opacity-50 transition-colors"
                >
                  {saving ? '保存中...' : editingId ? '保存修改' : '创建配置'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
