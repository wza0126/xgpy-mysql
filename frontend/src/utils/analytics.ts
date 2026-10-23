/**
 * 百度统计（hm.js）按需加载。
 *
 * ⛔ 只给「登录页」和「教师后台」用：学生端是机房内网高频访问，既没必要也不该上报。
 * ⛔ 幂等：SPA 里来回切页会反复执行 effect，用模块级 flag + script id 双重防重复。
 * ⛔ 离线直接跳过：机房断网时挂一个必然失败的请求，控制台会一片红，还拖慢首屏。
 *    （下次联网再进页面会自动补上）
 */

const SCRIPT_ID = 'xgpy-baidu-hm';
const HM_SRC = 'https://hm.baidu.com/hm.js?34690ee0de044d8f20858d564a03bc53';

interface HmtQueue extends Array<unknown> {
  push: (...args: unknown[]) => number;
}

declare global {
  interface Window {
    _hmt?: HmtQueue;
  }
}

let loading = false;

/** 加载 hm.js（重复调用无副作用） */
export function loadBaiduAnalytics(): void {
  if (typeof window === 'undefined') return;
  // hm.js 自己也会读这个队列：脚本还没下来之前推的数据会先排队
  window._hmt = window._hmt || ([] as unknown as HmtQueue);
  if (document.getElementById(SCRIPT_ID) || loading) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

  loading = true;
  const hm = document.createElement('script');
  hm.id = SCRIPT_ID;
  hm.async = true;
  hm.src = HM_SRC;
  hm.onload = () => { loading = false; };
  // 被广告拦截 / 断网 / DNS 失败：静默放弃，绝不能影响页面本身
  hm.onerror = () => { loading = false; };
  document.head.appendChild(hm);
}

/** SPA 内部切页补记一次 PV（hm.js 只统计首次页面加载，路由跳转它看不见） */
export function trackPageview(path: string): void {
  if (typeof window === 'undefined') return;
  window._hmt = window._hmt || ([] as unknown as HmtQueue);
  window._hmt.push(['_trackPageview', path]);
}
