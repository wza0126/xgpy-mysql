import React, { useCallback, useEffect, useRef, useState } from 'react';
import { backendClient } from '../../api/backendClient';
import { API_CONFIG } from '../../api/config';

// 代理上网（上网冲浪）：学生通过服务端中转访问教师白名单内的站点
// 状态 A：站点导航页（卡片网格）；状态 B：内嵌浏览器（iframe + 工具条）

interface ProxySite {
  id: number;
  name: string;
  url: string;
  icon: string | null;
  sort_order: number;
}

// 站点图标：emoji 直接显示，URL 用 img，兜底用地球图标
const SiteIcon: React.FC<{ icon: string | null; className?: string }> = ({ icon, className = '' }) => {
  if (icon && /^https?:\/\//i.test(icon)) {
    return <img src={icon} alt="" className={`object-contain ${className}`} />;
  }
  if (icon) {
    return <span className={className}>{icon}</span>;
  }
  return <i className={`fa-solid fa-globe ${className}`}></i>;
};

export const ProxyBrowser: React.FC = () => {
  const [view, setView] = useState<'home' | 'browser'>('home');
  const [sites, setSites] = useState<ProxySite[]>([]);
  const [canUseBrowser, setCanUseBrowser] = useState<boolean | null>(null);
  const [currentSite, setCurrentSite] = useState<ProxySite | null>(null);
  const [iframeSrc, setIframeSrc] = useState('');
  const [displayUrl, setDisplayUrl] = useState('');
  const [entering, setEntering] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  // 加载站点列表（接口在无权限时返回空数组 + can_use_browser:false，不报错）
  const loadSites = useCallback(async () => {
    try {
      const result = await backendClient.get('/api/student/proxy/sites');
      if (result.data) {
        setCanUseBrowser(!!result.data.can_use_browser);
        setSites(result.data.sites || []);
        return !!result.data.can_use_browser;
      }
    } catch (error) {
      console.error('加载上网站点失败:', error);
    }
    return canUseBrowser !== false;
  }, [canUseBrowser]);

  // 权限轮询：打开模块时 + 每 30 秒检查一次，被关闭则强制回导航页
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const result = await backendClient.get('/api/student/proxy/status');
        if (cancelled || !result.data) return;
        const can = !!result.data.can_use_browser;
        setCanUseBrowser(can);
        if (!can && viewRef.current === 'browser') {
          setView('home');
          setCurrentSite(null);
          setIframeSrc('');
          alert('老师已关闭你的上网权限');
        }
      } catch (error) {
        console.error('检查上网权限失败:', error);
      }
    };
    check();
    loadSites();
    const timer = window.setInterval(check, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 进入站点：先领令牌（接口同时写 wpt_{siteId} Cookie），再把 iframe 指到代理入口
  const openSite = async (site: ProxySite) => {
    if (entering) return;
    setEntering(true);
    try {
      const tokenResult = await backendClient.get('/api/student/proxy/token', { site_id: site.id });
      if (!tokenResult.data?.token) {
        alert(tokenResult.error || '获取上网凭证失败');
        return;
      }
      const u = new URL(site.url);
      const scheme = u.protocol.replace(':', '');
      const src = `${API_CONFIG.apiUrl}/api/web-proxy/p/${site.id}/${scheme}/${u.host}${u.pathname === '/' ? '/' : u.pathname}`;
      setCurrentSite(site);
      setIframeSrc(src);
      setDisplayUrl(site.url);
      setView('browser');
    } catch (error) {
      console.error('进入站点失败:', error);
      alert('进入站点失败，请稍后重试');
    } finally {
      setEntering(false);
    }
  };

  // iframe 加载后尝试读取当前地址更新地址栏（同源，跨域时静默忽略）
  const handleIframeLoad = () => {
    try {
      const loc = iframeRef.current?.contentWindow?.location;
      if (!loc) return;
      const m = loc.pathname.match(/^\/api\/web-proxy\/p\/\d+\/(https?)\/([^/]+)(\/.*)?$/);
      if (m) {
        setDisplayUrl(`${m[1]}://${m[2]}${m[3] || '/'}${loc.search || ''}`);
      }
    } catch {
      // 跨域等异常情况忽略，地址栏保持原样
    }
  };

  const goHome = () => {
    setView('home');
    setCurrentSite(null);
    setIframeSrc('');
    loadSites();
  };

  const reload = () => {
    if (iframeRef.current && iframeSrc) {
      // 直接重置 src 触发整页刷新（Cookie 仍在有效期内）
      const src = iframeSrc;
      setIframeSrc('');
      setTimeout(() => setIframeSrc(src), 0);
    }
  };

  // ===== 状态 B：内嵌浏览器 =====
  if (view === 'browser' && currentSite) {
    return (
      <div className="h-full flex flex-col bg-slate-900">
        {/* 顶部工具条 */}
        <div className="flex items-center gap-2 px-3 py-2 bg-slate-800 border-b border-slate-700 shrink-0">
          <button
            onClick={goHome}
            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs rounded flex items-center gap-1.5 transition-colors"
            title="返回站点导航"
          >
            <i className="fa-solid fa-house"></i>
            主页
          </button>
          <button
            onClick={reload}
            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs rounded flex items-center gap-1.5 transition-colors"
            title="刷新当前页面"
          >
            <i className="fa-solid fa-rotate-right"></i>
            刷新
          </button>
          <div className="flex-1 flex items-center gap-2 px-3 py-1.5 bg-slate-900/80 border border-slate-700 rounded min-w-0">
            <SiteIcon icon={currentSite.icon} className="text-cyan-400 text-sm w-4 h-4 shrink-0" />
            <span className="text-xs text-slate-300 truncate font-mono">{displayUrl || currentSite.url}</span>
          </div>
          <span className="text-[10px] text-slate-500 shrink-0 hidden md:block">
            <i className="fa-solid fa-shield-halved mr-1 text-cyan-500"></i>
            校园安全代理
          </span>
        </div>
        {/* 页面区域 */}
        {iframeSrc ? (
          <iframe
            ref={iframeRef}
            src={iframeSrc}
            onLoad={handleIframeLoad}
            className="flex-1 w-full border-0 bg-white"
            title={currentSite.name}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-400">
            <i className="fa-solid fa-circle-notch fa-spin text-2xl"></i>
          </div>
        )}
      </div>
    );
  }

  // ===== 状态 A：站点导航页 =====
  return (
    <div className="h-full overflow-y-auto bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-cyan-600 flex items-center justify-center text-white text-lg shadow-lg shadow-sky-500/30">
            <i className="fa-solid fa-earth-asia"></i>
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-100">上网冲浪</h2>
            <p className="text-xs text-slate-400">通过校园安全代理访问老师允许的站点</p>
          </div>
        </div>

        {canUseBrowser === null ? (
          <div className="flex items-center justify-center py-20 text-slate-400">
            <i className="fa-solid fa-circle-notch fa-spin text-2xl"></i>
          </div>
        ) : canUseBrowser === false ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-500">
            <i className="fa-solid fa-lock text-5xl mb-4 text-slate-600"></i>
            <p className="text-sm">老师尚未开通你的上网权限</p>
            <p className="text-xs text-slate-600 mt-1">开通后这里会显示可以访问的站点</p>
          </div>
        ) : sites.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-500">
            <i className="fa-solid fa-compass text-5xl mb-4 text-slate-600"></i>
            <p className="text-sm">暂时没有可访问的站点</p>
            <p className="text-xs text-slate-600 mt-1">等老师添加站点后就能上网啦</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {sites.map(site => (
              <button
                key={site.id}
                onClick={() => openSite(site)}
                disabled={entering}
                className="group flex flex-col items-center gap-3 p-5 bg-slate-800/70 hover:bg-slate-700/80 border border-slate-700 hover:border-cyan-500/50 rounded-2xl transition-all hover:shadow-lg hover:shadow-cyan-500/10 hover:-translate-y-0.5 disabled:opacity-50"
              >
                <div className="w-14 h-14 rounded-2xl bg-slate-900/80 flex items-center justify-center text-3xl text-cyan-400 overflow-hidden">
                  <SiteIcon icon={site.icon} className="text-3xl w-8 h-8" />
                </div>
                <span className="text-sm text-slate-200 font-medium truncate w-full text-center">{site.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
