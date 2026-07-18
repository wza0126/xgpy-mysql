import { useState, useEffect } from 'react';
import { API_CONFIG } from '../api/config';

// 站点公共配置（site_title / site_subtitle），来源于 /api/public/site-config
// 模块级缓存避免每个页面重复请求；保存站点设置后可通过 applySiteConfig 立即生效
export interface SiteConfig {
  site_title?: string;
  site_subtitle?: string;
}

let cache: SiteConfig | null = null;
let inflight: Promise<SiteConfig> | null = null;

async function loadSiteConfig(): Promise<SiteConfig> {
  if (!inflight) {
    inflight = (async () => {
      const response = await fetch(`${API_CONFIG.apiUrl}/api/public/site-config`);
      const result = await response.json();
      const cfg: SiteConfig = {};
      (result?.data || []).forEach((item: any) => {
        const key = item.key || item.config_key;
        let val = item.value;
        if (typeof val === 'string') {
          try { val = JSON.parse(val); } catch { /* keep as-is */ }
        }
        if (val && typeof val === 'object' && val.value !== undefined) val = val.value;
        if ((key === 'site_title' || key === 'site_subtitle') && val) {
          cfg[key] = String(val);
        }
      });
      return cfg;
    })().finally(() => { inflight = null; });
  }
  return inflight;
}

export function useSiteConfig(): SiteConfig {
  const [config, setConfig] = useState<SiteConfig>(cache || {});

  useEffect(() => {
    if (cache) {
      setConfig(cache);
      return;
    }
    let cancelled = false;
    loadSiteConfig()
      .then((cfg) => {
        cache = cfg;
        if (!cancelled) setConfig(cfg);
      })
      .catch((err) => console.error('获取站点配置失败:', err));
    return () => { cancelled = true; };
  }, []);

  return config;
}

// 站点设置保存成功后调用：更新缓存并立即同步浏览器标签页标题
export function applySiteConfig(cfg: Partial<SiteConfig>): void {
  cache = { ...(cache || {}), ...cfg };
  if (cfg.site_title) {
    document.title = cfg.site_title;
  }
}
