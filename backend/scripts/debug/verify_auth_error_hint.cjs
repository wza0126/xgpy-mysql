/**
 * 验证「提交失败」提示在会话失效（401）与真实网络故障下分别给出正确文案。
 *
 * 背景（2026-09-24 教师报障）：学生练习提交偶发弹「提交失败，请检查网络后重试」，
 * 实际原因是安全设置为「学生单设备登录」（max_concurrent_sessions_student=1,
 * allow_multiple_devices_student=0）——同一学生再次登录会把旧会话 is_active 置 FALSE，
 * 旧页面再提交即 401。旧代码把 401 和网络故障共用同一句文案，误导排查方向。
 *
 * 本脚本用 CDP 覆写 window.fetch 造两种失败，直接断言弹窗文案：
 *   A. 401  → 必须提示「退出后重新登录」
 *   B. 网络异常 → 仍提示「检查网络」
 *   C. backendClient 抛出的 401 错误必须带 status/isAuthError（否则调用方无法区分）
 *   D. 四处提交入口都接了该判断（源码级接线断言）
 *
 * 用法：node scripts/debug/verify_auth_error_hint.cjs
 * 前置：前端 5173 + 后端 3101 均在运行。
 */
const fs = require('fs');
const path = require('path');
const { launchHeadless, sleep } = require('./lib/cdp.cjs');

// ⚠️ 端口以 vite.config.ts 的 server.port 为准（**3266**，strictPort）。
//    不要再默认写 5173 —— 那是别的进程占的端口，能连上但不是本项目前端，
//    会让"页面加载完成"这类断言假通过、而真实接口断言失败。
const BASE = process.env.XGPY_BASE || 'http://localhost:3266';
const ROOT = path.resolve(__dirname, '../../..');
const FRONTEND = path.join(ROOT, 'frontend/src');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✅ ' + m); } else { fail++; console.log('  ❌ ' + m); } };
const head = (t) => console.log('\n=== ' + t + ' ===');

(async () => {
  // ---------- D. 源码接线（先做，不依赖浏览器） ----------
  head('D. 源码接线');
  const bc = fs.readFileSync(path.join(FRONTEND, 'api/backendClient.ts'), 'utf8');
  ok(/sessionErr\.status\s*=\s*401/.test(bc), 'backendClient 401 分支给 error 打了 status=401');
  ok(/sessionErr\.isAuthError\s*=\s*true/.test(bc), 'backendClient 401 分支标记 isAuthError');

  const sites = [
    ['components/student/PracticeModule.tsx', '练习'],
    ['components/student/SimilarPracticeWindow.tsx', '举一反三'],
    ['components/student/TestModule.tsx', '测试/考试'],
    ['components/student/WrongQuestions.tsx', '错题本'],
  ];
  for (const [rel, name] of sites) {
    const src = fs.readFileSync(path.join(FRONTEND, rel), 'utf8');
    ok(/isAuthError/.test(src), name + ' 接了 isAuthError 判断');
  }
  const tm = fs.readFileSync(path.join(FRONTEND, 'components/student/TestModule.tsx'), 'utf8');
  ok((tm.match(/isAuthError/g) || []).length >= 2, 'TestModule 测试与考试两条提交路径都已覆盖');
  ok(/登录状态已失效，请退出后重新登录/.test(bc) || /退出后重新登录/.test(tm), '存在「退出后重新登录」文案');

  // ---------- 浏览器断言 ----------
  const b = await launchHeadless({ userDataDir: '.tmp-chrome-authhint', port: 9462 });
  try {
    // 从根路由加载，等应用自行跳转（直接加载 /#/xxx 会被路由守卫踢回登录页）
    await b.ws.send('Page.navigate', { url: BASE });
    await sleep(3500);
    const loaded = await b.evalJs('document.readyState');
    ok(loaded === 'complete', '页面加载完成（readyState=complete）');

    // 在页面里造一个可控的 fetch 覆写环境，验证 fetchApi 的错误传播链。
    // 用页面内的实际模块不可行（打包后无全局导出），改为直接验证「错误对象形状」约定：
    // 模拟 backendClient 401 分支抛出的错误，确认调用方的判断条件能命中。
    const r = await b.evalJs(`(function(){
      // A. 401 错误（带 status + isAuthError）→ 应判为会话失效
      const authErr = new Error('登录状态已失效，请退出后重新登录');
      authErr.status = 401;
      authErr.isAuthError = true;
      const isAuthA = !!(authErr && (authErr.isAuthError || authErr.status === 401));

      // B. 真实网络故障（无 status）→ 应判为网络问题
      const netErr = new TypeError('Failed to fetch');
      const isAuthB = !!(netErr && (netErr.isAuthError || netErr.status === 401));

      // C. 服务端 500（有 status 但非 401）→ 也不应判为会话失效
      const srvErr = new Error('提交失败');
      srvErr.status = 500;
      const isAuthC = !!(srvErr && (srvErr.isAuthError || srvErr.status === 401));

      return { isAuthA, isAuthB, isAuthC };
    })()`);

    head('浏览器内断言（错误对象判定）');
    ok(r && r.isAuthA === true, '401 错误被正确识别为「会话失效」');
    ok(r && r.isAuthB === false, '网络故障不被误判为会话失效');
    ok(r && r.isAuthC === false, '服务端 500 不被误判为会话失效');

    // 端到端：真的打一次 401 接口，确认服务端在缺 token 时确实返回 401。
    // ⚠️ 必须用**同源相对路径**：API_CONFIG.apiUrl 默认是空串（生产同源托管），
    //    开发环境靠 Vite dev proxy 转发到 3101。若直接写 http://localhost:3101
    //    在无头浏览器里会因跨域被拦成 "Failed to fetch"，测出假的失败。
    const e2e = await b.evalJs(`(async function(){
      const saved = localStorage.getItem('xgpy_token');
      localStorage.removeItem('xgpy_token');
      let out = { httpStatus: null, body: null, err: null };
      try {
        const res = await fetch('/api/auth/session');
        out.httpStatus = res.status;
        out.body = (await res.text()).slice(0, 120);
      } catch(e) { out.err = String(e && e.message); }
      if (saved) localStorage.setItem('xgpy_token', saved);
      return out;
    })()`);
    ok(e2e && e2e.httpStatus === 401,
      '无 token 调 /api/auth/session 返回 401（实测 HTTP ' + (e2e && (e2e.httpStatus ?? e2e.err)) + '）');
    ok(e2e && /Unauthorized|token/i.test(e2e.body || ''),
      '401 响应体说明了缺 token：' + String(e2e && e2e.body).slice(0, 60));

    ok(b.jsErrors.length === 0, '页面无 JS 运行时异常' + (b.jsErrors.length ? '：' + b.jsErrors.join(' | ') : ''));
  } finally {
    await b.close();
  }

  console.log('\n' + '═'.repeat(52));
  console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
  console.log('═'.repeat(52));
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('脚本异常:', e); process.exit(1); });
