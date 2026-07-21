import React, { useCallback, useEffect, useState } from 'react';
import { backendClient } from '../../api/backendClient';
import { useAuth } from '../../hooks/useAuth';
import { Class } from '../../types';

// 上网管理：站点白名单 / 待审核域名 / 访问记录

interface ProxySite {
  id: number;
  name: string;
  url: string;
  icon: string | null;
  enabled: number | boolean;
  sort_order: number;
  allowed_domains: string[];
}

interface PendingDomain {
  id: number;
  domain: string;
  site_id: number;
  site_name: string | null;
  hit_count: number;
  first_seen_at: string;
  last_seen_at: string;
}

interface AccessLogRow {
  id: number;
  student_id: string;
  real_name: string | null;
  username: string | null;
  class_id: string | null;
  site_id: number;
  site_name: string | null;
  url: string;
  created_at: string;
}

interface CacheSettings {
  enabled: number;
  limit_mb: number;
  cache_dir: string;
  total_bytes: number;
  file_count: number;
}

interface SiteForm {
  id: number | null;
  name: string;
  url: string;
  icon: string;
  enabled: boolean;
  sort_order: number;
  domainsText: string; // allowed_domains 多行编辑
}

const emptyForm: SiteForm = {
  id: null,
  name: '',
  url: '',
  icon: '',
  enabled: true,
  sort_order: 0,
  domainsText: '',
};

const formatTime = (t: string) => {
  if (!t) return '-';
  const d = new Date(t);
  return isNaN(d.getTime()) ? t : d.toLocaleString('zh-CN', { hour12: false });
};

export const ProxyManager: React.FC = () => {
  const { profile } = useAuth();
  const [tab, setTab] = useState<'sites' | 'pending' | 'logs' | 'cache'>('sites');

  // 站点
  const [sites, setSites] = useState<ProxySite[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<SiteForm>(emptyForm);
  const [fetchingInfo, setFetchingInfo] = useState(false);
  const [fetchedDomains, setFetchedDomains] = useState<string[] | null>(null);

  // 待审核域名
  const [pending, setPending] = useState<PendingDomain[]>([]);
  const [approveTarget, setApproveTarget] = useState<Record<number, number | ''>>({});
  const [approveAllSiteId, setApproveAllSiteId] = useState<number | ''>('');

  // 访问记录
  const [logs, setLogs] = useState<AccessLogRow[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [logClassId, setLogClassId] = useState('');

  // 缓存设置
  const [cacheSettings, setCacheSettings] = useState<CacheSettings | null>(null);
  const [cacheEnabled, setCacheEnabled] = useState(true);
  const [cacheLimitInput, setCacheLimitInput] = useState('2048');
  const [savingCache, setSavingCache] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);

  const loadSites = useCallback(async () => {
    setLoading(true);
    try {
      const result = await backendClient.get('/api/teacher/proxy/sites');
      if (result.data) setSites(result.data);
    } catch (error) {
      console.error('加载站点列表失败:', error);
    }
    setLoading(false);
  }, []);

  const loadPending = useCallback(async () => {
    try {
      const result = await backendClient.get('/api/teacher/proxy/pending-domains');
      if (result.data) setPending(result.data);
    } catch (error) {
      console.error('加载待审核域名失败:', error);
    }
  }, []);

  const loadLogs = useCallback(async (classId: string) => {
    try {
      const params: any = { limit: 100 };
      if (classId) params.class_id = classId;
      const result = await backendClient.get('/api/teacher/proxy/access-log', params);
      if (result.data) setLogs(result.data);
    } catch (error) {
      console.error('加载访问记录失败:', error);
    }
  }, []);

  useEffect(() => {
    if (!profile) return;
    loadSites();
    loadPending();
    loadLogs('');
    // 访问记录的班级过滤器
    backendClient
      .from('classes')
      .select('*')
      .eq('teacher_id', profile.id)
      .order('created_at', { ascending: false })
      .then(({ data }: any) => {
        if (data) setClasses(data as Class[]);
      });
  }, [profile, loadSites, loadPending, loadLogs]);

  // ===== 缓存设置 =====

  const loadCacheSettings = useCallback(async () => {
    try {
      const result = await backendClient.get('/api/teacher/proxy/cache/settings');
      if (result.data) {
        setCacheSettings(result.data);
        setCacheEnabled(result.data.enabled === 1);
        setCacheLimitInput(String(result.data.limit_mb));
      }
    } catch (error) {
      console.error('加载缓存设置失败:', error);
    }
  }, []);

  useEffect(() => {
    if (tab === 'cache') loadCacheSettings();
  }, [tab, loadCacheSettings]);

  const handleSaveCache = async () => {
    const limit = parseInt(cacheLimitInput, 10);
    if (!Number.isFinite(limit) || limit < 100 || limit > 51200) {
      alert('缓存上限需在 100~51200 MB（100MB~50GB）之间');
      return;
    }
    setSavingCache(true);
    try {
      const result = await backendClient.put('/api/teacher/proxy/cache/settings', {
        enabled: cacheEnabled,
        limit_mb: limit,
      });
      if (result.error) {
        alert(typeof result.error === 'string' ? result.error : '保存失败');
        return;
      }
      alert('缓存设置已保存');
      loadCacheSettings();
    } catch (error) {
      alert('保存失败：' + (error as Error).message);
    } finally {
      setSavingCache(false);
    }
  };

  const handleClearCache = async () => {
    if (!confirm('确定清空全部缓存文件？学生下次访问会重新从外网拉取，不影响正常使用。')) return;
    setClearingCache(true);
    try {
      const result = await backendClient.post('/api/teacher/proxy/cache/clear', {});
      const mb = ((result.data?.freed_bytes ?? 0) / 1024 / 1024).toFixed(1);
      alert(`已清空缓存，释放 ${mb} MB（${result.data?.removed_files ?? 0} 个文件）`);
      loadCacheSettings();
    } catch (error) {
      alert('清空失败：' + (error as Error).message);
    } finally {
      setClearingCache(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
    if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return bytes + ' B';
  };

  // ===== 站点编辑弹窗 =====

  const openCreate = () => {
    setForm(emptyForm);
    setFetchedDomains(null);
    setShowModal(true);
  };

  const openEdit = (site: ProxySite) => {
    setForm({
      id: site.id,
      name: site.name,
      url: site.url,
      icon: site.icon || '',
      enabled: site.enabled === 1 || site.enabled === true,
      sort_order: site.sort_order,
      domainsText: (site.allowed_domains || []).join('\n'),
    });
    setFetchedDomains(null);
    setShowModal(true);
  };

  // 自动获取子资源域名：调服务端抓取页面，返回的域名一键合并进编辑框
  const handleFetchSiteInfo = async () => {
    if (!form.url.trim()) {
      alert('请先填写站点 URL');
      return;
    }
    setFetchingInfo(true);
    try {
      const result = await backendClient.post('/api/teacher/proxy/fetch-site-info', { url: form.url.trim() });
      if (result.error) {
        alert(typeof result.error === 'string' ? result.error : '抓取失败');
        return;
      }
      const info = result.data;
      setFetchedDomains(info.domains || []);
      // 已存在的域名保留，新域名合并进来
      const existing = form.domainsText.split('\n').map(d => d.trim()).filter(Boolean);
      const merged = Array.from(new Set([...existing, ...(info.domains || [])])).sort();
      setForm(f => ({
        ...f,
        domainsText: merged.join('\n'),
        name: f.name || info.title || f.name,
        icon: f.icon || info.favicon || f.icon,
      }));
    } catch (error) {
      alert('抓取失败：' + (error as Error).message);
    } finally {
      setFetchingInfo(false);
    }
  };

  const handleSave = async () => {
    const domains = form.domainsText.split('\n').map(d => d.trim()).filter(Boolean);
    const payload = {
      name: form.name.trim(),
      url: form.url.trim(),
      icon: form.icon.trim() || null,
      enabled: form.enabled,
      sort_order: form.sort_order,
      allowed_domains: domains,
    };
    if (!payload.name || !payload.url) {
      alert('站点名称和URL不能为空');
      return;
    }
    try {
      if (form.id == null) {
        await backendClient.post('/api/teacher/proxy/sites', payload);
      } else {
        await backendClient.put(`/api/teacher/proxy/sites/${form.id}`, payload);
      }
      setShowModal(false);
      loadSites();
    } catch (error) {
      alert('保存失败：' + (error as Error).message);
    }
  };

  const handleDelete = async (site: ProxySite) => {
    if (!confirm(`确定删除站点「${site.name}」？学生将无法再通过代理访问它。`)) return;
    try {
      await backendClient.delete(`/api/teacher/proxy/sites/${site.id}`);
      loadSites();
    } catch (error) {
      alert('删除失败：' + (error as Error).message);
    }
  };

  const handleToggleEnabled = async (site: ProxySite) => {
    try {
      await backendClient.put(`/api/teacher/proxy/sites/${site.id}`, {
        name: site.name,
        url: site.url,
        icon: site.icon,
        enabled: !(site.enabled === 1 || site.enabled === true),
        sort_order: site.sort_order,
        allowed_domains: site.allowed_domains || [],
      });
      loadSites();
    } catch (error) {
      alert('操作失败：' + (error as Error).message);
    }
  };

  // ===== 待审核域名 =====

  const handleApprove = async (row: PendingDomain) => {
    const siteId = approveTarget[row.id] || row.site_id || '';
    if (!siteId) {
      alert('请选择要并入的站点');
      return;
    }
    try {
      await backendClient.post(`/api/teacher/proxy/pending-domains/${row.id}/approve`, { site_id: siteId });
      loadPending();
      loadSites();
    } catch (error) {
      alert('批准失败：' + (error as Error).message);
    }
  };

  const handleIgnore = async (row: PendingDomain) => {
    try {
      await backendClient.delete(`/api/teacher/proxy/pending-domains/${row.id}`);
      loadPending();
    } catch (error) {
      alert('操作失败：' + (error as Error).message);
    }
  };

  // 一键批准：全部待审核域名并入指定站点
  const handleApproveAll = async () => {
    if (!approveAllSiteId) {
      alert('请先选择要并入的站点');
      return;
    }
    if (pending.length === 0) return;
    const siteName = sites.find(s => s.id === approveAllSiteId)?.name || '';
    if (!confirm(`将把全部 ${pending.length} 个待审核域名并入站点「${siteName}」的白名单，继续？`)) return;
    try {
      const result = await backendClient.post('/api/teacher/proxy/pending-domains/approve-all', { site_id: approveAllSiteId });
      alert(`已批准 ${result.data?.approved ?? 0} 个域名（新增 ${result.data?.added ?? 0} 个，其余为重复）`);
      loadPending();
      loadSites();
    } catch (error) {
      alert('一键批准失败：' + (error as Error).message);
    }
  };

  // 一键清空：删除全部待审核记录
  const handleClearAll = async () => {
    if (pending.length === 0) return;
    if (!confirm(`将删除全部 ${pending.length} 条待审核记录（不并入任何站点），继续？`)) return;
    try {
      await backendClient.delete('/api/teacher/proxy/pending-domains/all');
      loadPending();
    } catch (error) {
      alert('清空失败：' + (error as Error).message);
    }
  };

  const tabBtn = (key: typeof tab, label: string, badge?: number) => (
    <button
      onClick={() => setTab(key)}
      className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
        tab === key ? 'bg-white text-blue-600 border border-b-white border-gray-200 -mb-px' : 'text-gray-500 hover:text-gray-700'
      }`}
    >
      {label}
      {badge != null && badge > 0 && (
        <span className="ml-1.5 px-1.5 py-0.5 bg-red-500 text-white text-[10px] rounded-full">{badge}</span>
      )}
    </button>
  );

  return (
    <div className="p-6 h-full overflow-y-auto bg-gray-50">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-cyan-600 flex items-center justify-center text-white">
          <i className="fa-solid fa-earth-asia"></i>
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-800">上网管理</h2>
          <p className="text-xs text-gray-500">维护学生可访问的站点白名单，审核子资源域名，查看访问记录</p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-gray-200 mb-4">
        {tabBtn('sites', '站点白名单')}
        {tabBtn('pending', '待审核域名', pending.length)}
        {tabBtn('logs', '访问记录')}
        {tabBtn('cache', '缓存设置')}
      </div>

      {/* ===== Tab 1：站点白名单 ===== */}
      {tab === 'sites' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <span className="text-sm text-gray-500">共 {sites.length} 个站点</span>
            <button
              onClick={openCreate}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg flex items-center gap-1.5 transition-colors"
            >
              <i className="fa-solid fa-plus"></i>
              新增站点
            </button>
          </div>
          {loading ? (
            <div className="p-10 text-center text-gray-400">
              <i className="fa-solid fa-circle-notch fa-spin text-2xl"></i>
            </div>
          ) : sites.length === 0 ? (
            <div className="p-10 text-center text-gray-400 text-sm">还没有站点，点击右上角「新增站点」添加</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">图标</th>
                  <th className="px-4 py-2 text-left font-medium">名称</th>
                  <th className="px-4 py-2 text-left font-medium">URL</th>
                  <th className="px-4 py-2 text-center font-medium">域名数</th>
                  <th className="px-4 py-2 text-center font-medium">排序</th>
                  <th className="px-4 py-2 text-center font-medium">启用</th>
                  <th className="px-4 py-2 text-center font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sites.map(site => (
                  <tr key={site.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-xl w-12">
                      {site.icon && /^https?:\/\//i.test(site.icon) ? (
                        <img src={site.icon} alt="" className="w-6 h-6 object-contain" />
                      ) : (
                        <span>{site.icon || '🌐'}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-gray-800">{site.name}</td>
                    <td className="px-4 py-2.5 text-gray-500 font-mono text-xs max-w-[260px] truncate">{site.url}</td>
                    <td className="px-4 py-2.5 text-center text-gray-600">{(site.allowed_domains || []).length}</td>
                    <td className="px-4 py-2.5 text-center text-gray-600">{site.sort_order}</td>
                    <td className="px-4 py-2.5 text-center">
                      <button
                        onClick={() => handleToggleEnabled(site)}
                        className={`relative w-10 h-6 rounded-full transition-colors ${
                          site.enabled === 1 || site.enabled === true ? 'bg-green-500' : 'bg-gray-300'
                        }`}
                        title={site.enabled ? '点击停用' : '点击启用'}
                      >
                        <span
                          className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${
                            site.enabled === 1 || site.enabled === true ? 'left-5' : 'left-0.5'
                          }`}
                        ></span>
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-center whitespace-nowrap">
                      <button
                        onClick={() => openEdit(site)}
                        className="px-2.5 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded transition-colors"
                      >
                        <i className="fa-solid fa-pen mr-1"></i>编辑
                      </button>
                      <button
                        onClick={() => handleDelete(site)}
                        className="px-2.5 py-1 text-xs text-red-500 hover:bg-red-50 rounded transition-colors"
                      >
                        <i className="fa-solid fa-trash mr-1"></i>删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ===== Tab 2：待审核域名 ===== */}
      {tab === 'pending' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
            <span className="text-sm text-gray-500">
              学生访问时命中未白名单的域名会自动记录在这里，批准后并入对应站点
            </span>
            <div className="flex items-center gap-2">
              <select
                value={approveAllSiteId}
                onChange={e => setApproveAllSiteId(e.target.value ? Number(e.target.value) : '')}
                className="px-2 py-1.5 border border-gray-200 rounded text-xs max-w-[140px]"
              >
                <option value="">选择站点...</option>
                {sites.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <button
                onClick={handleApproveAll}
                disabled={pending.length === 0 || !approveAllSiteId}
                className="px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs rounded transition-colors"
                title="把全部待审核域名并入所选站点"
              >
                <i className="fa-solid fa-check-double mr-1"></i>一键批准
              </button>
              <button
                onClick={handleClearAll}
                disabled={pending.length === 0}
                className="px-3 py-1.5 bg-gray-500 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs rounded transition-colors"
                title="删除全部待审核记录（不并入任何站点）"
              >
                <i className="fa-solid fa-trash mr-1"></i>一键清空
              </button>
              <button
                onClick={loadPending}
                className="px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 rounded transition-colors"
              >
                <i className="fa-solid fa-rotate-right mr-1"></i>刷新
              </button>
            </div>
          </div>
          {pending.length === 0 ? (
            <div className="p-10 text-center text-gray-400 text-sm">暂无待审核的域名</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">域名</th>
                  <th className="px-4 py-2 text-center font-medium">命中次数</th>
                  <th className="px-4 py-2 text-left font-medium">关联站点</th>
                  <th className="px-4 py-2 text-left font-medium">首次出现</th>
                  <th className="px-4 py-2 text-left font-medium">最近出现</th>
                  <th className="px-4 py-2 text-center font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pending.map(row => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-800">{row.domain}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full">{row.hit_count}</span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 text-xs">{row.site_name || '未知'}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">{formatTime(row.first_seen_at)}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">{formatTime(row.last_seen_at)}</td>
                    <td className="px-4 py-2.5 text-center whitespace-nowrap">
                      <select
                        value={approveTarget[row.id] ?? (row.site_id || '')}
                        onChange={e => setApproveTarget(prev => ({ ...prev, [row.id]: e.target.value ? Number(e.target.value) : '' }))}
                        className="px-2 py-1 border border-gray-200 rounded text-xs mr-1.5 max-w-[140px]"
                      >
                        <option value="">选择站点...</option>
                        {sites.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleApprove(row)}
                        className="px-2.5 py-1 text-xs text-green-600 hover:bg-green-50 rounded transition-colors"
                      >
                        <i className="fa-solid fa-check mr-1"></i>批准
                      </button>
                      <button
                        onClick={() => handleIgnore(row)}
                        className="px-2.5 py-1 text-xs text-gray-400 hover:bg-gray-100 rounded transition-colors"
                      >
                        <i className="fa-solid fa-xmark mr-1"></i>忽略
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ===== Tab 3：访问记录 ===== */}
      {tab === 'logs' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3">
            <span className="text-sm text-gray-500">仅记录页面级访问（最近 100 条）</span>
            <select
              value={logClassId}
              onChange={e => {
                setLogClassId(e.target.value);
                loadLogs(e.target.value);
              }}
              className="px-2 py-1.5 border border-gray-200 rounded text-xs"
            >
              <option value="">全部班级</option>
              {classes.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button
              onClick={() => loadLogs(logClassId)}
              className="px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 rounded transition-colors"
            >
              <i className="fa-solid fa-rotate-right mr-1"></i>刷新
            </button>
          </div>
          {logs.length === 0 ? (
            <div className="p-10 text-center text-gray-400 text-sm">暂无访问记录</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">学生</th>
                  <th className="px-4 py-2 text-left font-medium">站点</th>
                  <th className="px-4 py-2 text-left font-medium">URL</th>
                  <th className="px-4 py-2 text-left font-medium">时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {logs.map(row => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-800 whitespace-nowrap">
                      {row.real_name || row.username || row.student_id}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 text-xs whitespace-nowrap">{row.site_name || `#${row.site_id}`}</td>
                    <td className="px-4 py-2.5 text-gray-500 font-mono text-xs max-w-[420px] truncate" title={row.url}>
                      {row.url}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs whitespace-nowrap">{formatTime(row.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ===== Tab 4：缓存设置 ===== */}
      {tab === 'cache' && (
        <div className="space-y-4">
          {/* 开关与上限 */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-bold text-gray-800 mb-1">静态资源磁盘缓存</h3>
            <p className="text-xs text-gray-500 mb-4">
              学生重复访问相同的图片/CSS/JS/字体/视频时直接由本机磁盘返回，不再消耗外网带宽
            </p>
            <div className="flex items-center gap-3 mb-4">
              <span className="text-sm text-gray-700">启用缓存</span>
              <button
                onClick={() => setCacheEnabled(v => !v)}
                className={`relative w-10 h-6 rounded-full transition-colors ${cacheEnabled ? 'bg-green-500' : 'bg-gray-300'}`}
              >
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${cacheEnabled ? 'left-5' : 'left-0.5'}`}></span>
              </button>
            </div>
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <span className="text-sm text-gray-700">容量上限</span>
              <input
                type="number"
                min={100}
                max={51200}
                value={cacheLimitInput}
                onChange={e => setCacheLimitInput(e.target.value)}
                className="w-28 px-3 py-1.5 border border-gray-200 rounded-lg text-sm"
              />
              <span className="text-sm text-gray-500">MB</span>
              <span className="text-xs text-gray-400">（范围 100MB–50GB，即 100–51200 MB）</span>
            </div>
            <button
              onClick={handleSaveCache}
              disabled={savingCache}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white text-sm rounded-lg transition-colors"
            >
              {savingCache ? '保存中...' : '保存设置'}
            </button>
          </div>

          {/* 当前用量 */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-bold text-gray-800 mb-3">当前用量</h3>
            {cacheSettings ? (
              <>
                <div className="flex items-center gap-6 mb-3 text-sm text-gray-700 flex-wrap">
                  <span>缓存文件：<b>{cacheSettings.file_count}</b> 个</span>
                  <span>已用空间：<b>{formatBytes(cacheSettings.total_bytes)}</b></span>
                  <span>上限：<b>{formatBytes(cacheSettings.limit_mb * 1024 * 1024)}</b></span>
                </div>
                <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      cacheSettings.total_bytes / (cacheSettings.limit_mb * 1024 * 1024) > 0.9 ? 'bg-red-500' : 'bg-sky-500'
                    }`}
                    style={{ width: `${Math.min(100, (cacheSettings.total_bytes / (cacheSettings.limit_mb * 1024 * 1024)) * 100).toFixed(1)}%` }}
                  ></div>
                </div>
                <p className="text-xs text-gray-400 mt-1.5">
                  已占上限 {((cacheSettings.total_bytes / (cacheSettings.limit_mb * 1024 * 1024)) * 100).toFixed(1)}%，超限时自动淘汰最久未访问的文件
                </p>
              </>
            ) : (
              <div className="text-gray-400 text-sm">加载中...</div>
            )}
          </div>

          {/* 缓存位置与清理 */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-bold text-gray-800 mb-3">缓存位置</h3>
            <input
              type="text"
              readOnly
              value={cacheSettings?.cache_dir || ''}
              onFocus={e => e.target.select()}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-mono text-gray-700 mb-2"
            />
            <p className="text-xs text-gray-500 mb-4">
              清理缓存可手工删除该目录，或点击下方清空按钮。删除后学生下次访问会重新从外网拉取，不影响正常使用。
            </p>
            <button
              onClick={handleClearCache}
              disabled={clearingCache}
              className="px-4 py-2 bg-red-500 hover:bg-red-600 disabled:bg-gray-300 text-white text-sm rounded-lg transition-colors"
            >
              <i className="fa-solid fa-trash-can mr-1.5"></i>
              {clearingCache ? '清空中...' : '清空缓存'}
            </button>
          </div>
        </div>
      )}

      {/* ===== 新增/编辑站点弹窗 ===== */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="font-bold text-gray-800">{form.id == null ? '新增站点' : '编辑站点'}</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <i className="fa-solid fa-xmark text-lg"></i>
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">站点名称 *</label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="如：抖音"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">站点 URL *</label>
                <input
                  value={form.url}
                  onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                  placeholder="https://www.example.com/"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:border-blue-400"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">图标（emoji 或图片URL）</label>
                  <input
                    value={form.icon}
                    onChange={e => setForm(f => ({ ...f, icon: e.target.value }))}
                    placeholder="🌐"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">排序（越小越靠前）</label>
                  <input
                    type="number"
                    value={form.sort_order}
                    onChange={e => setForm(f => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))}
                  className="w-4 h-4"
                />
                启用该站点（学生可见可访问）
              </label>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-gray-500">允许的域名白名单（每行一个）</label>
                  <button
                    onClick={handleFetchSiteInfo}
                    disabled={fetchingInfo}
                    className="px-3 py-1 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white text-xs rounded-lg transition-colors"
                  >
                    {fetchingInfo ? (
                      <><i className="fa-solid fa-circle-notch fa-spin mr-1"></i>抓取中...</>
                    ) : (
                      <><i className="fa-solid fa-wand-magic-sparkles mr-1"></i>自动获取子资源域名</>
                    )}
                  </button>
                </div>
                <textarea
                  value={form.domainsText}
                  onChange={e => setForm(f => ({ ...f, domainsText: e.target.value }))}
                  rows={8}
                  placeholder={'www.example.com\n.example.com（前导点通配，匹配所有子域）'}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono focus:outline-none focus:border-blue-400"
                ></textarea>
                {fetchedDomains && (
                  <p className="text-[11px] text-green-600 mt-1">
                    <i className="fa-solid fa-check mr-1"></i>
                    已从页面提取 {fetchedDomains.length} 个域名并合并：{fetchedDomains.slice(0, 5).join('、')}
                    {fetchedDomains.length > 5 ? ` 等` : ''}
                  </p>
                )}
                <p className="text-[11px] text-gray-400 mt-1">
                  留空保存时将自动填入主域名及其子域通配；学生访问到白名单外的域名会进入「待审核域名」
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
