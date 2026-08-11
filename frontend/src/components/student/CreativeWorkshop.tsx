import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { backendClient } from '../../api/backendClient';

type Tab = 'create' | 'works' | 'market' | 'myapps' | 'revenue';

interface WorkshopConfig {
  enabled: boolean;
  accessible: boolean;
  licenseValid: boolean;
  author_share_percent: number;
  min_price: number;
  max_price: number;
  daily_gen_limit: number;
  gen_cost: number;
  modify_cost: number;
  open_cost: number;
  min_requirement_chars: number;
}

interface Work {
  id: string;
  title: string;
  description: string;
  icon: string;
  price: number;
  category?: string;
  status: 'draft' | 'pending' | 'approved' | 'rejected' | 'removed';
  reject_reason: string | null;
  view_count: number;
  purchase_count: number;
  is_featured: boolean;
  created_at: string;
  updated_at: string;
  code?: string;
  requirement?: string;
  author_name?: string;
  class_name?: string;
  purchased?: boolean;
  is_owner?: boolean;
  isOwner?: boolean;
  avg_rating?: number;
  rating_count?: number;
  my_rating?: number;
}

const ICON_OPTIONS = ['🧩', '🎮', '🎨', '📚', '🧮', '🎵', '🌌', '🚀', '⚽', '🍀', '🎯', '🧠', '💡', '🌈', '🦄', '🐼'];

// 工坊固定类别
const WORK_CATEGORIES = [
  { id: '创意工具', icon: '🛠️', desc: '辅助创作或表达的工具' },
  { id: '学习助手', icon: '📖', desc: '帮助记忆或理解知识' },
  { id: '生活妙用', icon: '💡', desc: '解决日常生活小问题' },
  { id: '艺术表达', icon: '🎨', desc: '偏重美感与情感表达' },
  { id: '小游戏', icon: '🎮', desc: '轻量级娱乐体验' },
];

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'bg-gray-100 text-gray-600' },
  pending: { label: '待审核', cls: 'bg-amber-100 text-amber-600' },
  approved: { label: '已上架', cls: 'bg-green-100 text-green-600' },
  rejected: { label: '被驳回', cls: 'bg-red-100 text-red-600' },
  removed: { label: '已下架', cls: 'bg-gray-200 text-gray-500' },
};

export const CreativeWorkshop: React.FC = () => {
  const { profile, refreshProfile } = useAuth();
  const [tab, setTab] = useState<Tab>('create');
  const [config, setConfig] = useState<WorkshopConfig | null>(null);
  const [works, setWorks] = useState<Work[]>([]);
  const [marketWorks, setMarketWorks] = useState<Work[]>([]);
  const [myApps, setMyApps] = useState<Work[]>([]);
  const [revenue, setRevenue] = useState<any>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // 当前编辑中的作品
  const [editingWork, setEditingWork] = useState<Work | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isModifying, setIsModifying] = useState(false);
  const [requirement, setRequirement] = useState('');
  const [modifyRequest, setModifyRequest] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('🧩');
  const [price, setPrice] = useState(10);
  const [category, setCategory] = useState('创意工具');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [previewWork, setPreviewWork] = useState<Work | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  // 应用中心筛选排序
  const [marketCategory, setMarketCategory] = useState('all');
  const [marketFeatured, setMarketFeatured] = useState(false);
  const [marketSort, setMarketSort] = useState('newest');
  // 星级评分：hover 的星星数
  const [ratingHover, setRatingHover] = useState(0);
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

  const refresh = useCallback(() => setRefreshKey(k => k + 1), []);

  useEffect(() => {
    fetchConfig();
  }, []);

  useEffect(() => {
    if (config?.accessible) {
      fetchWorks();
      fetchMarket();
      fetchMyApps();
      if (tab === 'revenue') fetchRevenue();
    }
  }, [config, tab, refreshKey]);

  // 应用中心筛选/排序变化时重拉
  useEffect(() => {
    if (config?.accessible) fetchMarket();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, marketCategory, marketFeatured, marketSort]);

  const fetchConfig = async () => {
    try {
      const { data } = await backendClient.get('/api/creative-workshop/config');
      if (data) setConfig(data);
    } catch (err: any) {
      setError(err.message || '获取工坊配置失败');
    }
  };

  const fetchWorks = async () => {
    try {
      const { data } = await backendClient.get('/api/creative-workshop/my-works');
      if (data) setWorks(data);
    } catch (err: any) {
      setError(err.message || '获取作品列表失败');
    }
  };

  const fetchMarket = async () => {
    try {
      const params = new URLSearchParams();
      if (marketCategory && marketCategory !== 'all') params.set('category', marketCategory);
      if (marketFeatured) params.set('featured', '1');
      if (marketSort && marketSort !== 'newest') params.set('sort', marketSort);
      const qs = params.toString();
      const { data } = await backendClient.get(`/api/creative-workshop/market${qs ? `?${qs}` : ''}`);
      if (data) setMarketWorks(data);
    } catch (err: any) {
      setError(err.message || '获取应用中心失败');
    }
  };

  const fetchMyApps = async () => {
    try {
      const { data } = await backendClient.get('/api/creative-workshop/my-apps');
      if (data) setMyApps(data);
    } catch (err: any) {
      setError(err.message || '获取我的应用失败');
    }
  };

  const fetchRevenue = async () => {
    try {
      const { data } = await backendClient.get('/api/creative-workshop/revenue');
      if (data) setRevenue(data);
    } catch (err: any) {
      setError(err.message || '获取收益失败');
    }
  };

  const handleGenerate = async () => {
    setError(null);
    setNotice(null);
    if (!requirement.trim()) {
      setError('请输入需求描述');
      return;
    }
    if (config && requirement.trim().length < config.min_requirement_chars) {
      setError(`需求描述至少 ${config.min_requirement_chars} 个字`);
      return;
    }
    setIsGenerating(true);
    try {
      const { data, error: err } = await backendClient.post('/api/creative-workshop/generate', {
        requirement: requirement.trim(),
        title: title.trim(),
        category,
      });
      if (err) throw new Error(err);
      setNotice(`生成成功！消耗 ${data.pointsCost} 积分`);
      if (profile) await refreshProfile();
      setRequirement('');
      // 打开生成的作品进行编辑
      const { data: detail } = await backendClient.get(`/api/creative-workshop/my-works/${data.id}`);
      if (detail) {
        openEditor(detail);
      }
      refresh();
    } catch (err: any) {
      setError(err.message || '生成失败');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleModify = async () => {
    if (!editingWork) return;
    setError(null);
    setNotice(null);
    if (!modifyRequest.trim()) {
      setError('请输入修改要求');
      return;
    }
    if (config && modifyRequest.trim().length < config.min_requirement_chars) {
      setError(`修改要求至少 ${config.min_requirement_chars} 个字`);
      return;
    }
    setIsModifying(true);
    try {
      const { data, error: err } = await backendClient.post(`/api/creative-workshop/${editingWork.id}/modify`, {
        request: modifyRequest.trim(),
      });
      if (err) throw new Error(err);
      setNotice(`修改成功！消耗 ${data.pointsCost} 积分`);
      if (profile) await refreshProfile();
      setModifyRequest('');
      const { data: detail } = await backendClient.get(`/api/creative-workshop/my-works/${editingWork.id}`);
      if (detail) openEditor(detail);
      refresh();
    } catch (err: any) {
      setError(err.message || '修改失败');
    } finally {
      setIsModifying(false);
    }
  };

  const openEditor = async (work: Work) => {
    // 列表数据不含 code，进入编辑时先加载详情，保证代码与预览立即显示
    let full = work;
    if (!work.code) {
      try {
        const { data } = await backendClient.get(`/api/creative-workshop/my-works/${work.id}`);
        if (data) full = data;
      } catch { /* 详情加载失败则用已有数据 */ }
    }
    setEditingWork(full);
    setTitle(full.title || '');
    setDescription(full.description || '');
    setIcon(full.icon || '🧩');
    setPrice(full.price ?? 0);
    setCategory(full.category || '创意工具');
    setCode(full.code || '');
    setTab('create');
  };

  const handleSaveWork = async () => {
    if (!editingWork) return;
    setError(null);
    setNotice(null);
    if (!WORK_CATEGORIES.some(c => c.id === category)) {
      setError('请选择作品类别');
      return;
    }
    try {
      const { error: err } = await backendClient.put(`/api/creative-workshop/my-works/${editingWork.id}`, {
        title: title.trim(),
        description: description.trim(),
        icon,
        price: Number(price) || 0,
        category,
        code,
      });
      if (err) throw new Error(err);
      setNotice('保存成功');
      refresh();
    } catch (err: any) {
      setError(err.message || '保存失败');
    }
  };

  const handleSubmitReview = async () => {
    if (!editingWork) return;
    setError(null);
    setNotice(null);
    if (!WORK_CATEGORIES.some(c => c.id === category)) {
      setError('请选择作品类别后再提交审核');
      return;
    }
    try {
      const { error: err } = await backendClient.post(`/api/creative-workshop/my-works/${editingWork.id}/submit`, {});
      if (err) throw new Error(err);
      setNotice('已提交审核，请等待老师审核');
      refresh();
    } catch (err: any) {
      setError(err.message || '提交失败');
    }
  };

  const handleDeleteWork = async (id: string) => {
    if (!window.confirm('确定删除这个作品吗？删除后无法恢复。')) return;
    try {
      await backendClient.delete(`/api/creative-workshop/my-works/${id}`);
      setEditingWork(null);
      refresh();
    } catch (err: any) {
      setError(err.message || '删除失败');
    }
  };

  // 打开应用：先调用 open 接口（每次打开消耗 open_cost 积分，作者免费），再加载详情预览
  const openAppPreview = async (work: Work) => {
    try {
      const openRes = await backendClient.post(`/api/creative-workshop/market/${work.id}/open`, {});
      if (openRes.error) throw new Error(openRes.error);
      if (openRes.data?.cost > 0) {
        setNotice(`打开应用消耗 ${openRes.data.cost} 积分`);
        if (profile) await refreshProfile();
      }
      const { data } = await backendClient.get(`/api/creative-workshop/market/${work.id}`);
      if (data) setPreviewWork(data);
    } catch (err: any) {
      setError(err.message || '打开应用失败');
    }
  };

  // 预览自己的作品（草稿/待审核等非上架状态），直接加载本地代码展示
  const previewOwnWork = async (work: Work) => {
    try {
      const { data } = await backendClient.get(`/api/creative-workshop/my-works/${work.id}`);
      if (data) setPreviewWork(data);
    } catch (err: any) {
      setError(err.message || '预览作品失败');
    }
  };

  const handlePurchase = async (work: Work) => {
    setError(null);
    if (work.purchased) {
      await openAppPreview(work);
      return;
    }
    if (!window.confirm(`确定花费 ${work.price} 积分购买「${work.title}」吗？`)) return;
    setPurchasing(true);
    try {
      const { data, error: err } = await backendClient.post(`/api/creative-workshop/market/${work.id}/purchase`, {});
      if (err) throw new Error(err);
      setNotice(`购买成功！花费 ${data.price} 积分`);
      if (profile) await refreshProfile();
      refresh();
      // 购买后打开预览
      await openAppPreview(work);
    } catch (err: any) {
      setError(err.message || '购买失败');
    } finally {
      setPurchasing(false);
    }
  };

  const handleOpenApp = async (work: Work) => {
    await openAppPreview(work);
  };

  // 评分应用（购买者可为应用评 1-5 星）
  const handleRate = async (app: Work, rating: number) => {
    setError(null);
    try {
      const { error: err } = await backendClient.post(`/api/creative-workshop/market/${app.id}/rating`, { rating });
      if (err) throw new Error(err);
      setNotice(`评分成功：${rating} 星`);
      setRefreshKey(k => k + 1);
    } catch (err: any) {
      setError(err.message || '评分失败');
    }
  };

  if (!config) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        <i className="fa-solid fa-circle-notch fa-spin mr-2"></i>加载中...
      </div>
    );
  }

  if (!config.accessible) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-gray-600">
        <div className="text-6xl">🚪</div>
        <p className="text-lg">AI创意工坊暂未对你所在班级开放</p>
        <p className="text-sm text-gray-400">请联系老师开启</p>
      </div>
    );
  }

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'create', label: 'AI创作', icon: 'fa-wand-magic-sparkles' },
    { id: 'works', label: '我的作品集', icon: 'fa-folder-open' },
    { id: 'market', label: '工坊应用中心', icon: 'fa-store' },
    { id: 'myapps', label: '我的应用', icon: 'fa-box-open' },
    { id: 'revenue', label: '作者中心', icon: 'fa-coins' },
  ];

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* 顶部标签页 */}
      <div className="flex items-center gap-1 px-4 pt-3 pb-2 bg-white border-b border-gray-200 shrink-0 flex-wrap">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 transition-colors ${
              tab === t.id ? 'bg-fuchsia-100 text-fuchsia-600 font-medium' : 'text-gray-500 hover:bg-gray-100'
            }`}
          >
            <i className={`fa-solid ${t.icon}`}></i>
            {t.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-3 text-xs text-gray-500">
          {profile && (
            <span className="flex items-center gap-1 bg-amber-50 text-amber-600 px-2 py-1 rounded-full">
              <i className="fa-solid fa-coins"></i>
              {profile.current_points} 积分
            </span>
          )}
          {config && (
            <span className="text-gray-400">
              <i className="fa-solid fa-bolt mr-1 text-fuchsia-400"></i>
              每日{config.daily_gen_limit}次 · 生成{config.gen_cost}分/次 · 修改{config.modify_cost}分/次
            </span>
          )}
        </div>
      </div>

      {/* 提示信息 */}
      {(error || notice) && (
        <div className="px-4 pt-3 shrink-0">
          {error && (
            <div className="flex items-start gap-2 bg-red-50 text-red-600 px-3 py-2 rounded-lg text-sm">
              <i className="fa-solid fa-circle-exclamation mt-0.5"></i>
              <div className="flex-1">{error}</div>
              <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
          )}
          {notice && (
            <div className="flex items-start gap-2 bg-green-50 text-green-600 px-3 py-2 rounded-lg text-sm">
              <i className="fa-solid fa-circle-check mt-0.5"></i>
              <div className="flex-1">{notice}</div>
              <button onClick={() => setNotice(null)} className="text-green-400 hover:text-green-600">
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
          )}
        </div>
      )}

      {/* 内容区 */}
      <div className="flex-1 overflow-auto p-4">
        {tab === 'create' && (
          <div className="h-full flex flex-col gap-4">
            {/* 需求输入区 */}
            {!editingWork ? (
              <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-200">
                <h3 className="font-medium text-gray-800 mb-1 flex items-center gap-2">
                  <i className="fa-solid fa-wand-magic-sparkles text-fuchsia-500"></i>
                  用一句话描述你想要的作品
                </h3>
                <p className="text-xs text-gray-400 mb-3">
                  例如：一个数学计算器、一个班级成绩查询小工具、一个植物大战僵尸小游戏……
                </p>
                <textarea
                  value={requirement}
                  onChange={e => setRequirement(e.target.value)}
                  placeholder={`请输入需求描述（至少 ${config.min_requirement_chars} 个字），AI 将为你生成一个完整的网页应用`}
                  className="w-full h-28 p-3 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
                />
                <div className="mt-3">
                  <label className="text-xs text-gray-500 block mb-1.5">作品类别（必选）</label>
                  <div className="flex flex-wrap gap-2">
                    {WORK_CATEGORIES.map(c => (
                      <button
                        key={c.id}
                        onClick={() => setCategory(c.id)}
                        title={c.desc}
                        className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${category === c.id ? 'bg-fuchsia-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                      >
                        {c.icon} {c.id}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-3">
                  <input
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    placeholder="作品名称（可选，默认取需求开头）"
                    className="flex-1 p-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
                  />
                  <button
                    onClick={handleGenerate}
                    disabled={isGenerating}
                    className="px-5 py-2.5 bg-fuchsia-500 text-white rounded-lg text-sm font-medium hover:bg-fuchsia-600 disabled:opacity-50 flex items-center gap-2 transition-colors shrink-0"
                  >
                    {isGenerating ? (
                      <>
                        <i className="fa-solid fa-circle-notch fa-spin"></i>
                        AI 生成中...
                      </>
                    ) : (
                      <>
                        <i className="fa-solid fa-wand-magic-sparkles"></i>
                        AI 生成（{config.gen_cost}积分）
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-200">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-medium text-gray-800">{editingWork.title}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_MAP[editingWork.status]?.cls || ''}`}>
                    {STATUS_MAP[editingWork.status]?.label || editingWork.status}
                  </span>
                  {editingWork.status === 'rejected' && editingWork.reject_reason && (
                    <span className="text-xs text-red-500">驳回原因：{editingWork.reject_reason}</span>
                  )}
                  <button
                    onClick={() => setEditingWork(null)}
                    className="ml-auto text-sm text-gray-400 hover:text-gray-600"
                  >
                    <i className="fa-solid fa-xmark mr-1"></i>关闭编辑
                  </button>
                </div>
                <div className="mt-3 flex gap-3">
                  <input
                    value={modifyRequest}
                    onChange={e => setModifyRequest(e.target.value)}
                    placeholder={`让 AI 修改作品，例如：把背景改成星空主题、加一个计分功能……（至少 ${config.min_requirement_chars} 个字）`}
                    className="flex-1 p-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
                  />
                  <button
                    onClick={handleModify}
                    disabled={isModifying}
                    className="px-4 py-2.5 bg-indigo-500 text-white rounded-lg text-sm font-medium hover:bg-indigo-600 disabled:opacity-50 flex items-center gap-2 transition-colors shrink-0"
                  >
                    {isModifying ? (
                      <><i className="fa-solid fa-circle-notch fa-spin"></i>修改中...</>
                    ) : (
                      <><i className="fa-solid fa-wand-magic-sparkles"></i>AI 修改（{config.modify_cost}积分）</>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* 编辑区：预览 + 代码 */}
            {editingWork && (
              <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 预览 */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col min-h-0">
                  <div className="px-3 py-2 border-b border-gray-200 text-sm text-gray-600 flex items-center gap-2 shrink-0">
                    <i className="fa-solid fa-eye text-fuchsia-500"></i>
                    实时预览
                  </div>
                  <div className="flex-1 min-h-0">
                    <iframe
                      title="作品预览"
                      srcDoc={code}
                      sandbox="allow-scripts allow-same-origin allow-forms"
                      className="w-full h-full border-0"
                    />
                  </div>
                </div>
                {/* 代码编辑器 */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col min-h-0">
                  <div className="px-3 py-2 border-b border-gray-200 text-sm text-gray-600 flex items-center gap-2 shrink-0">
                    <i className="fa-solid fa-code text-indigo-500"></i>
                    代码编辑
                  </div>
                  <textarea
                    value={code}
                    onChange={e => setCode(e.target.value)}
                    spellCheck={false}
                    className="flex-1 min-h-0 w-full p-3 text-xs font-mono bg-slate-900 text-emerald-300 resize-none focus:outline-none"
                  />
                </div>
              </div>
            )}

            {/* 作品信息编辑 + 提交 */}
            {editingWork && (
              <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-200">
                <h4 className="text-sm font-medium text-gray-700 mb-3">作品信息</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">作品名称</label>
                    <input
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      className="w-full p-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">
                      积分价格（{config.min_price}-{config.max_price}）
                    </label>
                    <input
                      type="number"
                      value={price}
                      onChange={e => setPrice(Number(e.target.value))}
                      min={config.min_price}
                      max={config.max_price}
                      className="w-full p-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">表情图标</label>
                    <div className="flex flex-wrap gap-1">
                      {ICON_OPTIONS.slice(0, 8).map(opt => (
                        <button
                          key={opt}
                          onClick={() => setIcon(opt)}
                          className={`w-8 h-8 rounded-lg text-lg flex items-center justify-center transition-colors ${
                            icon === opt ? 'bg-fuchsia-100 ring-2 ring-fuchsia-400' : 'bg-gray-50 hover:bg-gray-100'
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="md:col-span-3">
                    <label className="text-xs text-gray-500 block mb-1">作品简介（审核时老师可见，可写创作思路、功能说明）</label>
                    <textarea
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      rows={2}
                      placeholder="介绍一下你的作品吧"
                      className="w-full p-2.5 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
                    />
                  </div>
                  <div className="md:col-span-3">
                    <label className="text-xs text-gray-500 block mb-1">作品类别（必选）</label>
                    <div className="flex flex-wrap gap-2">
                      {WORK_CATEGORIES.map(c => (
                        <button
                          key={c.id}
                          onClick={() => setCategory(c.id)}
                          title={c.desc}
                          className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${category === c.id ? 'bg-fuchsia-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                        >
                          {c.icon} {c.id}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-4 flex-wrap">
                  <button
                    onClick={handleSaveWork}
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 transition-colors"
                  >
                    <i className="fa-solid fa-floppy-disk mr-1"></i>保存修改
                  </button>
                  <button
                    onClick={handleSubmitReview}
                    disabled={editingWork.status === 'pending'}
                    className="px-4 py-2 bg-green-500 text-white rounded-lg text-sm font-medium hover:bg-green-600 disabled:opacity-50 transition-colors"
                  >
                    <i className="fa-solid fa-paper-plane mr-1"></i>
                    {editingWork.status === 'pending' ? '已提交审核' : '提交审核'}
                  </button>
                  {editingWork.status === 'approved' && (
                    <span className="text-xs text-amber-600">
                      <i className="fa-solid fa-circle-info mr-1"></i>
                      已上架作品，修改保存后将回到草稿状态，需重新审核
                    </span>
                  )}
                  <button
                    onClick={() => handleDeleteWork(editingWork.id)}
                    className="ml-auto px-3 py-2 text-red-500 hover:bg-red-50 rounded-lg text-sm transition-colors"
                  >
                    <i className="fa-solid fa-trash mr-1"></i>删除作品
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'works' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {works.length === 0 && (
              <div className="col-span-full text-center text-gray-400 py-16">
                <i className="fa-solid fa-folder-open text-4xl mb-3 block"></i>
                还没有作品，去「AI创作」生成第一个吧！
              </div>
            )}
            {works.map(work => (
              <div key={work.id} className="bg-white rounded-xl p-4 shadow-sm border border-gray-200 flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{work.icon || '🧩'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-800 truncate">{work.title}</div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_MAP[work.status]?.cls || ''}`}>
                      {STATUS_MAP[work.status]?.label || work.status}
                    </span>
                  </div>
                </div>
                {work.status === 'approved' && (
                  <div className="text-xs text-gray-500">
                    价格 {work.price} 积分 · 售出 {work.purchase_count} · 浏览 {work.view_count}
                  </div>
                )}
                {work.status === 'rejected' && work.reject_reason && (
                  <div className="text-xs text-red-500 bg-red-50 rounded-lg p-2">驳回：{work.reject_reason}</div>
                )}
                <div className="flex gap-2 mt-1">
                  <button
                    onClick={() => (work.status === 'approved' ? openAppPreview(work) : previewOwnWork(work))}
                    className="flex-1 px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-xs transition-colors"
                  >
                    <i className="fa-solid fa-play mr-1"></i>打开
                  </button>
                  <button
                    onClick={() => openEditor(work)}
                    className="flex-1 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs transition-colors"
                  >
                    <i className="fa-solid fa-pen mr-1"></i>编辑
                  </button>
                  {work.status !== 'pending' && (
                    <button
                      onClick={async () => {
                        try {
                          const { error: err } = await backendClient.post(`/api/creative-workshop/my-works/${work.id}/submit`, {});
                          if (err) throw new Error(err);
                          setNotice('已提交审核');
                          refresh();
                        } catch (err: any) {
                          setError(err.message || '提交失败');
                        }
                      }}
                      className="flex-1 px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white rounded-lg text-xs transition-colors"
                    >
                      <i className="fa-solid fa-paper-plane mr-1"></i>提交审核
                    </button>
                  )}
                  <button
                    onClick={() => handleDeleteWork(work.id)}
                    className="px-3 py-1.5 text-red-500 hover:bg-red-50 rounded-lg text-xs transition-colors"
                  >
                    <i className="fa-solid fa-trash"></i>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'market' && (
          <div className="flex flex-col gap-4">
            {/* 筛选排序栏 */}
            <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-200 flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setMarketCategory('all')}
                className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${marketCategory === 'all' ? 'bg-fuchsia-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                全部
              </button>
              {WORK_CATEGORIES.map(c => (
                <button
                  key={c.id}
                  onClick={() => setMarketCategory(c.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${marketCategory === c.id ? 'bg-fuchsia-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  {c.icon} {c.id}
                </button>
              ))}
              <div className="w-px h-5 bg-gray-200 mx-1"></div>
              <button
                onClick={() => setMarketFeatured(v => !v)}
                className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${marketFeatured ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                <i className="fa-solid fa-star mr-1"></i>仅看推荐
              </button>
              <select
                value={marketSort}
                onChange={e => setMarketSort(e.target.value)}
                className="ml-auto px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
              >
                <option value="newest">最新发布</option>
                <option value="rating">评分最高</option>
                <option value="views">访问最多</option>
                <option value="sales">销量最高</option>
                <option value="price">价格最高</option>
              </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {marketWorks.length === 0 && (
              <div className="col-span-full text-center text-gray-400 py-16">
                <i className="fa-solid fa-store text-4xl mb-3 block"></i>
                应用中心空空如也，快去创作并发布第一个作品吧！
              </div>
            )}
            {marketWorks.map(work => (
              <div key={work.id} className="bg-white rounded-xl p-4 shadow-sm border border-gray-200 flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  {work.is_featured && (
                    <span className="absolute -top-2 -left-2 bg-amber-400 text-white text-[10px] px-2 py-0.5 rounded-full shadow">
                      <i className="fa-solid fa-star mr-0.5"></i>推荐
                    </span>
                  )}
                  <span className="text-3xl relative">{work.icon || '🧩'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-800 truncate">{work.title}</div>
                    <div className="text-xs text-gray-400">作者：{work.author_name || '未知'}</div>
                  </div>
                </div>
                <div className="text-xs text-gray-500 line-clamp-2 min-h-[2rem]">{work.description || '暂无简介'}</div>
                <div className="flex items-center gap-1 text-amber-500" title={`平均 ${work.avg_rating ?? 0} 星，共 ${work.rating_count ?? 0} 人评分`}>
                  {[1, 2, 3, 4, 5].map(n => (
                    <i
                      key={n}
                      className={`text-xs ${n <= Math.round(work.avg_rating || 0) ? 'fa-solid fa-star text-amber-400' : 'fa-regular fa-star text-gray-300'}`}
                    ></i>
                  ))}
                  <span className="text-xs text-gray-600 ml-1">{work.avg_rating || 0}</span>
                  {(work.rating_count ?? 0) > 0 && (
                    <span className="text-xs text-gray-400">({work.rating_count})</span>
                  )}
                  {(work.rating_count ?? 0) === 0 && <span className="text-xs text-gray-300">暂无评分</span>}
                </div>
                <div className="flex items-center justify-between mt-1">
                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <span><i className="fa-solid fa-eye mr-1"></i>{work.view_count}</span>
                    <span><i className="fa-solid fa-cart-shopping mr-1"></i>{work.purchase_count}</span>
                    {config.open_cost > 0 && (
                      <span title="每次打开应用消耗的积分">
                        <i className="fa-solid fa-door-open mr-1"></i>打开{config.open_cost}分
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-amber-600 font-medium text-sm">
                      <i className="fa-solid fa-coins mr-0.5"></i>{work.price}
                    </span>
                    <button
                      onClick={() => handlePurchase(work)}
                      disabled={purchasing || work.is_owner}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${
                        work.is_owner
                          ? 'bg-gray-100 text-gray-500 cursor-not-allowed'
                          : work.purchased
                          ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          : 'bg-fuchsia-500 text-white hover:bg-fuchsia-600'
                      }`}
                    >
                      {work.is_owner ? '我的作品' : work.purchased ? '已购买 · 打开' : '购买'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
            </div>
          </div>
        )}

        {tab === 'myapps' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {myApps.length === 0 && (
              <div className="col-span-full text-center text-gray-400 py-16">
                <i className="fa-solid fa-box-open text-4xl mb-3 block"></i>
                还没有购买应用，去「工坊应用中心」逛逛吧！
              </div>
            )}
            {myApps.map(app => (
              <div key={app.id} className="bg-white rounded-xl p-4 shadow-sm border border-gray-200 flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{app.icon || '🧩'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-800 truncate">{app.title}</div>
                    <div className="text-xs text-gray-400">花费 {app.price} 积分购入</div>
                  </div>
                </div>
                <div className="text-xs text-gray-500 line-clamp-2 min-h-[2rem]">{app.description || '暂无简介'}</div>
                {config.open_cost > 0 && (
                  <div className="text-xs text-amber-600">
                    <i className="fa-solid fa-door-open mr-1"></i>每次打开消耗 {config.open_cost} 积分
                  </div>
                )}
                <div className="flex items-center justify-between mt-1">
                  <div
                    className="flex items-center gap-1"
                    onMouseLeave={() => setRatingHover(0)}
                  >
                    {[1, 2, 3, 4, 5].map(n => (
                      <button
                        key={n}
                        onMouseEnter={() => setRatingHover(n)}
                        onClick={() => handleRate(app, n)}
                        className="text-base leading-none transition-colors"
                        title={`评分 ${n} 星`}
                      >
                        <i className={`${(ratingHover || app.my_rating || 0) >= n ? 'fa-solid fa-star text-amber-400' : 'fa-regular fa-star text-gray-300'}`}></i>
                      </button>
                    ))}
                    <span className="text-xs text-gray-400 ml-1">
                      {app.my_rating ? `已评 ${app.my_rating} 星` : '未评分'}
                    </span>
                  </div>
                  <button
                    onClick={() => handleOpenApp(app)}
                    className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-xs font-medium transition-colors"
                  >
                    <i className="fa-solid fa-play mr-1"></i>打开应用
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'revenue' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
                <div className="text-xs text-gray-500 mb-1">累计提成收入</div>
                <div className="text-2xl font-bold text-amber-600">
                  <i className="fa-solid fa-coins mr-1 text-amber-500"></i>
                  {Number(revenue?.totalRevenue ?? 0)}
                </div>
              </div>
              <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
                <div className="text-xs text-gray-500 mb-1">售出次数</div>
                <div className="text-2xl font-bold text-gray-800">{revenue?.totalPurchases ?? 0}</div>
              </div>
              <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
                <div className="text-xs text-gray-500 mb-1">提成比例</div>
                <div className="text-2xl font-bold text-green-600">{config.author_share_percent}%</div>
                <div className="text-xs text-gray-400 mt-1">由老师设置</div>
              </div>
            </div>

            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
              <h4 className="text-sm font-medium text-gray-700 mb-3">我的作品</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                      <th className="py-2 pr-3">作品</th>
                      <th className="py-2 pr-3">价格</th>
                      <th className="py-2 pr-3">售出</th>
                      <th className="py-2 pr-3">浏览</th>
                      <th className="py-2">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {revenue?.works?.map((w: any) => (
                      <tr key={w.id} className="border-b border-gray-50">
                        <td className="py-2 pr-3 font-medium text-gray-700">{w.title}</td>
                        <td className="py-2 pr-3 text-amber-600">{w.price}</td>
                        <td className="py-2 pr-3">{w.purchase_count}</td>
                        <td className="py-2 pr-3">{w.view_count}</td>
                        <td className="py-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_MAP[w.status]?.cls || ''}`}>
                            {STATUS_MAP[w.status]?.label || w.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {(!revenue?.works || revenue.works.length === 0) && (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-gray-400">暂无作品</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
              <h4 className="text-sm font-medium text-gray-700 mb-3">提成明细</h4>
              <div className="space-y-2">
                {revenue?.purchases?.map((p: any) => (
                  <div key={`buy-${p.id}`} className="flex items-center gap-3 text-sm py-1.5 border-b border-gray-50">
                    <i className="fa-solid fa-cart-shopping text-gray-300"></i>
                    <span className="flex-1 truncate text-gray-700">{p.title}</span>
                    <span className="text-gray-400 text-xs">{p.created_at?.slice(0, 16)}</span>
                    <span className="text-green-600 font-medium">+{p.author_share} 积分</span>
                  </div>
                ))}
                {revenue?.opens?.map((o: any) => (
                  <div key={`open-${o.id}`} className="flex items-center gap-3 text-sm py-1.5 border-b border-gray-50">
                    <i className="fa-solid fa-door-open text-sky-400"></i>
                    <span className="flex-1 truncate text-gray-700">{o.title}<span className="text-gray-400 ml-1">（打开提成）</span></span>
                    <span className="text-gray-400 text-xs">{o.created_at?.slice(0, 16)}</span>
                    <span className="text-green-600 font-medium">+{o.amount} 积分</span>
                  </div>
                ))}
                {(!revenue?.purchases || (revenue.purchases.length === 0 && revenue.opens?.length === 0)) && (
                  <div className="text-center text-gray-400 py-6">暂无提成记录</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 应用预览弹窗 */}
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
                  作者：{previewWork.author_name || '未知'}
                  {previewWork.price > 0 && ` · ${previewWork.price} 积分`}
                </div>
              </div>
              <button
                onClick={() => setIsPreviewMax(v => !v)}
                className="w-8 h-8 flex items-center justify-center text-gray-400 hover:bg-gray-100 rounded-lg"
                title={isPreviewMax ? '还原窗口' : '最大化'}
              >
                <i className={`fa-solid ${isPreviewMax ? 'fa-compress' : 'fa-expand'}`}></i>
              </button>
              <button
                onClick={() => setPreviewWork(null)}
                className="w-8 h-8 flex items-center justify-center text-gray-400 hover:bg-gray-100 rounded-lg"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div className="flex-1 min-h-0 relative">
              <iframe
                title="应用预览"
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
  );
};
