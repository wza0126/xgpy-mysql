#!/usr/bin/env node
/**
 * verify_study_galaxy.cjs
 * ============================================================
 * 验证「桌面 → 学习星域」图层（迁移 104，2026-10-18）：
 *   A. 结构    —— study_galaxy_config 单行表、默认值
 *   B. 教师端  —— 读写往返、五档阈值校验（必须严格递增、首档固定 0）
 *   C. 班级开关 —— 白名单命中 / 不命中 / 空数组=全校
 *   D. 数据口径 —— 累计次数、知识点总数、章数 与直接 SQL 完全一致
 *   E. 档位     —— tierOf 边界值 1..5
 *   F. 缓存失效 —— 改开关后无需等 30s 立即生效
 *   G. 前端     —— 真机无头：图层存在、16 格地图、图标仍可点、**背景图 0 次请求**
 *   H. 对照组   —— 关闭星域后背景图恢复请求（证明跳过是星域导致的，不是别的原因）
 *   I. 清理     —— 配置恢复原状，断言不留痕
 *
 * 用法：node scripts/debug/verify_study_galaxy.cjs
 * 前置：后端 3101 + 前端 3266 在跑。
 */

const path = require('path');
const fs = require('fs');
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
require('../../src/env');

const pool = require('../../src/db');
const galaxy = require('../../src/study-galaxy');
const { launchHeadless, sleep } = require('./lib/cdp.cjs');

const BASE = process.env.XGPY_BASE || 'http://127.0.0.1:3101';
const PAGE = process.env.XGPY_UI || 'http://127.0.0.1:3266/';
const STUDENT = { u: 'a', p: '111111' };

let pass = 0;
let fail = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? '  ' + detail : ''}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}${detail ? '  ' + detail : ''}`); }
}
function section(t) { console.log(`\n【${t}】`); }

async function httpJson(method, url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(BASE + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

async function login(username, password) {
  const r = await httpJson('POST', '/api/auth/secure-login', { username, password });
  return r.json?.data?.session?.access_token || null;
}

const SET_VAL = `
function __setVal(el, v){
  const proto = Object.getPrototypeOf(el);
  const d = Object.getOwnPropertyDescriptor(proto, 'value');
  d.set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}`;
const KILL_DIALOGS = '(() => { window.confirm = () => true; window.alert = () => {}; return true; })()';

// 统计图层内「真正在跑的 CSS 动画」：只挂了 animation 名不算，必须 name !== none
const COUNT_ANIM = `(() => {
  const layer = document.querySelector('[data-study-galaxy]');
  if (!layer) return { layer: false };
  let animated = 0; const names = {};
  const walk = (el) => {
    const a = getComputedStyle(el).animationName;
    if (a && a !== 'none') { animated++; names[a] = (names[a] || 0) + 1; }
    for (const c of el.children) walk(c);
  };
  walk(layer);
  return { layer: true, animated, names, lowend: layer.getAttribute('data-study-galaxy-lowend') };
})()`;

async function loginAs(b, username, password) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await b.evalJs('(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} return true; })()');
    await b.ws.send('Page.navigate', { url: PAGE });
    let ready = false;
    for (let i = 0; i < 40; i++) {
      await sleep(400);
      ready = await b.evalJs(
        `!!Array.from(document.querySelectorAll('input')).find(i => i.placeholder && i.placeholder.includes('用户名'))`
      );
      if (ready === true) break;
    }
    if (ready !== true) continue;
    const res = await b.evalJs(`(() => {
      ${SET_VAL}
      const inputs = Array.from(document.querySelectorAll('input'));
      const u = inputs.find(i => i.placeholder && i.placeholder.includes('用户名'));
      const p = inputs.find(i => i.type === 'password');
      if (!u || !p) return 'no-form';
      __setVal(u, ${JSON.stringify(username)});
      __setVal(p, ${JSON.stringify(password)});
      const form = u.closest('form');
      if (!form) return 'no-form';
      form.requestSubmit();
      return 'submitted';
    })()`);
    if (res !== 'submitted') continue;
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      const st = await b.evalJs(`(() => { const t = document.body.innerText || ''; return {
        out: t.includes('退出登录'),
        form: !!Array.from(document.querySelectorAll('input')).find(x => x.placeholder && x.placeholder.includes('用户名')),
      }; })()`);
      if (st && st.out === true && st.form === false) {
        await sleep(2500);
        const still = await b.evalJs('(document.body.innerText || "").includes("退出登录")');
        if (still === true) return 'submitted';
      }
    }
  }
  return 'login-unstable';
}

(async () => {
  let b = null;
  let backup = null;
  let backupFocus = null;
  // 代码农场与星域在桌面**互斥**（农场开着就不叠星域）。教师可能已经把农场打开，
  // 那样星域永远不渲染，F 段整片断言会全挂 —— 这里快照后临时关掉，finally 还原。
  let backupFarmEnabled = null;
  let teacherToken = null;
  let studentToken = null;

  try {
    const [[orig]] = await pool.query('SELECT * FROM study_galaxy_config WHERE id = 1');
    backup = orig;

    // ---------------------------------------------------------
    section('A. 表结构');
    const [[cnt]] = await pool.query('SELECT COUNT(*) AS c FROM study_galaxy_config');
    ok('配置表存在且单行（id=1）', cnt.c === 1, `行数 ${cnt.c}`);
    // 默认值以「建表定义」为准：教师改过配置后，当前行就不再等于默认值，不能拿当前行断言
    const [defRows] = await pool.query(
      `SELECT COLUMN_NAME, COLUMN_DEFAULT FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'study_galaxy_config'
         AND COLUMN_NAME IN ('daily_goal','tier_2','tier_3','tier_4','tier_5','lit_ratio')`
    );
    const def = Object.fromEntries(defRows.map((x) => [x.COLUMN_NAME, x.COLUMN_DEFAULT]));
    ok('建表默认：今日目标 30', Number(def.daily_goal) === 30, String(def.daily_goal));
    ok('建表默认：五档 50/200/500/1000',
      Number(def.tier_2) === 50 && Number(def.tier_3) === 200 &&
      Number(def.tier_4) === 500 && Number(def.tier_5) === 1000,
      `${def.tier_2}/${def.tier_3}/${def.tier_4}/${def.tier_5}`);
    ok('建表默认：点亮门槛 0.5', Number(def.lit_ratio) === 0.5, String(def.lit_ratio));
    ok('当前配置值合法且五档严格递增（教师可能已改）',
      Number(orig.daily_goal) > 0 &&
      Number(orig.tier_1 ?? 0) === 0 &&
      Number(orig.tier_2) < Number(orig.tier_3) &&
      Number(orig.tier_3) < Number(orig.tier_4) &&
      Number(orig.tier_4) < Number(orig.tier_5),
      `goal=${orig.daily_goal} tiers=${orig.tier_2}/${orig.tier_3}/${orig.tier_4}/${orig.tier_5}`);

    teacherToken = await login('teacher', 'xgpy666');
    studentToken = await login(STUDENT.u, STUDENT.p);
    ok('教师 / 学生登录成功', !!teacherToken && !!studentToken);

    const [[stu]] = await pool.query('SELECT id, class_id FROM profiles WHERE username = ? LIMIT 1', [STUDENT.u]);
    ok('取到测试学生班级', !!stu && !!stu.class_id, stu ? String(stu.class_id).slice(0, 8) : '-');

    // ---------------------------------------------------------
    section('B. 教师端读写 + 阈值校验');
    let r = await httpJson('GET', '/api/teacher/study-galaxy/config', undefined, teacherToken);
    ok('GET 配置 200', r.status === 200, `status=${r.status}`);
    ok('返回 5 档阈值', Array.isArray(r.json?.data?.config?.tiers) && r.json.data.config.tiers.length === 5);

    r = await httpJson('PUT', '/api/teacher/study-galaxy/config',
      { enabled: true, class_ids: [], daily_goal: 25, tiers: [0, 40, 120, 300, 600] }, teacherToken);
    ok('合法配置保存成功', r.status === 200 && r.json?.data?.ok === true, `status=${r.status}`);

    r = await httpJson('GET', '/api/teacher/study-galaxy/config', undefined, teacherToken);
    const c1 = r.json?.data?.config;
    ok('读回 enabled=true', c1?.enabled === true);
    ok('读回 daily_goal=25', Number(c1?.daily_goal) === 25, String(c1?.daily_goal));
    ok('读回自定义阈值 40/120/300/600',
      JSON.stringify(c1?.tiers) === JSON.stringify([0, 40, 120, 300, 600]), JSON.stringify(c1?.tiers));

    r = await httpJson('PUT', '/api/teacher/study-galaxy/config',
      { enabled: true, tiers: [0, 100, 50, 300, 600] }, teacherToken);
    ok('非递增阈值被拒（400）', r.status === 400, `status=${r.status}`);

    r = await httpJson('PUT', '/api/teacher/study-galaxy/config',
      { enabled: true, tiers: [5, 50, 200, 500, 1000] }, teacherToken);
    ok('首档必须是 0（400）', r.status === 400, `status=${r.status}`);

    r = await httpJson('GET', '/api/teacher/study-galaxy/config', undefined, teacherToken);
    ok('被拒后阈值未被写坏',
      JSON.stringify(r.json?.data?.config?.tiers) === JSON.stringify([0, 40, 120, 300, 600]),
      JSON.stringify(r.json?.data?.config?.tiers));

    // ---------------------------------------------------------
    section('C. 班级开关');
    r = await httpJson('PUT', '/api/teacher/study-galaxy/config',
      { enabled: true, class_ids: ['__not_a_class__'], daily_goal: 30, tiers: [0, 50, 200, 500, 1000] }, teacherToken);
    ok('写入不存在的班级', r.status === 200);
    r = await httpJson('GET', '/api/student/study-galaxy', undefined, studentToken);
    ok('班级不命中 → out_of_scope',
      r.json?.data?.enabled === false && r.json?.data?.reason === 'out_of_scope', JSON.stringify(r.json?.data));

    r = await httpJson('PUT', '/api/teacher/study-galaxy/config',
      { enabled: true, class_ids: [stu.class_id], daily_goal: 30, tiers: [0, 50, 200, 500, 1000] }, teacherToken);
    ok('写入学生所在班级', r.status === 200);
    r = await httpJson('GET', '/api/student/study-galaxy', undefined, studentToken);
    ok('班级命中 → enabled', r.json?.data?.enabled === true, String(r.json?.data?.reason || 'ok'));

    r = await httpJson('PUT', '/api/teacher/study-galaxy/config',
      { enabled: false, class_ids: [], daily_goal: 30, tiers: [0, 50, 200, 500, 1000] }, teacherToken);
    r = await httpJson('GET', '/api/student/study-galaxy', undefined, studentToken);
    ok('总开关关闭 → closed',
      r.json?.data?.enabled === false && r.json?.data?.reason === 'closed', JSON.stringify(r.json?.data));

    // ---------------------------------------------------------
    section('D. 数据口径（与直接 SQL 对齐）');
    await httpJson('PUT', '/api/teacher/study-galaxy/config',
      { enabled: true, class_ids: [], daily_goal: 30, tiers: [0, 50, 200, 500, 1000] }, teacherToken);
    r = await httpJson('GET', '/api/student/study-galaxy', undefined, studentToken);
    const d = r.json?.data || {};
    ok('接口 200 且 enabled', r.status === 200 && d.enabled === true);

    const [[sqlTotal]] = await pool.query(
      'SELECT COUNT(*) AS c, SUM(CASE WHEN DATE(created_at)=CURDATE() THEN 1 ELSE 0 END) AS t FROM student_answers WHERE student_id=?',
      [stu.id]
    );
    ok('累计作答次数一致', Number(d.total_answer) === Number(sqlTotal.c), `${d.total_answer} vs ${sqlTotal.c}`);
    ok('今日作答次数一致', Number(d.today_answer) === Number(sqlTotal.t || 0), `${d.today_answer} vs ${sqlTotal.t || 0}`);

    const [[sqlPts]] = await pool.query(
      "SELECT COUNT(DISTINCT cluster_id) AS c FROM questions WHERE type NOT IN ('wps_op','access_op') AND cluster_id LIKE '%/%'"
    );
    ok('知识点总数（二级小节）一致', d.summary?.points_total === Number(sqlPts.c), `${d.summary?.points_total} vs ${sqlPts.c}`);

    const [[sqlCh]] = await pool.query(
      "SELECT COUNT(DISTINCT SUBSTRING_INDEX(cluster_id,'/',1)) AS c FROM questions WHERE type NOT IN ('wps_op','access_op') AND cluster_id LIKE '%/%'"
    );
    ok('章数一致', d.summary?.chapters_total === Number(sqlCh.c), `${d.summary?.chapters_total} vs ${sqlCh.c}`);

    ok('chapters 数组长度 = 16', Array.isArray(d.chapters) && d.chapters.length === 16, String(d.chapters?.length));
    ok('每章都带 sections 数组', (d.chapters || []).every((c) => Array.isArray(c.sections)));
    const ptSum = (d.chapters || []).reduce((s, c) => s + (c.points || 0), 0);
    ok('各章 points 之和 = 知识点总数', ptSum === d.summary?.points_total, `${ptSum} vs ${d.summary?.points_total}`);

    // 点亮口径抽验：随机取一个有题的知识点，按「掌握率 >= 50%」复核
    let checked = 0;
    let mismatched = 0;
    for (const ch of d.chapters || []) {
      for (const s of ch.sections || []) {
        if (!s.questions) continue;
        const expect = s.mastered_questions / s.questions >= 0.5;
        if (expect !== s.lit) mismatched++;
        checked++;
      }
    }
    ok('小节点亮判定与 50% 掌握率一致', checked > 0 && mismatched === 0, `检查 ${checked} 个，不一致 ${mismatched}`);

    const touchedLit = (d.chapters || []).every((c) =>
      c.lit === (c.sections.length > 0 && c.sections.every((s) => s.lit))
    );
    ok('章点亮 = 全部小节点亮', touchedLit);

    if (d.next) {
      ok('下一目标 remain = total - mastered',
        d.next.remain === Math.max(0, d.next.total - d.next.mastered),
        `${d.next.remain} / ${d.next.total}-${d.next.mastered}`);
    } else {
      ok('已全部点亮时 next 为空', d.summary.points_mastered === d.summary.points_total);
    }

    // ---------------------------------------------------------
    section('E. 档位映射（边界值）');
    const T = [0, 50, 200, 500, 1000];
    const cases = [[0, 1], [49, 1], [50, 2], [199, 2], [200, 3], [499, 3], [500, 4], [999, 4], [1000, 5], [99999, 5]];
    let tierBad = 0;
    cases.forEach(([v, exp]) => {
      if (galaxy.tierOf(v, T) !== exp) {
        tierBad++;
        console.log(`      tierOf(${v}) = ${galaxy.tierOf(v, T)}，期望 ${exp}`);
      }
    });
    ok('tierOf 边界值全部正确', tierBad === 0, `${cases.length} 组`);
    ok('连续天数空数据为 0', galaxy.calcStreak([]) === 0);

    // 自定义阈值也生效（把成图门槛压到 1，累计必然 >=1 → 至少成图）
    await httpJson('PUT', '/api/teacher/study-galaxy/config',
      { enabled: true, class_ids: [], daily_goal: 30, tiers: [0, 1, 2, 3, 4] }, teacherToken);
    r = await httpJson('GET', '/api/student/study-galaxy', undefined, studentToken);
    ok('自定义阈值生效（累计≥4 → 星海）', r.json?.data?.tier === 5, `tier=${r.json?.data?.tier}`);
    await httpJson('PUT', '/api/teacher/study-galaxy/config',
      { enabled: true, class_ids: [], daily_goal: 30, tiers: [0, 5000, 6000, 7000, 8000] }, teacherToken)
      .then(async () => {
        const rr = await httpJson('GET', '/api/student/study-galaxy', undefined, studentToken);
        ok('阈值调高后档位回落（配置即时生效，缓存已清）', rr.json?.data?.tier === 1, `tier=${rr.json?.data?.tier}`);
      });

    // ---------------------------------------------------------
    section('F. 前端（真机无头）');
    // 恢复到默认阈值再截图，保证画面是「真实档位」
    await httpJson('PUT', '/api/teacher/study-galaxy/config',
      { enabled: true, class_ids: [], daily_goal: 30, tiers: [0, 50, 200, 500, 1000] }, teacherToken);

    // 「下一个目标」的期望值必须在**无头浏览器登录之前**用 HTTP token 取：
    // 服务端按单会话处理，同一账号在浏览器里登录后，先前 login() 拿到的 token 会变成 401（实测）。
    const nxRes = await httpJson('GET', '/api/student/study-galaxy', undefined, studentToken);
    const nx = nxRes.json?.data?.next;

    // 专注模式会把图层退化成「只留星点」并隐藏底部地图。
    // 为了同时验证「完整形态」与「专注形态」，这里先把本班从专注名单里摘掉（快照，finally 还原）。
    const [[fm]] = await pool.query('SELECT focus_mode_enabled, focus_mode_classes FROM pet_config LIMIT 1');
    backupFocus = fm || null;
    let fmList = [];
    try { fmList = JSON.parse(fm?.focus_mode_classes || '[]'); } catch (e) { fmList = []; }
    const fmFiltered = fmList.filter((x) => String(x) !== String(stu.class_id));
    await pool.query('UPDATE pet_config SET focus_mode_classes = ? LIMIT 1', [JSON.stringify(fmFiltered)]);
    ok('已临时把本班移出专注模式（测完整形态）',
      !fmFiltered.map(String).includes(String(stu.class_id)),
      `${fmList.length} → ${fmFiltered.length}`);

    // 农场开着时桌面不叠星域（互斥），先临时关掉，否则整段前端断言都会因为「图层不存在」而失败
    const [[fcfg]] = await pool.query('SELECT enabled FROM farm_config LIMIT 1');
    if (fcfg) {
      backupFarmEnabled = Number(fcfg.enabled);
      await pool.query('UPDATE farm_config SET enabled = 0 LIMIT 1');
      ok('已临时关闭代码农场（与星域互斥）', true, `原值 ${backupFarmEnabled}`);
    }

    b = await launchHeadless({ port: 9461, windowSize: '1440,900', userDataDir: '.tmp-chrome-sg' });
    // 在页面脚本之前挂钩 fetch：统计背景图请求次数（证明「星域开启时不拉壁纸」）
    await b.ws.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__sgBg=[];(function(){var of=window.fetch;window.fetch=function(u){try{window.__sgBg.push(String(u&&u.url?u.url:u));}catch(e){}return of.apply(this,arguments);};})();`,
    });
    await b.evalJs(KILL_DIALOGS);
    const loginRes = await loginAs(b, STUDENT.u, STUDENT.p);
    ok('学生登录成功', loginRes === 'submitted', loginRes);
    await b.evalJs(KILL_DIALOGS);

    // 等图层真正出现（登录后首屏可能还在拉数据，固定 sleep 不稳）
    let dom = null;
    for (let i = 0; i < 26; i++) {
      await sleep(700);
      dom = await b.evalJs(`(() => {
        const layer = document.querySelector('[data-study-galaxy]');
        return {
          has: !!layer,
          tier: layer ? layer.getAttribute('data-study-galaxy') : null,
          tierName: layer ? layer.getAttribute('data-study-galaxy-tier') : null,
          cells: document.querySelectorAll('[data-chapter]').length,
          nodes: layer ? layer.querySelectorAll('*').length : 0,
          // ⚠️ 不要截断：星座名加章节编号后文本变长，截 200 字符会把卡片文案挤出窗口（误报）
          cardText: layer ? (layer.innerText || '').replace(/\\s+/g, ' ') : '',
          // 知识点地图每格首段应是章节编号（1.1 / 2.1 …）
          codes: Array.from(document.querySelectorAll('[data-chapter]')).map(el => {
            const m = (el.textContent || '').trim().match(/^\\d+\\.\\d+/);
            return m ? m[0] : '';
          }),
          icon: !!Array.from(document.querySelectorAll('span')).find(s => (s.textContent || '').trim() === '学习'),
        };
      })()`);
      if (dom && dom.has && dom.cells >= 16 && dom.icon) break;
    }
    ok('图层已渲染', dom.has === true);
    ok('图层档位属性存在', !!dom.tier, `tier=${dom.tier} ${dom.tierName}`);
    ok('知识点地图 16 格', dom.cells === 16, String(dom.cells));
    ok('知识点地图每格带章节编号（1.1…4.3）', (dom.codes || []).length === 16 && dom.codes.every(c => /^\d+\.\d+$/.test(c)), (dom.codes || []).slice(0, 4).join(','));
    ok('卡片含今日/星座/知识点/今日掌握文案',
      /今日/.test(dom.cardText || '') && /已点亮星座/.test(dom.cardText || '') &&
      /已掌握知识点/.test(dom.cardText || '') && /今日掌握/.test(dom.cardText || ''),
      (dom.cardText || '').slice(0, 60));
    // 「连续练习天数」已下线：一周两节课，连续天数天然难看，改看今天掌握了几题
    ok('卡片不再显示「连续练习」', !/连续练习/.test(dom.cardText || ''));
    ok('节点数在预算内（<900）', dom.nodes > 0 && dom.nodes < 900, String(dom.nodes));

    // 图标仍可点：图层 pointer-events-none，命中测试不应落在图层里
    const hit = await b.evalJs(`(() => {
      const span = Array.from(document.querySelectorAll('span')).find(s => (s.textContent || '').trim() === '学习');
      if (!span) return 'no-icon';
      const box = span.getBoundingClientRect();
      if (!box.width) return 'zero-box';
      const el = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      if (!el) return 'null-hit';
      return el.closest('[data-study-galaxy]') ? 'blocked' : 'pass';
    })()`);
    ok('图标未被图层挡住点击', hit === 'pass', hit);

    const bg = await b.evalJs(`(window.__sgBg || []).filter(u => /desktop-background|custom-background/.test(u))`);
    ok('星域开启时背景图 0 次请求', Array.isArray(bg) && bg.length === 0, JSON.stringify(bg));

    const bgProp = await b.evalJs(`(() => {
      const el = document.querySelector('[data-study-galaxy]');
      if (!el || !el.parentElement) return 'no-layer';
      const bi = el.parentElement.style.backgroundImage || '';
      return bi.includes('url(') ? 'has-image' : 'no-image';
    })()`);
    ok('桌面不再加载壁纸（backgroundImage 里没有 url）', bgProp === 'no-image' || bgProp === 'no-layer', bgProp);

    // ---- 动效：最高档如果只是「一张更满的静态图」，等于白做 ----
    const animInfo = await b.evalJs(COUNT_ANIM);
    ok('图层有动画元素在跑', animInfo.layer === true && animInfo.animated > 0, `animated=${animInfo.animated}`);
    ok('动画种类齐全（闪烁/光晕/流星/流光/呼吸）',
      ['sg-tw1', 'sg-tw2', 'sg-halo', 'sg-meteor', 'sg-trace', 'sg-breathe'].every((k) => ((animInfo.names || {})[k] || 0) > 0),
      JSON.stringify(animInfo.names || {}));
    ok('动画节点数在预算内（≤140）', animInfo.animated <= 140, String(animInfo.animated));

    // 帧间像素差异：证明真的在动，而不只是挂了个 animation 名
    try {
      const clipSky = { x: 400, y: 60, width: 1000, height: 460, scale: 1 };
      const s1 = await b.ws.send('Page.captureScreenshot', { format: 'png', clip: clipSky });
      await sleep(1200);
      const s2 = await b.ws.send('Page.captureScreenshot', { format: 'png', clip: clipSky });
      const changed = Buffer.compare(Buffer.from(s1.data, 'base64'), Buffer.from(s2.data, 'base64')) !== 0;
      ok('天空区域两帧像素不同（确认在动）', changed === true);
    } catch (e) {
      ok('天空区域两帧像素不同（确认在动）', false, e.message);
    }

    // 系统级「减弱动效」偏好必须让动画全停（教室投屏/晕动症学生）
    try {
      await b.ws.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
      });
      await sleep(400);
      const reduced = await b.evalJs(COUNT_ANIM);
      ok('系统设「减弱动效」时动画全关', reduced.layer === true && reduced.animated === 0, `animated=${reduced.animated}`);
      await b.ws.send('Emulation.setEmulatedMedia', { features: [] });
    } catch (e) {
      ok('系统设「减弱动效」时动画全关', false, e.message);
    }

    try {
      const shot = await b.ws.send('Page.captureScreenshot', { format: 'png' });
      const out = 'D:/wza/xgpy-mysql/.workbuddy/study_galaxy_preview.png';
      fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
      console.log('    📷 截图: ' + out);
      ok('截图已生成', fs.existsSync(out) && fs.statSync(out).size > 20000, String(fs.existsSync(out) ? fs.statSync(out).size : 0));
    } catch (e) {
      ok('截图已生成', false, e.message);
    }

    // ---- 今日卡「下一个目标」：也要可点 → 打开学习模块并定位到该小节 ----
    ok('学生接口返回「下一个目标」', !!nx && !!nx.chapter && !!nx.section,
      nx ? `${nx.chapter} / ${nx.section}` : `status=${nxRes.status} body=${JSON.stringify(nxRes.json).slice(0, 160)}`);
    if (nx) {
      const nxUi = await b.evalJs(`(() => {
        const el = document.querySelector('[data-next-target="1"]');
        if (!el) return { has: false };
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return {
          has: true,
          cursor: getComputedStyle(el).cursor,
          pe: getComputedStyle(el).pointerEvents,
          text: (el.innerText || '').replace(/\\s+/g, ' '),
          hitSelf: !!(top && top.closest('[data-next-target]')),
        };
      })()`);
      ok('「下一个目标」标记为可点击', nxUi.has === true && nxUi.cursor === 'pointer', nxUi.cursor);
      ok('该块自身接收点击（父层 pointer-events-none 不拦）', nxUi.pe === 'auto', nxUi.pe);
      ok('点击坐标命中该块（未被其他层遮挡）', nxUi.hitSelf === true);
      ok('文案含目标小节名与「去学习」',
        (nxUi.text || '').includes(nx.section) && /去学习/.test(nxUi.text || ''),
        (nxUi.text || '').slice(0, 48));

      await b.evalJs(`(() => {
        const el = document.querySelector('[data-next-target="1"]');
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        top.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return true;
      })()`);
      let nxOpened = false;
      for (let i = 0; i < 30; i++) {
        await sleep(400);
        nxOpened = await b.evalJs(`document.querySelectorAll('[data-learn-section]').length > 0`);
        if (nxOpened === true) break;
      }
      ok('点击后学习模块已打开', nxOpened === true);

      await sleep(2200);
      const nxDetail = await b.evalJs(`(() => {
        const want = ${JSON.stringify(nx.chapter + '/' + nx.section)};
        const btn = document.querySelector('[data-learn-section="' + CSS.escape(want) + '"]');
        const safe = ${JSON.stringify(nx.section)}.replace(/[^\\w\\u4e00-\\u9fa5]+/g, '-').replace(/^-+|-+$/g, '');
        const anchor = document.getElementById('sec-' + safe);
        let inView = false;
        if (anchor) {
          let p = anchor.parentElement, sc = null;
          while (p) {
            const cs = getComputedStyle(p);
            if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 4) { sc = p; break; }
            p = p.parentElement;
          }
          if (sc) {
            const ar = anchor.getBoundingClientRect(), sr = sc.getBoundingClientRect();
            // 「已滚到该小节附近」：标题落在容器顶部区域（窗口从最小化恢复时布局会抖几像素）
            inView = ar.top >= sr.top - 24 && ar.top <= sr.top + 80;
          }
        }
        return {
          btn: !!btn,
          active: btn ? /bg-indigo-50/.test(btn.className) : false,
          chapterBtn: !!document.querySelector('[data-learn-chapter="' + CSS.escape(${JSON.stringify(nx.chapter)}) + '"]'),
          inView,
        };
      })()`);
      ok('学习模块已展开到目标章', nxDetail.chapterBtn === true);
      ok('目标小节按钮存在', nxDetail.btn === true, nx.chapter + '/' + nx.section);
      ok('目标小节处于选中高亮', nxDetail.active === true);
      ok('讲义已滚到该小节（锚点在可视区内）', nxDetail.inView === true);

      // ---- 真实高频路径：学习窗口**已开着（最小化）**时再点「下一个目标」 ----
      // 先把学习模块切到别的章，制造与目标章不同的起点
      const switched = await b.evalJs(`(() => {
        const btns = Array.from(document.querySelectorAll('[data-learn-chapter]'));
        const other = btns.find(x => x.getAttribute('data-learn-chapter') !== ${JSON.stringify(nx.chapter)});
        if (!other) return 'none';
        other.click();
        return other.getAttribute('data-learn-chapter');
      })()`);
      ok('已切到另一章作为起点', switched !== 'none' && !!switched, String(switched).slice(0, 18));
      await sleep(1500);

      // 最小化学习窗口（标题栏 fa-minus）
      const minimized = await b.evalJs(`(() => {
        const btn = document.querySelector('[data-learn-chapter]');
        if (!btn) return 'no-learn';
        let p = btn;
        while (p && !(p.querySelector && p.querySelector('i.fa-minus'))) p = p.parentElement;
        const icon = p && p.querySelector('i.fa-minus');
        const minBtn = icon && icon.closest('button');
        if (!minBtn) return 'no-min-btn';
        minBtn.click();
        return 'ok';
      })()`);
      ok('学习窗口已最小化', minimized === 'ok', minimized);
      await sleep(1200);

      const reHit = await b.evalJs(`(() => {
        const el = document.querySelector('[data-next-target="1"]');
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return !!(top && top.closest('[data-next-target]'));
      })()`);
      ok('最小化后「下一个目标」重新可点（窗口不再遮挡）', reHit === true);

      const winBefore = await b.evalJs(`document.querySelectorAll('[data-learn-chapter]').length`);
      await b.evalJs(`(() => {
        const el = document.querySelector('[data-next-target="1"]');
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        top.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return true;
      })()`);
      await sleep(3000);
      const winAfter = await b.evalJs(`document.querySelectorAll('[data-learn-chapter]').length`);
      ok('没有开出第二个学习窗口', winAfter === winBefore, `${winBefore} → ${winAfter}`);

      const back = await b.evalJs(`(() => {
        const want = ${JSON.stringify(nx.chapter + '/' + nx.section)};
        const btn = document.querySelector('[data-learn-section="' + CSS.escape(want) + '"]');
        const safe = ${JSON.stringify(nx.section)}.replace(/[^\\w\\u4e00-\\u9fa5]+/g, '-').replace(/^-+|-+$/g, '');
        const anchor = document.getElementById('sec-' + safe);
        let inView = false;
        if (anchor) {
          let p = anchor.parentElement, sc = null;
          while (p) {
            const cs = getComputedStyle(p);
            if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 4) { sc = p; break; }
            p = p.parentElement;
          }
          if (sc) {
            const ar = anchor.getBoundingClientRect(), sr = sc.getBoundingClientRect();
            inView = ar.top >= sr.top - 24 && ar.top <= sr.top + 80;
          }
        }
        const anySec = document.querySelector('[data-learn-section]');
        const r0 = anySec ? anySec.getBoundingClientRect() : null;
        return {
          btn: !!btn,
          active: btn ? /bg-indigo-50/.test(btn.className) : false,
          inView,
          visible: !!(r0 && r0.width > 0 && r0.height > 0),
        };
      })()`);
      ok('窗口已还原且内容可见', back.visible === true);
      ok('已切回目标章，目标小节高亮', back.btn === true && back.active === true);
      ok('讲义已滚到该小节', back.inView === true);
    }

    // ---------------------------------------------------------
    section('F2. 专注模式退化形态');
    if (backupFocus) {
      // 强制打开专注模式并让本班命中：教师可能已经把专注模式整个关掉了，不能依赖当前环境
      let f2List = [];
      try { f2List = JSON.parse(backupFocus.focus_mode_classes || '[]'); } catch (e) { f2List = []; }
      if (!f2List.map(String).includes(String(stu.class_id))) f2List.push(stu.class_id);
      await pool.query('UPDATE pet_config SET focus_mode_enabled = 1, focus_mode_classes = ? LIMIT 1',
        [JSON.stringify(f2List)]);
      ok('已强制开启专注模式且本班命中', true, `${f2List.length} 个班`);
      // 重新走一次登录（单纯 navigate 会掉登录态，导致断言拿到的是登录页）
      const relogin1 = await loginAs(b, STUDENT.u, STUDENT.p);
      ok('恢复专注模式后重新登录成功', relogin1 === 'submitted', relogin1);
      await b.evalJs(KILL_DIALOGS);
      await sleep(3000);
      const simp = await b.evalJs(`(() => {
        const layer = document.querySelector('[data-study-galaxy]');
        return {
          layer: !!layer,
          cells: document.querySelectorAll('[data-chapter]').length,
          hasCard: layer ? (layer.innerText || '').includes('今日') : false,
          loggedIn: (document.body.innerText || '').includes('退出登录'),
        };
      })()`);
      ok('专注模式下仍渲染图层', simp.loggedIn === true && simp.layer === true, `loggedIn=${simp.loggedIn}`);
      ok('专注模式隐藏底部知识点地图', simp.cells === 0, `cells=${simp.cells}`);
      ok('专注模式保留今日进度卡', simp.hasCard === true);
    }

    // ---------------------------------------------------------
    section('G. 对照组：关闭星域后背景图恢复请求');
    await httpJson('PUT', '/api/teacher/study-galaxy/config',
      { enabled: false, class_ids: [], daily_goal: 30, tiers: [0, 50, 200, 500, 1000] }, teacherToken);
    const relogin2 = await loginAs(b, STUDENT.u, STUDENT.p);
    ok('关闭星域后重新登录成功', relogin2 === 'submitted', relogin2);
    await b.evalJs(KILL_DIALOGS);
    await sleep(5000);
    const dom2 = await b.evalJs(`(() => ({
      layer: !!document.querySelector('[data-study-galaxy]'),
      bg: (window.__sgBg || []).filter(u => /desktop-background|custom-background/.test(u)).length,
      loggedIn: (document.body.innerText || '').includes('退出登录'),
    }))()`);
    ok('关闭后图层不再渲染', dom2.layer === false);
    ok('关闭后背景图恢复请求', dom2.loggedIn === true && dom2.bg > 0, `loggedIn=${dom2.loggedIn} calls=${dom2.bg}`);

    // ---------------------------------------------------------
    section('I. 教师端「图层背景」入口');
    const reloginT = await loginAs(b, 'teacher', 'xgpy666');
    ok('教师登录成功', reloginT === 'submitted', reloginT);
    await b.evalJs(KILL_DIALOGS);
    await sleep(1500);

    const navHit = await b.evalJs(`(() => {
      const nodes = Array.from(document.querySelectorAll('button,a,div,li'));
      const el = nodes.find(n => (n.textContent || '').replace(/\\s+/g, '') === '图层背景' && n.offsetParent !== null);
      if (!el) return 'no-menu';
      el.click();
      return 'clicked';
    })()`);
    ok('侧边栏有「图层背景」菜单', navHit === 'clicked', navHit);
    await sleep(1500);

    const layerPage = await b.evalJs(`(() => {
      const t = document.body.innerText || '';
      return {
        hasFarmTab: t.includes('代码农场'),
        hasGalaxyTab: t.includes('学习星域'),
        hasIntro: t.includes('图层铺在壁纸之上'),
      };
    })()`);
    ok('页面含两个图层 Tab', layerPage.hasFarmTab && layerPage.hasGalaxyTab, JSON.stringify(layerPage));
    ok('页面说明为「壁纸之上、图标之下」', layerPage.hasIntro === true);

    const galaxyTab = await b.evalJs(`(() => {
      const nodes = Array.from(document.querySelectorAll('button,div,span'));
      const el = nodes.find(n => (n.textContent || '').replace(/\\s+/g, '') === '学习星域' && n.offsetParent !== null);
      if (!el) return 'no-tab';
      el.click();
      return 'clicked';
    })()`);
    ok('可切换到「学习星域」', galaxyTab === 'clicked', galaxyTab);
    await sleep(2000);

    const cfgUi = await b.evalJs(`(() => {
      const t = document.body.innerText || '';
      return {
        hasSwitch: t.includes('总开关'),
        hasClasses: t.includes('生效班级'),
        hasGoal: t.includes('今日目标'),
        hasTiers: t.includes('五档阈值'),
        hasRule: t.includes('知识点点亮规则'),
        hasBgHint: t.includes('不再请求背景图'),
        inputs: document.querySelectorAll('input[type=number]').length,
      };
    })()`);
    ok('配置项齐全（开关/班级/今日目标/五档/规则）',
      cfgUi.hasSwitch && cfgUi.hasClasses && cfgUi.hasGoal && cfgUi.hasTiers && cfgUi.hasRule,
      JSON.stringify(cfgUi));
    ok('提示「星域开启时不请求背景图」', cfgUi.hasBgHint === true);
    ok('数字输入框 6 个（今日目标 1 + 五档阈值 5）', cfgUi.inputs === 6, String(cfgUi.inputs));

    try {
      const shot = await b.ws.send('Page.captureScreenshot', { format: 'png' });
      const outT = 'D:/wza/xgpy-mysql/.workbuddy/study_galaxy_teacher.png';
      fs.writeFileSync(outT, Buffer.from(shot.data, 'base64'));
      console.log('    📷 教师端截图: ' + outT);
      ok('教师端截图已生成', fs.existsSync(outT) && fs.statSync(outT).size > 20000,
        String(fs.existsSync(outT) ? fs.statSync(outT).size : 0));
    } catch (e) {
      ok('教师端截图已生成', false, e.message);
    }

    // ---------------------------------------------------------
    section('H. 清理');
    await pool.query(
      'UPDATE study_galaxy_config SET enabled=?, class_ids=?, daily_goal=?, tier_2=?, tier_3=?, tier_4=?, tier_5=?, lit_ratio=? WHERE id=1',
      [backup.enabled, backup.class_ids, backup.daily_goal, backup.tier_2, backup.tier_3, backup.tier_4, backup.tier_5, backup.lit_ratio]
    );
    const [[after]] = await pool.query('SELECT * FROM study_galaxy_config WHERE id = 1');
    ok('配置已恢复原状',
      Number(after.enabled) === Number(backup.enabled) &&
      Number(after.daily_goal) === Number(backup.daily_goal) &&
      String(after.class_ids || '') === String(backup.class_ids || ''),
      `enabled=${after.enabled} goal=${after.daily_goal}`);
    const [[tmp]] = await pool.query("SELECT COUNT(*) AS c FROM profiles WHERE username LIKE 'tmp_%'");
    ok('无临时学生残留', Number(tmp.c) === 0, String(tmp.c));
  } catch (e) {
    console.log('\n💥 脚本异常: ' + e.message + '\n' + (e.stack || '').split('\n').slice(1, 4).join('\n'));
    fail++;
    failures.push('脚本异常: ' + e.message);
  } finally {
    if (b) {
      try { await b.close(); } catch (e) { /* ignore */ }
    }
    try {
      if (backup) {
        await pool.query(
          'UPDATE study_galaxy_config SET enabled=?, class_ids=?, daily_goal=?, tier_2=?, tier_3=?, tier_4=?, tier_5=?, lit_ratio=? WHERE id=1',
          [backup.enabled, backup.class_ids, backup.daily_goal, backup.tier_2, backup.tier_3, backup.tier_4, backup.tier_5, backup.lit_ratio]
        );
      }
      // 专注模式开关与名单必须还原（F2 段动过，教师原本可能是关着的）
      if (backupFocus) {
        await pool.query('UPDATE pet_config SET focus_mode_enabled = ?, focus_mode_classes = ? LIMIT 1',
          [backupFocus.focus_mode_enabled, backupFocus.focus_mode_classes]);
      }
      // 农场开关还原（F 段为了测星域临时关过）
      if (backupFarmEnabled !== null) {
        await pool.query('UPDATE farm_config SET enabled = ? LIMIT 1', [backupFarmEnabled]);
      }
    } catch (e) { /* ignore */ }
    await pool.end().catch(() => {});
    console.log(`\n================ 结果：${pass} 通过 / ${fail} 失败 ================`);
    if (failures.length) console.log('失败项：\n  - ' + failures.join('\n  - '));
    process.exit(fail === 0 ? 0 : 1);
  }
})();
