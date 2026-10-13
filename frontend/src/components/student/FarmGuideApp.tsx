import React from 'react';

/**
 * 代码农场 · 学生使用手册窗口
 * ============================================================
 * 手册是一份**自包含的单文件 HTML**（讲解农活 API 与生长规则，并带一个可交互试跑区）：
 *   · 老师在「教师后台 → 代码农场 → 学生手册」上传后，学生打开的就是老师上传的那份；
 *   · 老师没上传时，用**随包内置**的默认手册（/code-farm-guide.html，随前端一起发布）。
 *
 * ⛔ 用 iframe 的 src（而不是 srcDoc 内联）：手册约 90KB 且内含自带的解释器脚本，
 *    走 URL 才能被浏览器缓存；老师替换手册后学生刷新即见新版本，不必重新发布前端。
 * ⛔ sandbox 只给 allow-scripts：手册是纯离线自包含页面（不读写 localStorage、不发请求），
 *    不给 allow-same-origin 也照样能跑，同时避免同源脚本能摸到主页面。
 */
export const FarmGuideApp: React.FC<{ url: string }> = ({ url }) => (
  <div className="h-full bg-white">
    <iframe
      title="代码农场 · 学生手册"
      src={url}
      className="h-full w-full border-0"
      sandbox="allow-scripts allow-forms"
    />
  </div>
);

export default FarmGuideApp;
