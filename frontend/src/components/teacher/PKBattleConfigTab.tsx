import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { backendClient } from '../../api/backendClient';
import { CHAPTER_NAMES } from '../../data/chapterTaxonomy';

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

// 数值兜底：空串/非法值返回 fallback（表单里 number 输入框未填时是 ''）
const numOr = (v: any, fallback: number): number => {
  if (v === '' || v === null || v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

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
  qualification_mastered_count: number | null;
  qualification_mastered_clusters: string[] | string | null;
  // ===== 奖励配置（迁移 086）=====
  points_multiplier: number | string | null;
  win_bonus_rate: number | string | null;
  draw_bonus_rate: number | string | null;
  consolation_points: number | null;
  consolation_gap: number | null;
  first_battle_points: number | null;
  daily_battles_target: number | null;
  daily_battles_points: number | null;
  // ===== 装备掉落配置（迁移 087）=====
  equipment_drop_enabled: number | boolean | null;
  equipment_drop_multiplier: number | string | null;
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
    qualification_mastered_count: '' as string | number,
    qualification_mastered_clusters: [] as string[],
    // ===== 奖励配置 =====
    points_multiplier: 1 as string | number,
    win_bonus_rate: 0.5 as string | number,
    draw_bonus_rate: 0 as string | number,
    consolation_points: '' as string | number,
    consolation_gap: 2 as string | number,
    first_battle_points: '' as string | number,
    daily_battles_target: '' as string | number,
    daily_battles_points: '' as string | number,
    // ===== 装备掉落配置（迁移 087）=====
    equipment_drop_enabled: false,
    equipment_drop_multiplier: 1 as string | number,
  });
  // 表单内筛选 state（独立于 ExamManager 的题目选择器筛选）
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [filterClusterPrimary, setFilterClusterPrimary] = useState<string[]>([]);
  const [filterClusterSecondary, setFilterClusterSecondary] = useState<string[]>([]);

  /** 各一级类目「可练习题量」：供「已掌握题数」资格设置时参考上限（口径 = 练习可用题） */
  const [practicableCounts, setPracticableCounts] = useState<{ total: number; by_primary: Record<string, number> }>({ total: 0, by_primary: {} });

  useEffect(() => {
    fetchConfigs();
    fetchPracticableCounts();
  }, []);

  const fetchPracticableCounts = async () => {
    try {
      const { data } = await backendClient.get('/api/teacher/qualification/counts');
      if (data) setPracticableCounts(data as any);
    } catch (e) {
      console.error('拉取类目题量失败:', e);
    }
  };

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
      qualification_mastered_count: '',
      qualification_mastered_clusters: [],
      points_multiplier: 1,
      win_bonus_rate: 0.5,
      draw_bonus_rate: 0,
      consolation_points: '',
      consolation_gap: 2,
      first_battle_points: '',
      daily_battles_target: '',
      daily_battles_points: '',
      equipment_drop_enabled: false,
      equipment_drop_multiplier: 1,
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
      qualification_mastered_count: cfg.qualification_mastered_count ?? '',
      qualification_mastered_clusters: parseJsonArray(cfg.qualification_mastered_clusters),
      points_multiplier: cfg.points_multiplier != null ? Number(cfg.points_multiplier) : 1,
      win_bonus_rate: cfg.win_bonus_rate != null ? Number(cfg.win_bonus_rate) : 0.5,
      draw_bonus_rate: cfg.draw_bonus_rate != null ? Number(cfg.draw_bonus_rate) : 0,
      consolation_points: cfg.consolation_points ?? '',
      consolation_gap: cfg.consolation_gap ?? 2,
      first_battle_points: cfg.first_battle_points ?? '',
      daily_battles_target: cfg.daily_battles_target ?? '',
      daily_battles_points: cfg.daily_battles_points ?? '',
      equipment_drop_enabled: toBool(cfg.equipment_drop_enabled),
      equipment_drop_multiplier: cfg.equipment_drop_multiplier != null
        ? Number(cfg.equipment_drop_multiplier) : 1,
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
      qualification_mastered_count:
        formData.qualification_mastered_count === ''
          ? null
          : Number(formData.qualification_mastered_count),
      // 空数组 = 全部范围（后端按 null 处理，避免存成 "[]" 被误判为"选了空范围"）
      qualification_mastered_clusters:
        formData.qualification_mastered_clusters.length > 0
          ? formData.qualification_mastered_clusters
          : null,
      // ===== 奖励配置 =====
      points_multiplier: numOr(formData.points_multiplier, 1),
      win_bonus_rate: numOr(formData.win_bonus_rate, 0.5),
      draw_bonus_rate: numOr(formData.draw_bonus_rate, 0),
      consolation_points: formData.consolation_points === '' ? 0 : Number(formData.consolation_points),
      consolation_gap: numOr(formData.consolation_gap, 2),
      first_battle_points: formData.first_battle_points === '' ? 0 : Number(formData.first_battle_points),
      daily_battles_target: formData.daily_battles_target === '' ? 0 : Number(formData.daily_battles_target),
      daily_battles_points: formData.daily_battles_points === '' ? 0 : Number(formData.daily_battles_points),
      // ===== 装备掉落配置 =====
      equipment_drop_enabled: formData.equipment_drop_enabled,
      equipment_drop_multiplier: numOr(formData.equipment_drop_multiplier, 1),
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

  // 当前「已掌握题数」统计范围内可练习题量（用于提示上限；不选 = 全部范围）
  const selPracticable = formData.qualification_mastered_clusters.length === 0
    ? practicableCounts.total
    : formData.qualification_mastered_clusters.reduce(
        (s, n) => s + (practicableCounts.by_primary[n] || 0), 0
      );

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
                  {cfg.qualification_mastered_count != null && cfg.qualification_mastered_count > 0 && (
                    <span>
                      <i className="fa-solid fa-graduation-cap mr-1"></i>
                      需掌握 {cfg.qualification_mastered_count} 题
                      {(() => {
                        const sc = parseJsonArray(cfg.qualification_mastered_clusters);
                        return sc.length > 0 ? `（${sc.join('/')}）` : '（全部范围）';
                      })()}
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
                  {/* 奖励摘要：只显示「偏离默认」的项，避免卡片噪音 */}
                  {Number(cfg.points_multiplier) > 1 && (
                    <span className="text-amber-600 font-medium">
                      <i className="fa-solid fa-fire mr-1"></i>
                      积分 {Number(cfg.points_multiplier)} 倍
                    </span>
                  )}
                  {cfg.consolation_points != null && cfg.consolation_points > 0 && (
                    <span className="text-amber-600">
                      <i className="fa-solid fa-hand-holding-heart mr-1"></i>
                      惜败 +{cfg.consolation_points}
                    </span>
                  )}
                  {cfg.first_battle_points != null && cfg.first_battle_points > 0 && (
                    <span className="text-amber-600">
                      <i className="fa-solid fa-gift mr-1"></i>
                      首战 +{cfg.first_battle_points}
                    </span>
                  )}
                  {cfg.daily_battles_target != null && cfg.daily_battles_target > 0
                    && cfg.daily_battles_points != null && cfg.daily_battles_points > 0 && (
                    <span className="text-amber-600">
                      <i className="fa-solid fa-calendar-check mr-1"></i>
                      满 {cfg.daily_battles_target} 场 +{cfg.daily_battles_points}
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

                {/* 资格验证（两项条件需同时满足） */}
                <div className="p-4 bg-blue-50 rounded-xl space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-blue-800 mb-1">对战资格验证（可选）</label>
                    <p className="text-xs text-gray-500">下面的资格条件需<b>同时满足</b>才能参加对战；留空或填 0 表示该条件不启用</p>
                  </div>

                  {/* 条件一：做对题数 */}
                  <div className="bg-white/70 rounded-lg p-3">
                    <p className="text-xs font-medium text-blue-700 mb-2">条件一 · 累计做对题数</p>
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
                      <span className="text-sm text-gray-600 whitespace-nowrap">道题</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">统计学生全部练习/测试的累计做对题数</p>
                  </div>

                  {/* 条件二：已掌握题数（可按一级类目收窄范围） */}
                  <div className="bg-white/70 rounded-lg p-3">
                    <p className="text-xs font-medium text-blue-700 mb-2">条件二 · 已掌握题数</p>
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="text-sm text-gray-600 whitespace-nowrap">已掌握达到</span>
                      <input
                        type="number"
                        value={formData.qualification_mastered_count}
                        onChange={(e) =>
                          setFormData({ ...formData, qualification_mastered_count: e.target.value })
                        }
                        className="w-24 p-2 border border-gray-300 rounded-lg text-center"
                        min={0}
                      />
                      <span className="text-sm text-gray-600 whitespace-nowrap">道题</span>
                      <span className="text-xs text-gray-500 whitespace-nowrap">
                        （当前范围共 <b className="text-blue-600">{selPracticable}</b> 道可练习题）
                      </span>
                    </div>
                    {Number(formData.qualification_mastered_count) > selPracticable && (
                      <p className="text-xs text-red-500 mb-1">
                        <i className="fa-solid fa-triangle-exclamation mr-1"></i>
                        已超过该范围可练习题量（{selPracticable}），学生将无法达到
                      </p>
                    )}
                    <div>
                      <p className="text-xs text-gray-600 mb-1">
                        统计范围（不选 = 全部范围，共 {practicableCounts.total} 道可练习题）
                      </p>
                      <div className="max-h-[132px] overflow-y-auto border border-gray-200 rounded-lg bg-white p-2 flex flex-wrap gap-2">
                        {CHAPTER_NAMES.map((name) => {
                          const on = formData.qualification_mastered_clusters.includes(name);
                          const cnt = practicableCounts.by_primary[name] || 0;
                          return (
                            <button
                              key={name}
                              type="button"
                              onClick={() => setFormData((prev) => ({
                                ...prev,
                                qualification_mastered_clusters: on
                                  ? prev.qualification_mastered_clusters.filter((n) => n !== name)
                                  : [...prev.qualification_mastered_clusters, name],
                              }))}
                              title={`${name}：${cnt} 道可练习题`}
                              className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                                on
                                  ? 'bg-blue-500 text-white border-blue-500'
                                  : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
                              }`}
                            >
                              {name}
                              <span className={`ml-1 ${on ? 'text-white/80' : 'text-gray-400'}`}>{cnt}</span>
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <p className="text-xs text-gray-400">
                          选中一级类目后，统计该章<b>全部小节</b>内达掌握标准的题数
                        </p>
                        {formData.qualification_mastered_clusters.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setFormData({ ...formData, qualification_mastered_clusters: [] })}
                            className="text-xs text-blue-600 hover:underline shrink-0 ml-2"
                          >
                            清空（改回全部范围）
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
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

                {/* 奖励设置 */}
                <div className="p-4 bg-amber-50 rounded-xl space-y-4 border border-amber-200">
                  <div>
                    <label className="block text-sm font-medium text-amber-800 mb-1">
                      <i className="fa-solid fa-gift mr-1"></i>奖励设置
                    </label>
                    <p className="text-xs text-gray-600">
                      单场积分 = <b>做对题数 × 每题基础分</b> × 积分倍率 × 胜负加成。
                      积分实时累计到学生账户，可在「数据统计」里看发放总额。
                    </p>
                  </div>

                  {/* 积分倍率 + 胜负加成 */}
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-sm text-gray-700 mb-1">积分倍率</label>
                      <input
                        type="number"
                        step="0.1"
                        min={0.1}
                        max={10}
                        value={formData.points_multiplier}
                        onChange={(e) => setFormData({ ...formData, points_multiplier: e.target.value })}
                        className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 outline-none"
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        {numOr(formData.points_multiplier, 1) === 1
                          ? '1 = 不加倍'
                          : `${numOr(formData.points_multiplier, 1)} 倍（主题活动用）`}
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm text-gray-700 mb-1">赢方加成</label>
                      <input
                        type="number"
                        step="0.1"
                        min={0}
                        max={5}
                        value={formData.win_bonus_rate}
                        onChange={(e) => setFormData({ ...formData, win_bonus_rate: e.target.value })}
                        className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 outline-none"
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        ×{(1 + numOr(formData.win_bonus_rate, 0.5)).toFixed(1)}
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm text-gray-700 mb-1">平局加成</label>
                      <input
                        type="number"
                        step="0.1"
                        min={0}
                        max={5}
                        value={formData.draw_bonus_rate}
                        onChange={(e) => setFormData({ ...formData, draw_bonus_rate: e.target.value })}
                        className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 outline-none"
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        ×{(1 + numOr(formData.draw_bonus_rate, 0)).toFixed(1)}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500">
                    输方始终按 ×1 计（做对题就有积分），保证连输的学生也愿意继续参与。
                  </p>

                  {/* 惜败鼓励 */}
                  <div className="pt-3 border-t border-amber-200">
                    <p className="text-sm text-gray-700 mb-2">
                      <b>惜败鼓励</b>
                      <span className="text-xs text-gray-500 ml-2">分差很小时给输方额外积分，缓解挫败感</span>
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">分差不超过（净得分）</label>
                        <input
                          type="number"
                          min={0}
                          value={formData.consolation_gap}
                          onChange={(e) => setFormData({ ...formData, consolation_gap: e.target.value })}
                          className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">额外奖励积分（0=不启用）</label>
                        <input
                          type="number"
                          min={0}
                          value={formData.consolation_points}
                          onChange={(e) => setFormData({ ...formData, consolation_points: e.target.value })}
                          placeholder="0"
                          className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  {/* 参与类奖励 */}
                  <div className="pt-3 border-t border-amber-200">
                    <p className="text-sm text-gray-700 mb-2">
                      <b>参与奖励</b>
                      <span className="text-xs text-gray-500 ml-2">每日限一次，奖励「参与」而非「胜负」</span>
                    </p>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">每日首战奖励</label>
                        <input
                          type="number"
                          min={0}
                          value={formData.first_battle_points}
                          onChange={(e) => setFormData({ ...formData, first_battle_points: e.target.value })}
                          placeholder="0"
                          className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">单日完成场次</label>
                        <input
                          type="number"
                          min={0}
                          value={formData.daily_battles_target}
                          onChange={(e) => setFormData({ ...formData, daily_battles_target: e.target.value })}
                          placeholder="0"
                          className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">达标奖励积分</label>
                        <input
                          type="number"
                          min={0}
                          value={formData.daily_battles_points}
                          onChange={(e) => setFormData({ ...formData, daily_battles_points: e.target.value })}
                          placeholder="0"
                          className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  {/* 奖励预览 */}
                  <div className="p-3 bg-white rounded-lg border border-amber-200">
                    <p className="text-xs text-gray-500 mb-1">奖励预览（以做对 10 题为例，每题基础分按系统默认计）</p>
                    <p className="text-xs text-gray-700">
                      赢方：10 题 × 倍率 {numOr(formData.points_multiplier, 1)} ×
                      {(1 + numOr(formData.win_bonus_rate, 0.5)).toFixed(1)}
                      {numOr(formData.consolation_points, 0) > 0 && (
                        <span>
                          ；输方分差 ≤ {numOr(formData.consolation_gap, 2)} 时额外 +
                          {numOr(formData.consolation_points, 0)}
                        </span>
                      )}
                      {numOr(formData.first_battle_points, 0) > 0 && (
                        <span>；每日首战 +{numOr(formData.first_battle_points, 0)}</span>
                      )}
                      {numOr(formData.daily_battles_target, 0) > 0 && numOr(formData.daily_battles_points, 0) > 0 && (
                        <span>
                          ；单日满 {numOr(formData.daily_battles_target, 0)} 场 +
                          {numOr(formData.daily_battles_points, 0)}
                        </span>
                      )}
                    </p>
                  </div>
                </div>

                {/* ===== 装备掉落（迁移 087）===== */}
                <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.equipment_drop_enabled}
                      onChange={(e) => setFormData({ ...formData, equipment_drop_enabled: e.target.checked })}
                      className="w-5 h-5 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                    />
                    <span className="text-sm text-gray-700">
                      <b>启用 PK 装备掉落</b>
                      <span className="text-xs text-gray-500 ml-2">
                        默认关闭；开启后答对的题会按掉率掉落装备
                      </span>
                    </span>
                  </label>
                  {formData.equipment_drop_enabled && (
                    <>
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">
                          掉率系数（实际掉率 = 装备自身掉率 × 系数）
                        </label>
                        <input
                          type="number"
                          step="0.1"
                          min={0}
                          max={5}
                          value={formData.equipment_drop_multiplier}
                          onChange={(e) => setFormData({ ...formData, equipment_drop_multiplier: e.target.value })}
                          className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 outline-none"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          1.0 = 与练习完全一致；上限 5（避免「刷 PK 拿装备」压过练习）。
                          只在做对 ≥1 题时触发，防止挂机也掉装备。
                        </p>
                      </div>
                    </>
                  )}
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
