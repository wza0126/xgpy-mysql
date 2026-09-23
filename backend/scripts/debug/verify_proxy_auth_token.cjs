/**
 * 验证：教师「远程控制学生桌面 → 查看学生个人中心」时数据能正确取到
 *      （2026-09-23 修复）
 *
 * 被修复的 bug：
 *   远程查看 = 把学生端桌面塞进**同源 iframe**（`#/desktop?proxy_token=...`）。
 *   同源 iframe 与主页面共享 localStorage，所以 iframe 里直接读
 *   `localStorage.getItem('xgpy_token')` 拿到的是**教师自己**的 token，而不是被查看学生的。
 *   表现为「战力、暴击、装备、荣誉、皮肤…数据不显示或不完整」，
 *   而走 backendClient 的数据（如萌宠）却正常 —— 因为 backendClient 早就处理了 proxy_token。
 *
 * 修复方式：把「当前有效 token」抽成 frontend/src/utils/authToken.ts 的 getAuthToken()，
 * 所有**绕过 backendClient 的裸 fetch**一律改用它。
 *
 * 本脚本分两层（不需要数据库 / 服务器，秒级可跑）：
 *   A. 判定规则 —— tsc 进程内编译 authToken.ts，用桩造出「主页面 / 同源 iframe / 跨域 iframe」
 *      三种环境，断言取到的 token。
 *   B. 源码接线 —— 远程桌面能看到的学生侧组件都不得再直接读 localStorage 的 token；
 *      同时确认会话引导（useAuth）等**教师侧**调用点没被误改。
 *
 * 用法：
 *   node scripts/debug/verify_proxy_auth_token.cjs
 */
const fs = require('fs');
const path = require('path');

const BACKEND = path.join(__dirname, '..', '..');
const FRONTEND = path.join(BACKEND, '..', 'frontend');
const SRC = path.join(FRONTEND, 'src');
const UTIL_REL = 'src/utils/authToken.ts';

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; failures.push(name); console.log('  ❌ ' + name + (detail ? '  ' + detail : '')); }
}
function section(t) { console.log('\n【' + t + '】'); }

// ── A. 编译真实代码并用桩环境断言判定规则 ────────────────────────────────────
function loadUtil() {
  const tsPath = path.join(FRONTEND, 'node_modules', 'typescript');
  if (!fs.existsSync(tsPath)) {
    console.error('找不到 typescript：' + tsPath + '\n请先在 frontend 下 npm install');
    process.exit(2);
  }
  const ts = require(tsPath);
  const src = fs.readFileSync(path.join(FRONTEND, UTIL_REL), 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, require);
  return mod.exports;
}
const { getAuthToken, isInIframe, isProxyMode, authHeaders } = loadUtil();

/** 造一个浏览器环境：inIframe=true 时让 window.top 指向别的对象；crossOrigin=true 时访问 top 抛错 */
function env({ inIframe = false, crossOrigin = false, localStorageToken = null, proxyMode = false, proxyToken = null } = {}) {
  const store = (obj) => ({
    getItem: (k) => (k in obj ? obj[k] : null),
    setItem: (k, v) => { obj[k] = String(v); },
    removeItem: (k) => { delete obj[k]; },
  });
  const ls = {};
  const ss = {};
  if (localStorageToken !== null) ls['xgpy_token'] = localStorageToken;
  if (proxyMode) ss['proxy_mode'] = 'true';
  if (proxyToken !== null) ss['proxy_token'] = proxyToken;

  const topWin = {};
  const win = {};
  if (inIframe) {
    if (crossOrigin) {
      Object.defineProperty(win, 'top', { get() { throw new Error('SecurityError: cross-origin'); } });
    } else {
      win.top = topWin;
    }
  } else {
    win.top = win; // 主页面：window === window.top
  }
  globalThis.window = win;
  globalThis.localStorage = store(ls);
  globalThis.sessionStorage = store(ss);
}

section('A1 主页面（非 iframe）：用本地登录 token');
{
  env({ inIframe: false, localStorageToken: 'TEACHER' });
  check('isInIframe = false', isInIframe() === false);
  check('取到教师自己的 token', getAuthToken() === 'TEACHER', String(getAuthToken()));
}

section('A2 同源 iframe + proxy_mode：必须用 proxy_token（本次修复点）');
{
  env({ inIframe: true, localStorageToken: 'TEACHER', proxyMode: true, proxyToken: 'STUDENT' });
  check('isInIframe = true', isInIframe() === true);
  check('isProxyMode = true', isProxyMode() === true);
  check('取到被查看学生的 token 而非教师的', getAuthToken() === 'STUDENT', String(getAuthToken()));
}

section('A3 iframe 但非代理模式：仍用本地 token');
{
  env({ inIframe: true, localStorageToken: 'TEACHER' });
  check('proxy_mode 缺失 → 不误用 proxy_token', getAuthToken() === 'TEACHER', String(getAuthToken()));
}

section('A4 代理模式但 proxy_token 缺失：回退本地 token（不返回空）');
{
  env({ inIframe: true, localStorageToken: 'TEACHER', proxyMode: true });
  check('回退到 localStorage', getAuthToken() === 'TEACHER', String(getAuthToken()));
}

section('A5 跨域 iframe（访问 window.top 抛异常）：也算 iframe 内');
{
  env({ inIframe: true, crossOrigin: true, localStorageToken: 'TEACHER', proxyMode: true, proxyToken: 'STUDENT' });
  check('异常被吞掉且判定为 iframe', isInIframe() === true);
  check('取到学生 token', getAuthToken() === 'STUDENT', String(getAuthToken()));
}

section('A6 authHeaders：直接 fetch 场景拼装请求头');
{
  env({ inIframe: true, localStorageToken: 'TEACHER', proxyMode: true, proxyToken: 'STUDENT' });
  const h = authHeaders({ 'Content-Type': 'application/json' });
  check('带 Bearer 学生 token', h.Authorization === 'Bearer STUDENT', h.Authorization);
  check('附加头被保留', h['Content-Type'] === 'application/json');
  env({ inIframe: false });
  const h2 = authHeaders();
  check('无 token 时不产生 Authorization 头', !('Authorization' in h2), JSON.stringify(h2));
}

// ── B. 源码接线 ──────────────────────────────────────────────────────────────
const REL = [
  ['hooks/useGameSystem.ts', '战力/暴击/装备/荣誉'],
  ['components/student/ProfileModule.tsx', '个人中心'],
  ['components/student/SkinManager.tsx', '皮肤'],
  ['components/student/TaskCenter.tsx', '任务中心'],
  ['components/student/NotificationCenter.tsx', '通知中心'],
  ['components/student/pk-battle/PKBattle.tsx', '宠物对战'],
  ['pages/Desktop.tsx', '桌面背景 + 窗口皮肤'],
];

section('B1 远程桌面可见的学生侧组件：已统一走 getAuthToken');
{
  // backendClient 是这套机制的源头，单独判：取 token 必须走 getAuthToken，
  // 允许保留**唯一一处**诊断性读取（tokenSource 标签，不参与取 token）
  const bc = fs.readFileSync(path.join(SRC, 'api/backendClient.ts'), 'utf8');
  check('backendClient 取 token 走 getAuthToken', bc.includes('const token = getAuthToken();'));
  check('backendClient 从 utils/authToken 引入', bc.includes("from '../utils/authToken'"));
  const bcLines = bc.split('\n').filter((l) => l.includes("localStorage.getItem('xgpy_token')"));
  check('backendClient 仅剩 1 处诊断性读取（tokenSource）',
    bcLines.length === 1 && bcLines[0].includes('tokenSource'), bcLines.join(' | ') || '无');

  for (const [rel, label] of REL) {
    const p = path.join(SRC, rel);
    if (!fs.existsSync(p)) { check(`${label}（${rel}）存在`, false); continue; }
    const src = fs.readFileSync(p, 'utf8');
    const usesLocal = src.includes("localStorage.getItem('xgpy_token')");
    const usesHelper = src.includes('getAuthToken');
    check(`${label} 使用 getAuthToken`, usesHelper && !usesLocal,
      usesHelper ? (usesLocal ? '仍残留直接读 localStorage' : 'ok') : '未引入');
  }
}

section('B2 学生端整体：不得再有裸读 localStorage 的 token');
{
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name)) {
        const src = fs.readFileSync(p, 'utf8');
        // 只算「真的拿来当 token 用」的写法，放过注释/纯标签
        for (const line of src.split('\n')) {
          if (line.includes("localStorage.getItem('xgpy_token')") && /Bearer|const token|Authorization/.test(line)) {
            hits.push(path.relative(SRC, p) + ' → ' + line.trim());
          }
        }
      }
    }
  };
  walk(path.join(SRC, 'components', 'student'));
  check('components/student/** 无裸读 token', hits.length === 0, hits.join(' | ') || 'ok');
  const desktop = fs.readFileSync(path.join(SRC, 'pages/Desktop.tsx'), 'utf8');
  check('桌面背景/皮肤取数已改', !desktop.includes("localStorage.getItem('xgpy_token')") && desktop.includes('getAuthToken'));
}

section('B3 不该被误改的教师侧调用点');
{
  const auth = fs.readFileSync(path.join(SRC, 'hooks/useAuth.ts'), 'utf8');
  check('useAuth（会话引导）保持直接读 localStorage', auth.includes("localStorage.getItem('xgpy_token')"));
  const rollcall = fs.readFileSync(path.join(SRC, 'hooks/useRollCall.ts'), 'utf8');
  check('useRollCall（教师点名）保持不变', rollcall.includes("localStorage.getItem('xgpy_token')"));
}

section('B4 装备数据的真实来源（说明为何「装备」也随之修好）');
{
  const pm = fs.readFileSync(path.join(SRC, 'components/student/ProfileModule.tsx'), 'utf8');
  check('装备栏渲染 equipment_list', pm.includes('equipment_list'));
  check('equipment_list 来自 gameStats（→ /api/student/stats）', pm.includes('gameSystem.gameStats'));
  const gs = fs.readFileSync(path.join(SRC, 'hooks/useGameSystem.ts'), 'utf8');
  check('useGameSystem 三个接口都走 getAuthToken', (gs.match(/const token = getAuthToken\(\);/g) || []).length === 3,
    String((gs.match(/const token = getAuthToken\(\);/g) || []).length));
  check('战力/暴击取 /api/student/stats', gs.includes('/api/student/stats'));
  check('荣誉取 /api/student/honors', gs.includes('/api/student/honors'));
  check('buff 取 /api/student/buffs', gs.includes('/api/student/buffs'));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n────────────────────────────────────────');
console.log(`结果：${pass} 通过 / ${fail} 失败`);
if (fail) {
  console.log('失败项：');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
console.log('全部通过 ✅');
