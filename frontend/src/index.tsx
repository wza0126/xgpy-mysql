import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/index.css';

// 兼容旧版公开点名分享链接：/share/roll-call/<token> 自动跳转到正确的 hash 路由
// （应用使用 HashRouter，旧链接没有 #/ 前缀会被当作未登录首页处理，表现为"公开页要求登录"）
(function redirectLegacyShareUrl() {
  const m = window.location.pathname.match(/^\/share\/roll-call\/([\w-]+)\/?$/);
  if (m) {
    window.location.replace(`/#/roll-call-public?token=${m[1]}`);
  }
})();

// 拦截 localStorage 清除操作，帮助排查登录态丢失问题
(function interceptLocalStorage() {
  const originalRemoveItem = localStorage.removeItem.bind(localStorage);
  localStorage.removeItem = function(key: string) {
    if (key === 'xgpy_token' || key === 'xgpy_user') {
      const stack = new Error().stack || '无栈信息';
      console.error('[LOCALSTORAGE INTERCEPT] 清除登录态键:', key, '\n调用栈:', stack);
      // 记录到 sessionStorage，页面刷新后仍可查看
      try {
        const logs = JSON.parse(sessionStorage.getItem('ls_intercept_logs') || '[]');
        logs.push({ time: new Date().toISOString(), key, stack: stack.split('\n').slice(0, 8).join('\n') });
        sessionStorage.setItem('ls_intercept_logs', JSON.stringify(logs.slice(-10)));
      } catch {}
    }
    return originalRemoveItem(key);
  };
})();

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
