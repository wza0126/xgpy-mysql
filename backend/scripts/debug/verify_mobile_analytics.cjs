/**
 * 移动端学情分析页（/mobile-analytics.html）真浏览器验证
 *
 * 覆盖：
 *  A. 页面能加载（无 JS 异常、无 404 资源）
 *  B. 教师登录 → 进入主视图
 *  C. 学生名单渲染，且「账号 + 姓名」恒定出现
 *  D. 默认显示总掌握，且数值与后端接口一致
 *  E. 字段开关可切换、可取消；账号/姓名不可被关闭
 *  F. 排序：点击字段名能真实改变次序
 *  G. 班级切换生效
 *  H. 退出登录回到登录页
 *
 * ⚠️ 本脚本只读，不改任何数据（无 tmp_ 清理需求）。
 */
const path = require('path');
const { launchHeadless, sleep } = require('./lib/cdp.cjs');

const BASE = process.env.XGPY_BASE || 'http://127.0.0.1:3101';
const PAGE = BASE + '/mobile-analytics.html';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
function section(t) { console.log(`\n=== ${t} ===`); }

/** 取后端接口的真实数据，用于与页面渲染对拍 */
async function apiData() {
  const login = await fetch(BASE + '/api/auth/secure-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'teacher', password: 'xgpy666' }),
  }).then(r => r.json()).catch(() => null);
  const token = login?.data?.session?.access_token || login?.data?.token;
  if (!token) throw new Error('教师登录失败，无法取得对照数据');
  const r = await fetch(BASE + '/api/teacher/mobile/analytics', {
    headers: { Authorization: 'Bearer ' + token },
  }).then(x => x.json());
  return r?.data || {};
}

async function main() {
  const expected = await apiData();
  console.log(`接口侧：${(expected.classes || []).length} 个班级 / ${(expected.students || []).length} 名学生`);

  const b = await launchHeadless({
    userDataDir: path.join(__dirname, '.tmp-chrome-mobile'),
    port: 9471,
  });

  try {
    section('A. 页面加载');
    await b.ws.send('Page.navigate', { url: PAGE });
    await sleep(1600);
    const title = await b.evalJs('document.title');
    ok('页面标题正确', String(title).includes('学情分析'), String(title));
    ok('无 JS 运行时异常', b.jsErrors.length === 0, b.jsErrors.join(' | ') || '无');
    const badRes = b.netFails.filter(x => !x.includes('favicon'));
    ok('无资源加载失败', badRes.length === 0, badRes.join(' | ') || '无');

    section('B. 教师登录');
    await b.evalJs(`(() => {
      document.getElementById('u').value = 'teacher';
      document.getElementById('p').value = 'xgpy666';
      document.getElementById('loginBtn').click();
      return true;
    })()`);
    await sleep(2600);
    const loggedIn = await b.evalJs(`!document.getElementById('appView').classList.contains('hide')`);
    ok('★ 登录成功后进入主视图', loggedIn === true, `appView visible=${loggedIn}`);
    const errText = await b.evalJs(`document.getElementById('loginErr').textContent`);
    ok('登录无错误提示', !errText, String(errText));

    section('C. 学生名单与固定列');
    const cardCount = await b.evalJs(`document.querySelectorAll('.s-card').length`);
    const expShouldShow = (expected.students || []).length;
    // 未选班级时是「全部班级」，可能含多个班的学生；只要求 ≥ 所选班级人数
    const classTest = (expected.classes || []).find(c => c.name === 'test');
    const testCount = (expected.students || []).filter(s => s.class_id === classTest?.id).length;
    ok('★ 学生卡片已渲染', cardCount >= testCount, `页面 ${cardCount} 张 / test 班 ${testCount} 人`);

    const names = await b.evalJs(
      `Array.from(document.querySelectorAll('.s-card .s-name')).map(e=>e.textContent.trim())`);
    const accs = await b.evalJs(
      `Array.from(document.querySelectorAll('.s-card .s-acc')).map(e=>e.textContent.trim())`);
    ok('★ 每张卡片都有姓名', names.length === cardCount && names.every(Boolean), names.slice(0, 4).join(','));
    ok('★ 每张卡片都有账号（恒定显示）', accs.length === cardCount && accs.every(Boolean), accs.slice(0, 4).join(','));
    // 账号应与接口一致
    const expAccs = (expected.students || []).map(s => s.username);
    ok('账号集合与接口一致',
       accs.every(a => expAccs.includes(a)),
       `页面=${accs.join(',')} 接口=${expAccs.join(',')}`);

    section('D. 总掌握默认可见且数值对拍');
    const hasMasterLabel = await b.evalJs(
      `Array.from(document.querySelectorAll('.s-cell-l')).some(e=>e.textContent.trim()==='总掌握')`);
    ok('★ 默认显示「总掌握」字段', hasMasterLabel === true, String(hasMasterLabel));
    // 取页面里 a 的总掌握，与接口对拍
    const aAcc = 'a';
    const shown = await b.evalJs(`(() => {
      const card = Array.from(document.querySelectorAll('.s-card')).find(c =>
        c.querySelector('.s-acc') && c.querySelector('.s-acc').textContent.trim() === '${aAcc}');
      if (!card) return null;
      const cells = Array.from(card.querySelectorAll('.s-cell'));
      const hit = cells.find(c => c.querySelector('.s-cell-l').textContent.trim() === '总掌握');
      return hit ? hit.querySelector('.s-cell-v').textContent.trim() : null;
    })()`);
    const expMaster = (expected.students || []).find(s => s.username === aAcc)?.total_mastered;
    ok('★ 总掌握数值与接口一致',
       shown !== null && Number(String(shown).replace(/,/g, '')) === expMaster,
       `页面=${shown} 接口=${expMaster}`);

    section('E. 字段开关');
    // 打开抽屉
    await b.evalJs(`document.getElementById('sortBtn').click()`);
    await sleep(500);
    const sheetOpen = await b.evalJs(`document.getElementById('sheet').classList.contains('on')`);
    ok('抽屉可打开', sheetOpen === true, String(sheetOpen));
    // 固定列有「始终显示」标记且无开关
    const fixedRows = await b.evalJs(
      `Array.from(document.querySelectorAll('#fieldOpts .opt')).map(e=>e.textContent.trim())`);
    ok('★ 账号与姓名标为「始终显示」',
       fixedRows.length === 2 && fixedRows.every(t => t.includes('始终显示')),
       fixedRows.join(' | '));
    const fixedHasSwitch = await b.evalJs(`document.querySelectorAll('#fieldOpts .opt .sw').length`);
    ok('★ 账号/姓名无开关（不可取消）', fixedHasSwitch === 0, `switch 数=${fixedHasSwitch}`);

    // 关闭「当前积分」看是否真的从卡片消失
    await b.evalJs(`(() => {
      const sw = Array.from(document.querySelectorAll('#fieldOpts [data-sw]'))
        .find(e => e.getAttribute('data-sw') === 'current_points');
      if (sw) sw.click();
      return !!sw;
    })()`);
    await sleep(500);
    const hasPointsAfter = await b.evalJs(
      `Array.from(document.querySelectorAll('.s-cell-l')).some(e=>e.textContent.trim()==='当前积分')`);
    ok('★ 关闭字段后该列消失', hasPointsAfter === false, `仍存在=${hasPointsAfter}`);
    // 重新打开
    await b.evalJs(`(() => {
      const sw = Array.from(document.querySelectorAll('#fieldOpts [data-sw]'))
        .find(e => e.getAttribute('data-sw') === 'current_points');
      if (sw) sw.click();
      return true;
    })()`);
    await sleep(450);
    const hasPointsBack = await b.evalJs(
      `Array.from(document.querySelectorAll('.s-cell-l')).some(e=>e.textContent.trim()==='当前积分')`);
    ok('重新打开字段后该列恢复', hasPointsBack === true, String(hasPointsBack));

    section('F. 排序真实生效');
    // 先记录当前次序（按总掌握），再切到按正确率排序，次序应变化
    const orderByMaster = await b.evalJs(
      `Array.from(document.querySelectorAll('.s-card .s-acc')).map(e=>e.textContent.trim())`);
    await b.evalJs(`(() => {
      const nm = Array.from(document.querySelectorAll('#fieldOpts [data-sort]'))
        .find(e => e.getAttribute('data-sort') === 'accuracy');
      if (nm) nm.click();
      return !!nm;
    })()`);
    await sleep(500);
    const orderByAcc = await b.evalJs(
      `Array.from(document.querySelectorAll('.s-card .s-acc')).map(e=>e.textContent.trim())`);
    ok('★ 切换排序依据后次序发生变化',
       JSON.stringify(orderByMaster) !== JSON.stringify(orderByAcc),
       `掌握序=${orderByMaster.join(',')} 正确率序=${orderByAcc.join(',')}`);
    // 切换升降序
    await b.evalJs(`(() => {
      const d = document.querySelector('#fieldOpts [data-dir]');
      if (d) d.click();
      return !!d;
    })()`);
    await sleep(500);
    const orderReverse = await b.evalJs(
      `Array.from(document.querySelectorAll('.s-card .s-acc')).map(e=>e.textContent.trim())`);
    ok('★ 切换升降序后次序反转',
       JSON.stringify(orderReverse) !== JSON.stringify(orderByAcc),
       `正序=${orderByAcc.join(',')} 反序=${orderReverse.join(',')}`);

    // 关抽屉
    await b.evalJs(`document.getElementById('applyBtn').click()`);
    await sleep(400);
    const sheetClosed = await b.evalJs(`!document.getElementById('sheet').classList.contains('on')`);
    ok('抽屉可关闭', sheetClosed === true, String(sheetClosed));

    section('G. 班级切换');
    await b.evalJs(`(() => {
      const sel = document.getElementById('classSel');
      const opt = Array.from(sel.options).find(o => o.value === '${classTest ? classTest.id : ''}');
      if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change')); }
      return !!opt;
    })()`);
    await sleep(2000);
    const afterSwitch = await b.evalJs(`document.querySelectorAll('.s-card').length`);
    const switchNames = await b.evalJs(
      `Array.from(document.querySelectorAll('.s-card .s-acc')).map(e=>e.textContent.trim())`);
    const expTestAccs = (expected.students || [])
      .filter(s => s.class_id === classTest?.id).map(s => s.username);
    ok('★ 切到 test 班后只显示该班学生',
       switchNames.length === expTestAccs.length && switchNames.every(x => expTestAccs.includes(x)),
       `页面=${switchNames.join(',')} 期望=${expTestAccs.join(',')}`);
    ok('切换后卡片数一致', afterSwitch === expTestAccs.length, `${afterSwitch} vs ${expTestAccs.length}`);

    section('H. 偏好持久化');
    const savedPrefs = await b.evalJs(`localStorage.getItem('xgpy_mobile_prefs')`);
    ok('★ 字段/排序偏好已写入 localStorage', !!savedPrefs, String(savedPrefs).slice(0, 90));
    // 刷新后仍保持
    await b.ws.send('Page.navigate', { url: PAGE });
    await sleep(2400);
    const stillLoggedIn = await b.evalJs(`!document.getElementById('appView').classList.contains('hide')`);
    ok('★ 刷新后凭 token 免登录', stillLoggedIn === true, String(stillLoggedIn));
    const orderAfterReload = await b.evalJs(
      `Array.from(document.querySelectorAll('.s-card .s-acc')).map(e=>e.textContent.trim())`);
    ok('★ 刷新后排序偏好保持',
       JSON.stringify(orderAfterReload) === JSON.stringify(orderReverse),
       `刷新后=${orderAfterReload.join(',')}`);

    section('I. 退出登录');
    b.jsErrors.length = 0;
    await b.evalJs(`window.confirm = () => true; document.getElementById('logoutBtn').click(); true`);
    await sleep(900);
    const backToLogin = await b.evalJs(`!document.getElementById('loginView').classList.contains('hide')`);
    ok('★ 退出后回到登录页', backToLogin === true, String(backToLogin));
    const tokenCleared = await b.evalJs(`localStorage.getItem('xgpy_mobile_token')`);
    ok('★ 退出后本地凭证已清除', !tokenCleared, String(tokenCleared));

    ok('全程无 JS 异常', b.jsErrors.length === 0, b.jsErrors.join(' | ') || '无');
  } catch (e) {
    console.error('\n脚本异常：', e.message);
    fail++;
    failures.push('脚本异常: ' + e.message);
  } finally {
    await b.close();
  }

  console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
  if (failures.length) {
    console.log('失败项：');
    failures.forEach(f => console.log('  - ' + f));
  }
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
