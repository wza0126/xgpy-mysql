/**
 * 当前请求应当使用的鉴权 token —— 全前端唯一实现。
 *
 * 【为什么需要这个文件】
 * 教师「远程控制学生桌面」是把学生端桌面塞进同源 iframe（`#/desktop?proxy_token=...`）。
 * 同源 iframe 与主页面**共享 localStorage**，但 sessionStorage 是各自独立的。
 * 所以 iframe 里如果直接读 `localStorage.getItem('xgpy_token')`，拿到的是
 * **教师自己**的 token，而不是被查看学生的 —— 表现为「远程查看学生个人中心时
 * 战力/暴击/装备/荣誉/皮肤全空」，但走 backendClient 的数据（如萌宠）却正常。
 *
 * 【判定规则】
 * 只有在 iframe 中且 proxy_mode 为 true 时才用 proxy_token。
 * 不能只判 isProxyMode()：主页面同样能看到同源 iframe 写入的 proxy_mode=true，
 * 若主页面误用学生 token 去发请求，就会以学生身份操作教师的页面。
 */
export function isInIframe(): boolean {
  try {
    return window !== window.top;
  } catch {
    // 跨域访问 window.top 会抛异常 —— 说明必然在 iframe 内
    return true;
  }
}

export function isProxyMode(): boolean {
  return sessionStorage.getItem('proxy_mode') === 'true';
}

export function getAuthToken(): string | null {
  if (isInIframe() && isProxyMode()) {
    const proxyToken = sessionStorage.getItem('proxy_token');
    if (proxyToken) return proxyToken;
  }
  return localStorage.getItem('xgpy_token');
}

/** 构造带鉴权的请求头（直接 fetch 的场景用，例如 /api/student/* 那些非 backendClient 接口）。 */
export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getAuthToken();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(extra || {}),
  };
}
