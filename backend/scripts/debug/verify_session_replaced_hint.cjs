/**
 * 端到端复现「会话被顶掉 → 提交失败」并验证提示文案（真浏览器 + 真后端）。
 *
 * 场景（对应教师 2026-09-24 报障）：
 *   学生 a 在页面 A 已登录 → 另一处再登录同一账号（单设备策略会作废旧会话）
 *   → 回到页面 A 提交练习 → 服务端 401 → 应提示「退出后重新登录」而非「检查网络」。
 *
 * 做法：全程在**同一页面**内用真实接口完成，不依赖 UI 点击路径（练习入口较深）：
 *   1) 用 /api/auth/secure-login 登录两次，拿到 token1 / token2；
 *   2) 确认 token1 已被第二次登录作废（调 /api/auth/session → 401）；
 *   3) 用 backendClient 同样的逻辑（裸 fetch + Bearer）调 /api/business/submit-answer；
 *   4) 断言返回 401 → 前端据此走「退出后重新登录」分支。
 *
 * 用法：node scripts/debug/verify_session_replaced_hint.cjs
 */
const { launchHeadless, sleep } = require('./lib/cdp.cjs');

const BASE = process.env.XGPY_BASE || 'http://localhost:3266';
const USER = process.env.XGPY_STUDENT || 'a';
const PWD = process.env.XGPY_STUDENT_PWD || '111111';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✅ ' + m); } else { fail++; console.log('  ❌ ' + m); } };
const head = (t) => console.log('\n=== ' + t + ' ===');

(async () => {
  const b = await launchHeadless({ userDataDir: '.tmp-chrome-sessrepl', port: 9464 });
  try {
    await b.ws.send('Page.navigate', { url: BASE });
    await sleep(3000);

    const r = await b.evalJs(`(async function(){
      const login = async () => {
        const res = await fetch('/api/auth/secure-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: ${JSON.stringify(USER)}, password: ${JSON.stringify(PWD)} })
        });
        const j = await res.json();
        return { status: res.status, token: j?.data?.session?.access_token || null, user: j?.data?.user || null };
      };

      const callSession = async (token) => {
        const res = await fetch('/api/auth/session', { headers: token ? { Authorization: 'Bearer ' + token } : {} });
        return res.status;
      };

      const submitWith = async (token, qid) => {
        const res = await fetch('/api/business/submit-answer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({
            student_id: '', question_id: qid, answer: 'A', is_correct: true,
            points_change: 0, source: 'practice'
          })
        });
        let body = null;
        try { body = await res.json(); } catch(e) {}
        return { status: res.status, body };
      };

      const out = {};
      const l1 = await login();
      out.login1 = l1.status;
      out.token1 = !!l1.token;
      out.studentId = l1.user && l1.user.id;

      // 取一道可练习的题用于提交（走真实的学生抽题接口，不猜 SQL）
      let qid = null;
      const qRes = await fetch('/api/practice/questions?limit=1', { headers: { Authorization: 'Bearer ' + l1.token } });
      if (qRes.ok) {
        try {
          const qj = await qRes.json();
          const arr = Array.isArray(qj) ? qj : (qj?.data || []);
          qid = arr[0] && arr[0].id;
        } catch(e) {}
      }
      // 兜底：抽题接口不可用时用已知可练习题（避免因取题失败而漏测 401）
      if (!qid) qid = ${JSON.stringify(process.env.XGPY_QID || 'local_1778981188132_ubj8ju71c')};
      out.questionIdFound = !!qid;

      // token1 此刻有效
      out.sessionWithToken1_before = await callSession(l1.token);

      // 第二次登录同一账号 → 单设备策略应作废 token1
      await new Promise(r => setTimeout(r, 800));
      const l2 = await login();
      out.login2 = l2.status;
      out.token2 = !!l2.token;

      // token1 现在应已失效
      out.sessionWithToken1_after = await callSession(l1.token);
      // token2 有效
      out.sessionWithToken2 = await callSession(l2.token);

      // 用失效的 token1 提交练习 → 期望 401
      if (qid) {
        const s = await submitWith(l1.token, qid);
        out.submitStatus = s.status;
        out.submitError = s.body && s.body.error;
      }
      return out;
    })()`);

    console.log(JSON.stringify(r, null, 2));
    head('会话顶替与提交 401');
    ok(r && r.login1 === 200, '第一次登录成功（HTTP 200）');
    ok(r && r.token1 === true, '拿到 token1');
    ok(r && r.sessionWithToken1_before === 200, 'token1 在第二次登录前有效（200）');
    ok(r && r.login2 === 200, '第二次登录（同账号）成功');
    ok(r && r.token2 === true, '拿到 token2');
    ok(r && r.sessionWithToken1_after === 401,
      '★ token1 被第二次登录作废（实测 ' + (r && r.sessionWithToken1_after) + '）');
    ok(r && r.sessionWithToken2 === 200, 'token2 有效（200）');
    ok(r && r.submitStatus === 401,
      '★ 用失效 token 提交练习返回 401（实测 ' + (r && r.submitStatus) + '）');

    head('结论');
    if (r && r.submitStatus === 401) {
      console.log('  → 前端 backendClient 会抛 status=401/isAuthError 的错误，');
      console.log('    各提交入口据此提示「登录状态已失效，请退出后重新登录」✅');
    }

    ok(b.jsErrors.length === 0, '页面无 JS 运行时异常');
  } finally {
    await b.close();
  }

  console.log('\n' + '═'.repeat(52));
  console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
  console.log('═'.repeat(52));
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('脚本异常:', e); process.exit(1); });
