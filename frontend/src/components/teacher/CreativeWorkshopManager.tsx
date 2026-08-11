import React, { useState, useEffect, useCallback } from 'react';
import { LicenseGuard } from '../common/LicenseGuard';
import { backendClient } from '../../api/backendClient';

type Tab = 'review' | 'manage' | 'settings' | 'revenue';

interface WorkshopConfig {
  id: number;
  enabled: boolean;
  author_share_percent: number;
  min_price: number;
  max_price: number;
  daily_gen_limit: number;
  gen_cost: number;
  modify_cost: number;
  open_cost: number;
  min_requirement_chars: number;
  enabled_classes: string[] | null;
  classes?: { id: string; name: string }[];
}

interface Work {
  id: string;
  title: string;
  description: string;
  icon: string;
  price: number;
  status: 'draft' | 'pending' | 'approved' | 'rejected' | 'removed';
  reject_reason: string | null;
  view_count: number;
  purchase_count: number;
  is_featured: boolean;
  created_at: string;
  student_id: string;
  author_name?: string;
  class_name?: string;
  code?: string;
  requirement?: string;
  category?: string;
  avg_rating?: number;
  rating_count?: number;
}

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'bg-gray-100 text-gray-600' },
  pending: { label: '待审核', cls: 'bg-amber-100 text-amber-600' },
  approved: { label: '已上架', cls: 'bg-green-100 text-green-600' },
  rejected: { label: '被驳回', cls: 'bg-red-100 text-red-600' },
  removed: { label: '已下架', cls: 'bg-gray-200 text-gray-500' },
};

// 工坊固定类别
const WORK_CATEGORIES = [
  { id: '创意工具', icon: '🛠️', desc: '辅助创作或表达的工具' },
  { id: '学习助手', icon: '📖', desc: '帮助记忆或理解知识' },
  { id: '生活妙用', icon: '💡', desc: '解决日常生活小问题' },
  { id: '艺术表达', icon: '🎨', desc: '偏重美感与情感表达' },
  { id: '小游戏', icon: '🎮', desc: '轻量级娱乐体验' },
];

export const CreativeWorkshopManager: React.FC = () => {
  const [tab, setTab] = useState<Tab>('review');
  const [works, setWorks] = useState<Work[]>([]);
  const [statusFilter, setStatusFilter] = useState('pending');
  // 作品列表筛选排序
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [featuredOnly, setFeaturedOnly] = useState(false);
  const [sortBy, setSortBy] = useState('newest');
  const [config, setConfig] = useState<WorkshopConfig | null>(null);
  const [revenue, setRevenue] = useState<any>(null);
  const [previewWork, setPreviewWork] = useState<Work | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // 预览弹窗：窗口尺寸与最大化
  const [previewSize, setPreviewSize] = useState<{ w: number; h: number } | null>(null);
  const [isPreviewMax, setIsPreviewMax] = useState(false);

  // 打开预览时初始化窗口尺寸；关闭后重置
  useEffect(() => {
    if (previewWork && !previewSize) {
      setPreviewSize({
        w: Math.round(Math.min(window.innerWidth - 64, 960)),
        h: Math.round(window.innerHeight * 0.82),
      });
    }
    if (!previewWork) {
      setIsPreviewMax(false);
      setPreviewSize(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewWork]);

  // 右下角拖拽调整窗口大小
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = previewSize?.w ?? 800;
    const startH = previewSize?.h ?? 600;
    const onMove = (ev: MouseEvent) => {
      setPreviewSize({
        w: Math.max(420, startW + ev.clientX - startX),
        h: Math.max(320, startH + ev.clientY - startY),
      });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const refresh = useCallback(() => {
    fetchWorks(statusFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, categoryFilter, featuredOnly, sortBy]);

  useEffect(() => {
    fetchConfig();
    fetchWorks('pending');
  }, []);

  // 筛选/排序变化时重拉列表
  useEffect(() => {
    if (tab === 'review' || tab === 'manage') fetchWorks(statusFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryFilter, featuredOnly, sortBy]);

  useEffect(() => {
    if (tab === 'revenue') fetchRevenue();
  }, [tab]);

  const fetchConfig = async () => {
    try {
      const { data } = await backendClient.get('/api/creative-workshop/teacher/config');
      if (data) setConfig(data);
    } catch (err: any) {
      setError(err.message || '获取配置失败');
    }
  };

  const fetchWorks = async (status: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status });
      if (categoryFilter && categoryFilter !== 'all') params.set('category', categoryFilter);
      if (featuredOnly) params.set('featured', '1');
      if (sortBy && sortBy !== 'newest') params.set('sort', sortBy);
      const { data } = await backendClient.get(`/api/creative-workshop/teacher/works?${params.toString()}`);
      if (data) setWorks(data);
    } catch (err: any) {
      setError(err.message || '获取作品列表失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchRevenue = async () => {
    try {
      const { data } = await backendClient.get('/api/creative-workshop/teacher/revenue');
      if (data) setRevenue(data);
    } catch (err: any) {
      setError(err.message || '获取收益统计失败');
    }
  };

  const switchTab = (t: Tab) => {
    setTab(t);
    setError(null);
    setNotice(null);
    if (t === 'review') { setStatusFilter('pending'); fetchWorks('pending'); }
    if (t === 'manage') { setStatusFilter('approved'); fetchWorks('approved'); }
  };

  const openPreview = async (work: Work) => {
    try {
      const { data } = await backendClient.get(`/api/creative-workshop/teacher/works/${work.id}`);
      if (data) setPreviewWork(data);
    } catch (err: any) {
      setError(err.message || '加载预览失败');
    }
  };

  const handleReview = async (workId: string, action: 'approved' | 'rejected') => {
    setError(null);
    if (action === 'rejected' && !rejectReason.trim()) {
      setError('请填写驳回原因');
      return;
    }
    try {
      const { error: err } = await backendClient.post(`/api/creative-workshop/teacher/works/${workId}/review`, {
        action,
        reason: action === 'rejected' ? rejectReason.trim() : '',
      });
      if (err) throw new Error(err);
      setNotice(action === 'approved' ? '已通过审核，作品已上架应用中心' : '已驳回');
      setRejectReason('');
      setPreviewWork(null);
      refresh();
    } catch (err: any) {
      setError(err.message || '操作失败');
    }
  };

  const handleFeature = async (work: Work) => {
    try {
      const { error: err } = await backendClient.post(`/api/creative-workshop/teacher/works/${work.id}/feature`, {
        featured: !work.is_featured,
      });
      if (err) throw new Error(err);
      setNotice(work.is_featured ? '已取消推荐' : '已推荐，作品将在应用中心置顶曝光');
      refresh();
    } catch (err: any) {
      setError(err.message || '操作失败');
    }
  };

  const handleToggle = async (work: Work) => {
    try {
      const { data, error: err } = await backendClient.post(`/api/creative-workshop/teacher/works/${work.id}/toggle`, {});
      if (err) throw new Error(err);
      setNotice(data.status === 'removed' ? '已下架' : '已恢复上架');
      refresh();
    } catch (err: any) {
      setError(err.message || '操作失败');
    }
  };

  // 单个删除作品
  const handleDeleteWork = async (work: Work) => {
    if (!window.confirm(`确定删除作品「${work.title}」吗？删除后无法恢复。`)) return;
    try {
      const { error: err } = await backendClient.delete(`/api/creative-workshop/teacher/works/${work.id}`);
      if (err) throw new Error(err);
      setNotice('作品已删除');
      refresh();
    } catch (err: any) {
      setError(err.message || '删除失败');
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === works.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(works.map(w => w.id));
    }
  };

  const clearSelection = () => setSelectedIds([]);

  // 批量操作
  const handleBatch = async (action: string) => {
    if (selectedIds.length === 0) {
      setError('请先勾选要操作的作品');
      return;
    }
    if (action === 'delete' && !window.confirm(`确定删除选中的 ${selectedIds.length} 个作品吗？（有购买记录的作品会被跳过）`)) return;
    if (action === 'reject' && !rejectReason.trim()) {
      setError('请填写驳回原因');
      return;
    }
    try {
      const { data, error: err } = await backendClient.post('/api/creative-workshop/teacher/works/batch', {
        action,
        ids: selectedIds,
        reason: rejectReason.trim(),
      });
      if (err) throw new Error(err);
      const actionLabels: Record<string, string> = {
        approve: '批量审核通过',
        reject: '批量驳回',
        feature: '批量推荐',
        unfeature: '批量取消推荐',
        remove: '批量下架',
        restore: '批量恢复上架',
        delete: '批量删除',
      };
      const skipMsg = data?.skipped > 0 ? `（跳过 ${data.skipped} 个）` : '';
      setNotice(`${actionLabels[action] || '批量操作'}完成${skipMsg}`);
      setRejectReason('');
      setSelectedIds([]);
      refresh();
    } catch (err: any) {
      setError(err.message || '批量操作失败');
    }
  };

  const handleSaveConfig = async () => {
    if (!config) return;
    setError(null);
    if (config.min_price > config.max_price) {
      setError('最低定价不能高于最高定价');
      return;
    }
    try {
      const { error: err } = await backendClient.put('/api/creative-workshop/teacher/config', {
        enabled: config.enabled,
        author_share_percent: config.author_share_percent,
        min_price: config.min_price,
        max_price: config.max_price,
        daily_gen_limit: config.daily_gen_limit,
        gen_cost: config.gen_cost,
        modify_cost: config.modify_cost,
        open_cost: config.open_cost,
        min_requirement_chars: config.min_requirement_chars,
        enabled_classes: config.enabled_classes,
      });
      if (err) throw new Error(err);
      setNotice('工坊设置已保存');
    } catch (err: any) {
      setError(err.message || '保存失败');
    }
  };

  const tabs: { id: Tab; label: string; icon: string; badge?: number }[] = [
    { id: 'review', label: '作品审核', icon: 'fa-clipboard-check', badge: works.filter(w => w.status === 'pending').length },
    { id: 'manage', label: '作品管理', icon: 'fa-layer-group' },
    { id: 'settings', label: '工坊设置', icon: 'fa-gear' },
    { id: 'revenue', label: '收益统计', icon: 'fa-coins' },
  ];

  return (
    <LicenseGuard featureName="AI创意工坊" featureIcon="fa-wand-magic-sparkles">
      <div className="h-full flex flex-col bg-gray-50">
        {/* 顶部 */}
        <div className="px-4 pt-4 pb-3 bg-white border-b border-gray-200 shrink-0">
          <h3 className="text-lg font-medium text-gray-800 flex items-center gap-2">
            <i className="fa-solid fa-wand-magic-sparkles text-fuchsia-500"></i>
            AI创意工坊
          </h3>
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => switchTab(t.id)}
                className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 transition-colors ${
                  tab === t.id ? 'bg-fuchsia-100 text-fuchsia-600 font-medium' : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                <i className={`fa-solid ${t.icon}`}></i>
                {t.label}
                {!!t.badge && (
                  <span className="bg-amber-500 text-white text-[10px] px-1.5 rounded-full">{t.badge}</span>
                )}
              </button>
            ))}
            <span className={`ml-auto text-xs px-2 py-1 rounded-full ${config?.enabled ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-500'}`}>
              {config?.enabled ? '工坊已开启' : '工坊已关闭'}
            </span>
          </div>
        </div>

        {/* 提示 */}
        {(error || notice) && (
          <div className="px-4 pt-3 shrink-0">
            {error && (
              <div className="flex items-start gap-2 bg-red-50 text-red-600 px-3 py-2 rounded-lg text-sm">
                <i className="fa-solid fa-circle-exclamation mt-0.5"></i>
                <div className="flex-1">{error}</div>
                <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600"><i className="fa-solid fa-xmark"></i></button>
              </div>
            )}
            {notice && (
              <div className="flex items-start gap-2 bg-green-50 text-green-600 px-3 py-2 rounded-lg text-sm">
                <i className="fa-solid fa-circle-check mt-0.5"></i>
                <div className="flex-1">{notice}</div>
                <button onClick={() => setNotice(null)} className="text-green-400 hover:text-green-600"><i className="fa-solid fa-xmark"></i></button>
              </div>
            )}
          </div>
        )}

        {/* 内容 */}
        <div className="flex-1 overflow-auto p-4">
          {/* 审核/管理：作品列表 */}
          {(tab === 'review' || tab === 'manage') && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <button
                  onClick={() => { setStatusFilter('pending'); fetchWorks('pending'); }}
                  className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${statusFilter === 'pending' ? 'bg-amber-500 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}
                >
                  待审核
                </button>
                <button
                  onClick={() => { setStatusFilter('approved'); fetchWorks('approved'); }}
                  className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${statusFilter === 'approved' ? 'bg-green-500 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}
                >
                  已上架
                </button>
                <button
                  onClick={() => { setStatusFilter('rejected'); fetchWorks('rejected'); }}
                  className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${statusFilter === 'rejected' ? 'bg-red-500 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}
                >
                  被驳回
                </button>
                <button
                  onClick={() => { setStatusFilter('removed'); fetchWorks('removed'); }}
                  className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${statusFilter === 'removed' ? 'bg-gray-500 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}
                >
                  已下架
                </button>
                <button
                  onClick={() => { setStatusFilter('all'); fetchWorks('all'); }}
                  className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${statusFilter === 'all' ? 'bg-fuchsia-500 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}
                >
                  全部
                </button>
              </div>

              {/* 类别筛选 + 排序栏 */}
              <div className="mb-4 bg-white rounded-xl p-3 shadow-sm border border-gray-200 flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setCategoryFilter('all')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs transition-colors ${categoryFilter === 'all' ? 'bg-fuchsia-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  全部分类
                </button>
                {WORK_CATEGORIES.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setCategoryFilter(c.id)}
                    title={c.desc}
                    className={`px-2.5 py-1.5 rounded-lg text-xs transition-colors ${categoryFilter === c.id ? 'bg-fuchsia-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                  >
                    {c.icon} {c.id}
                  </button>
                ))}
                <div className="w-px h-5 bg-gray-200 mx-1"></div>
                <button
                  onClick={() => setFeaturedOnly(v => !v)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs transition-colors ${featuredOnly ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  <i className="fa-solid fa-star mr-1"></i>仅看推荐
                </button>
                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value)}
                  className="ml-auto px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
                >
                  <option value="newest">最新创建</option>
                  <option value="rating">评分最高</option>
                  <option value="views">访问最多</option>
                  <option value="sales">销量最高</option>
                  <option value="price">价格最高</option>
                </select>
              </div>

              {/* 批量操作栏 */}
              <div className="mb-4 bg-white rounded-xl p-3 shadow-sm border border-gray-200 flex items-center gap-2 flex-wrap">
                <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={works.length > 0 && selectedIds.length === works.length}
                    onChange={toggleSelectAll}
                    className="accent-fuchsia-500"
                  />
                  全选
                </label>
                <span className="text-xs text-gray-400">
                  已选 {selectedIds.length} 个
                </span>
                <div className="w-px h-5 bg-gray-200 mx-1"></div>
                <input
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  placeholder="驳回原因（批量驳回时必填）"
                  className="w-44 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-red-400"
                />
                <button
                  onClick={() => handleBatch('approve')}
                  className="px-2.5 py-1.5 bg-green-500 hover:bg-green-600 text-white rounded-lg text-xs transition-colors"
                >
                  <i className="fa-solid fa-check mr-1"></i>通过
                </button>
                <button
                  onClick={() => handleBatch('reject')}
                  className="px-2.5 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-xs transition-colors"
                >
                  <i className="fa-solid fa-xmark mr-1"></i>驳回
                </button>
                <button
                  onClick={() => handleBatch('feature')}
                  className="px-2.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs transition-colors"
                >
                  <i className="fa-solid fa-star mr-1"></i>推荐
                </button>
                <button
                  onClick={() => handleBatch('remove')}
                  className="px-2.5 py-1.5 bg-gray-600 hover:bg-gray-700 text-white rounded-lg text-xs transition-colors"
                >
                  <i className="fa-solid fa-power-off mr-1"></i>下架
                </button>
                <button
                  onClick={() => handleBatch('restore')}
                  className="px-2.5 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs transition-colors"
                >
                  <i className="fa-solid fa-rotate-left mr-1"></i>上架
                </button>
                <button
                  onClick={() => handleBatch('delete')}
                  className="px-2.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs transition-colors"
                >
                  <i className="fa-solid fa-trash mr-1"></i>删除
                </button>
                {selectedIds.length > 0 && (
                  <button onClick={clearSelection} className="text-xs text-gray-400 hover:text-gray-600 ml-auto">
                    取消选择
                  </button>
                )}
              </div>

              {loading && <div className="text-center text-gray-400 py-8">加载中...</div>}

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {!loading && works.length === 0 && (
                  <div className="col-span-full text-center text-gray-400 py-16">暂无作品</div>
                )}
                {works.map(work => (
                  <div key={work.id} className={`bg-white rounded-xl p-4 shadow-sm border flex flex-col gap-2 transition-shadow ${selectedIds.includes(work.id) ? 'border-fuchsia-400 ring-2 ring-fuchsia-300' : 'border-gray-200'}`}>
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(work.id)}
                        onChange={() => toggleSelect(work.id)}
                        className="mt-1 accent-fuchsia-500 shrink-0 cursor-pointer"
                        title="选择该作品"
                      />
                      <span className="text-3xl shrink-0">{work.icon || '🧩'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-800 truncate">{work.title}</div>
                        <div className="text-xs text-gray-400">
                          {work.author_name || '未知'} {work.class_name ? `· ${work.class_name}` : ''}
                        </div>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${STATUS_MAP[work.status]?.cls || ''}`}>
                        {STATUS_MAP[work.status]?.label || work.status}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 line-clamp-2 min-h-[2rem]">{work.description || '暂无简介'}</div>
                    {work.requirement && (
                      <div className="text-xs text-gray-400 bg-gray-50 rounded-lg p-2">
                        <span className="text-gray-500">需求：</span>{work.requirement}
                      </div>
                    )}
                    <div className="text-xs text-gray-400">
                        {work.category && (
                          <span className="inline-block mr-2 px-1.5 py-0.5 rounded bg-fuchsia-50 text-fuchsia-600">{work.category}</span>
                        )}
                        价格 {work.price} 积分 · 售出 {work.purchase_count} · 浏览 {work.view_count}
                        {(work.avg_rating ?? 0) > 0 && ` · 评分 ${work.avg_rating}（${work.rating_count}）`}
                      </div>
                    <div className="flex gap-2 mt-1">
                      <button
                        onClick={() => openPreview(work)}
                        className="flex-1 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs transition-colors"
                      >
                        <i className="fa-solid fa-eye mr-1"></i>预览试玩
                      </button>
                      {tab === 'review' && work.status === 'pending' && (
                        <>
                          <button
                            onClick={() => handleReview(work.id, 'approved')}
                            className="flex-1 px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white rounded-lg text-xs transition-colors"
                          >
                            <i className="fa-solid fa-check mr-1"></i>通过
                          </button>
                          <button
                            onClick={() => handleReview(work.id, 'rejected')}
                            className="flex-1 px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-xs transition-colors"
                          >
                            <i className="fa-solid fa-xmark mr-1"></i>驳回
                          </button>
                        </>
                      )}
                      {tab === 'manage' && (
                        <>
                          <button
                            onClick={() => handleFeature(work)}
                            className={`flex-1 px-3 py-1.5 rounded-lg text-xs transition-colors ${work.is_featured ? 'bg-amber-100 text-amber-600 hover:bg-amber-200' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                          >
                            <i className="fa-solid fa-star mr-1"></i>{work.is_featured ? '取消推荐' : '推荐'}
                          </button>
                          <button
                            onClick={() => handleToggle(work)}
                            className={`flex-1 px-3 py-1.5 rounded-lg text-xs transition-colors ${work.status === 'removed' ? 'bg-green-500 text-white hover:bg-green-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                          >
                            <i className="fa-solid fa-power-off mr-1"></i>{work.status === 'removed' ? '恢复' : '下架'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 工坊设置 */}
          {tab === 'settings' && config && (
            <div className="max-w-2xl space-y-4">
              <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-200">
                <h4 className="font-medium text-gray-800 mb-4 flex items-center gap-2">
                  <i className="fa-solid fa-power-off text-fuchsia-500"></i>工坊总开关
                </h4>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-gray-700">是否开放 AI 创意工坊</div>
                    <div className="text-xs text-gray-400">关闭后学生端将无法访问工坊（含已购买应用）</div>
                  </div>
                  <button
                    onClick={() => setConfig({ ...config, enabled: !config.enabled })}
                    className={`w-12 h-6 rounded-full relative transition-colors ${config.enabled ? 'bg-green-500' : 'bg-gray-300'}`}
                  >
                    <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${config.enabled ? 'left-6' : 'left-0.5'}`}></span>
                  </button>
                </div>
              </div>

              <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-200">
                <h4 className="font-medium text-gray-800 mb-4 flex items-center gap-2">
                  <i className="fa-solid fa-users text-fuchsia-500"></i>开放班级
                </h4>
                <p className="text-xs text-gray-400 mb-3">不选择则全部班级开放</p>
                <div className="flex flex-wrap gap-2">
                  {config.classes?.map(c => (
                    <button
                      key={c.id}
                      onClick={() => {
                        const list = config.enabled_classes || [];
                        setConfig({
                          ...config,
                          enabled_classes: list.includes(c.id) ? list.filter(x => x !== c.id) : [...list, c.id],
                        });
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
                        config.enabled_classes?.includes(c.id) ? 'bg-fuchsia-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-200">
                <h4 className="font-medium text-gray-800 mb-4 flex items-center gap-2">
                  <i className="fa-solid fa-hand-holding-dollar text-fuchsia-500"></i>提成与定价
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">作者提成比例（%）</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={config.author_share_percent}
                      onChange={e => setConfig({ ...config, author_share_percent: Number(e.target.value) })}
                      className="w-full p-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
                    />
                    <p className="text-xs text-gray-400 mt-1">如60%：作品定价10积分，作者得6积分，系统留存4积分</p>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">学生定价范围（积分）</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        value={config.min_price}
                        onChange={e => setConfig({ ...config, min_price: Number(e.target.value) })}
                        className="w-full p-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
                      />
                      <span className="text-gray-400">至</span>
                      <input
                        type="number"
                        min={0}
                        value={config.max_price}
                        onChange={e => setConfig({ ...config, max_price: Number(e.target.value) })}
                        className="w-full p-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">每次打开应用消耗积分</label>
                    <input
                      type="number"
                      min={0}
                      value={config.open_cost}
                      onChange={e => setConfig({ ...config, open_cost: Number(e.target.value) })}
                      className="w-full p-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      学生购买后每次打开仍扣积分，按提成比例奖励作者（0=免费打开，作者本人打开不扣费）
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-200">
                <h4 className="font-medium text-gray-800 mb-4 flex items-center gap-2">
                  <i className="fa-solid fa-robot text-fuchsia-500"></i>AI 生成设置
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">每日生成+修改次数上限</label>
                    <input
                      type="number"
                      min={1}
                      value={config.daily_gen_limit}
                      onChange={e => setConfig({ ...config, daily_gen_limit: Number(e.target.value) })}
                      className="w-full p-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">每次生成扣除积分</label>
                    <input
                      type="number"
                      min={0}
                      value={config.gen_cost}
                      onChange={e => setConfig({ ...config, gen_cost: Number(e.target.value) })}
                      className="w-full p-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">每次修改扣除积分</label>
                    <input
                      type="number"
                      min={0}
                      value={config.modify_cost}
                      onChange={e => setConfig({ ...config, modify_cost: Number(e.target.value) })}
                      className="w-full p-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">需求描述最少字数</label>
                    <input
                      type="number"
                      min={1}
                      value={config.min_requirement_chars}
                      onChange={e => setConfig({ ...config, min_requirement_chars: Number(e.target.value) })}
                      className="w-full p-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
                    />
                  </div>
                </div>
              </div>

              <button
                onClick={handleSaveConfig}
                className="px-6 py-2.5 bg-fuchsia-500 text-white rounded-lg text-sm font-medium hover:bg-fuchsia-600 transition-colors"
              >
                <i className="fa-solid fa-floppy-disk mr-1"></i>保存设置
              </button>
            </div>
          )}

          {/* 收益统计 */}
          {tab === 'revenue' && (
            <div className="space-y-4">
              <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
                <h4 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                  <i className="fa-solid fa-ranking-star text-fuchsia-500"></i>作者收益排行
                  <span className="text-xs text-gray-400 font-normal">提成比例 {revenue?.authorSharePercent ?? 60}%</span>
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                        <th className="py-2 pr-3">作者</th>
                        <th className="py-2 pr-3">班级</th>
                        <th className="py-2 pr-3">作品数</th>
                        <th className="py-2 pr-3">总售出</th>
                        <th className="py-2">累计收益</th>
                      </tr>
                    </thead>
                    <tbody>
                      {revenue?.authors?.map((a: any, i: number) => (
                        <tr key={a.student_id} className="border-b border-gray-50">
                          <td className="py-2 pr-3">
                            <span className="inline-flex items-center gap-1.5">
                              {i === 0 && <span className="text-amber-500">🥇</span>}
                              {i === 1 && <span className="text-gray-400">🥈</span>}
                              {i === 2 && <span className="text-amber-700">🥉</span>}
                              <span className="font-medium text-gray-700">{a.real_name || '未知'}</span>
                            </span>
                          </td>
                          <td className="py-2 pr-3 text-gray-500">{a.class_name || '-'}</td>
                          <td className="py-2 pr-3">{a.work_count}</td>
                          <td className="py-2 pr-3">{a.total_sales || 0}</td>
                          <td className="py-2 text-amber-600 font-medium">{Number(a.total_revenue) || 0} 积分</td>
                        </tr>
                      ))}
                      {(!revenue?.authors || revenue.authors.length === 0) && (
                        <tr><td colSpan={5} className="py-6 text-center text-gray-400">暂无数据</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
                <h4 className="text-sm font-medium text-gray-700 mb-3">购买流水</h4>
                <div className="space-y-2">
                  {revenue?.purchases?.map((p: any) => (
                    <div key={p.id} className="flex items-center gap-3 text-sm py-1.5 border-b border-gray-50">
                      <i className="fa-solid fa-cart-shopping text-gray-300"></i>
                      <span className="flex-1 truncate text-gray-700">{p.title}</span>
                      <span className="text-xs text-gray-400">
                        {p.author_name || '未知'} → {p.buyer_name || '未知'}
                      </span>
                      <span className="text-gray-400 text-xs">{p.created_at?.slice(0, 16)}</span>
                      <span className="text-amber-600 text-xs">{p.price} 积分</span>
                      <span className="text-green-600 text-xs font-medium">作者 +{p.author_share}</span>
                    </div>
                  ))}
                  {(!revenue?.purchases || revenue.purchases.length === 0) && (
                    <div className="text-center text-gray-400 py-6">暂无购买记录</div>
                  )}
                </div>
              </div>

              <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
                <h4 className="text-sm font-medium text-gray-700 mb-3">打开提成流水</h4>
                <div className="space-y-2">
                  {revenue?.opens?.map((o: any) => (
                    <div key={o.id} className="flex items-center gap-3 text-sm py-1.5 border-b border-gray-50">
                      <i className="fa-solid fa-door-open text-sky-400"></i>
                      <span className="flex-1 truncate text-gray-700">{o.title}</span>
                      <span className="text-xs text-gray-400">{o.author_name || '未知'}</span>
                      <span className="text-gray-400 text-xs">{o.created_at?.slice(0, 16)}</span>
                      <span className="text-green-600 text-xs font-medium">作者 +{o.amount}</span>
                    </div>
                  ))}
                  {(!revenue?.opens || revenue.opens.length === 0) && (
                    <div className="text-center text-gray-400 py-6">暂无打开提成记录</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 预览弹窗 */}
        {previewWork && (
          <div className={`fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 ${isPreviewMax ? 'p-0' : ''}`}>
            <div
              className="bg-white rounded-xl flex flex-col overflow-hidden shadow-2xl"
              style={isPreviewMax
                ? { width: '100%', height: '100%' }
                : { width: previewSize?.w ?? 800, height: previewSize?.h ?? 600 }}
            >
              <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-3 shrink-0">
                <span className="text-2xl">{previewWork.icon || '🧩'}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-800 truncate">{previewWork.title}</div>
                  <div className="text-xs text-gray-400">
                    {previewWork.author_name || '未知'} {previewWork.class_name ? `· ${previewWork.class_name}` : ''} · 定价 {previewWork.price} 积分
                  </div>
                </div>
                {previewWork.status === 'pending' && (
                  <div className="flex items-center gap-2 shrink-0">
                    <input
                      value={rejectReason}
                      onChange={e => setRejectReason(e.target.value)}
                      placeholder="驳回原因（驳回时必填）"
                      className="w-48 p-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-red-400"
                    />
                    <button
                      onClick={() => handleReview(previewWork.id, 'approved')}
                      className="px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white rounded-lg text-xs transition-colors"
                    >
                      <i className="fa-solid fa-check mr-1"></i>通过
                    </button>
                    <button
                      onClick={() => handleReview(previewWork.id, 'rejected')}
                      className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-xs transition-colors"
                    >
                      <i className="fa-solid fa-xmark mr-1"></i>驳回
                    </button>
                  </div>
                )}
                <button
                  onClick={() => setIsPreviewMax(v => !v)}
                  className="w-8 h-8 flex items-center justify-center text-gray-400 hover:bg-gray-100 rounded-lg shrink-0"
                  title={isPreviewMax ? '还原窗口' : '最大化'}
                >
                  <i className={`fa-solid ${isPreviewMax ? 'fa-compress' : 'fa-expand'}`}></i>
                </button>
                <button
                  onClick={() => { setPreviewWork(null); setRejectReason(''); }}
                  className="w-8 h-8 flex items-center justify-center text-gray-400 hover:bg-gray-100 rounded-lg shrink-0"
                >
                  <i className="fa-solid fa-xmark"></i>
                </button>
              </div>
              <div className="flex-1 min-h-0 relative">
                <iframe
                  title="作品预览"
                  srcDoc={previewWork.code}
                  sandbox="allow-scripts allow-same-origin allow-forms"
                  className="w-full h-full border-0"
                />
                {!isPreviewMax && (
                  <div
                    onMouseDown={startResize}
                    className="absolute bottom-0 right-0 w-6 h-6 flex items-center justify-center cursor-nwse-resize text-gray-400 hover:text-gray-600 select-none"
                    title="拖拽调整大小"
                  >
                    <i className="fa-solid fa-up-right-and-down-left-from-center text-xs"></i>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </LicenseGuard>
  );
};
