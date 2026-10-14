/**
 * 验证：宠物「等级 / 阶段」全链路口径一致（2026-10-14）
 *
 * 被修复的三个缺陷（本脚本就是它们的回归护栏）：
 *   ① 【练习界面 / 错题本】PetCompanion 把「阶段」当「等级」传给 PetSprite 渲染 `Lv.X`，
 *      而阶段 = min(等级, maxStage)，于是等级**永远封顶在 5**（学生 a 真实 16 级却显示 Lv.5）。
 *   ② 【任务系统】pet_level 指标读的是 profiles.pet_level —— 一个 019/020 迁移回填后再无人写入的
 *      死列，学生 a 卡死在 5 → 「宠物等级 5 级就封顶，怎么喂都不涨」。
 *   ③ 【进化动画】level > 5 时显示「超越阶段(Lv.6)」，与萌宠模块显示的阶段名「究极体」对不上。
 *
 * 统一口径（唯一真源，见 frontend/src/types/index.ts 的 petStageOf / petStageName）：
 *   · 等级 growth_level **无上限**，可以一直涨；
 *   · 阶段 = clamp(等级, 1, max_stage)，默认 5 → 从 6 级起都显示第 5 阶段「究极体」，
 *     但 `Lv.` 后面的数字继续涨；阶段只用来挑形象图片 / 显示阶段名。
 *
 * 覆盖：
 *   A. 数据 + 任务指标层（不用浏览器）
 *   B. 前端 UI —— 学生桌面「练习」窗口里 PetSprite 的 `Lv.X` 徽标（★ 直接复现用户报的现象）
 *
 * 用法：cd backend && node scripts/debug/verify_pet_level.cjs
 *   ⛔ 需要后端 3101 与前端 3266 都在跑。
 *
 * 踩坑备忘（下次别再踩）：
 *   · 练习窗口打开后**默认停在「练习设置」页**（PracticeModule `if (showConfig)` 提前 return），
 *     PetCompanion 只在**答题页**渲染 → 不点「开始练习」就永远抓不到 `Lv.` 徽标。
 *   · 探针学生不能假设「无宠物」：库里 b 本来就有 2 只 1 级宠物，
 *     断言应写「现有最高等级 < 探针等级」，而不是「没有宠物行」。
 */
const mysql = require('mysql2/promise');
const { launchHeadless, sleep } = require('./lib/cdp.cjs');
const metrics = require('../../src/game-task-metrics');

const PAGE = process.env.XGPY_UI || 'http://127.0.0.1:3266/';
const DB = { host: '127.0.0.1', user: 'root', password: '122201', database: 'xgpy' };
const STUDENT = { u: 'a', p: '111111' };
// 临时探针：借学生 b 插一条 12 级宠物，证明指标不会被截断到 5（b 原有宠物只有 1 级）
const PROBE_PET_ID = 'tmp_petlvl_probe';
const PROBE_STUDENT = 'b';
const PROBE_LEVEL = 12;

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
function section(t) { console.log(`\n=== ${t} ===`); }
const argv = process.argv.slice(2);
const SKIP_UI = argv.includes('--no-ui');

const SET_VAL = `
function __setVal(el, v){
  const proto = Object.getPrototypeOf(el);
  const d = Object.getOwnPropertyDescriptor(proto, 'value');
  d.set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}`;

/**
 * ⚠️ 服务端是「会话替换」策略：同账号再登会让旧 token 失效，dev 下切号偶发被踢回登录页。
 *    所以要求「登录后桌面稳定 3 秒」才算成功，最多重试 3 次（与 verify_farm_ui 同策略）。
 */
async function loginAs(b, username, password) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await b.evalJs('(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} return true; })()');
    await b.ws.send('Page.navigate', { url: PAGE });
    let ready = false;
    for (let i = 0; i < 40; i++) {
      await sleep(400);
      ready = await b.evalJs(`!!Array.from(document.querySelectorAll('input')).find(i => i.placeholder && i.placeholder.includes('用户名'))`);
      if (ready === true) break;
    }
    if (ready !== true) { console.log(`    (第 ${attempt} 次：登录表单未出现，重试)`); continue; }

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

    let stable = false;
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      const st = await b.evalJs(`(() => { const t = document.body.innerText || ''; return {
        out: t.includes('退出登录'),
        form: !!Array.from(document.querySelectorAll('input')).find(x => x.placeholder && x.placeholder.includes('用户名')),
      }; })()`);
      if (st && st.out === true && st.form === false) {
        await sleep(3000);
        const still = await b.evalJs(`(document.body.innerText || '').includes('退出登录')`);
        if (still === true) { stable = true; break; }
      }
    }
    if (stable) return 'submitted';
    console.log(`    (第 ${attempt} 次：登录态不稳定，重试)`);
  }
  return 'login-unstable';
}

/** 桌面双击某个图标（按可见文字精确匹配，忽略空白） */
async function dblclickIcon(b, label) {
  return b.evalJs(`(() => {
    const norm = (s) => (s || '').replace(/\\s+/g, '');
    const nodes = Array.from(document.querySelectorAll('div,button')).filter(n => norm(n.textContent) === ${JSON.stringify(label)});
    if (!nodes.length) return 'not-found';
    nodes[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    return 'opened';
  })()`);
}

/** 收集当前文档里所有 `Lv.N` 徽标（PetSprite 的等级 span；level 与 "Lv." 是相邻文本节点，故读 textContent） */
const COLLECT_BADGES = `(() => {
  const out = [];
  document.querySelectorAll('span, div, p').forEach(n => {
    if (n.children.length) return;                 // 只取叶子节点，避免把整块容器的文本算进来
    const t = (n.textContent || '').trim();
    if (/^Lv\\.\\d+$/.test(t)) out.push(t);
  });
  return Array.from(new Set(out));
})()`;

(async () => {
  const db = await mysql.createConnection(DB);
  let b = null;
  let probeSnapshot = null;   // 探针前的 (id, 等级, 成长值) 快照
  let probeTempRow = null;    // 该学生原本没有宠物行时，临时插的那一行
  let probeRaised = false;    // 等级是否处于被探针抬高的状态

  try {
    // ==================== A. 数据 / 任务指标层 ====================
    section('A1. 迁移 101/102 已应用 + 数据不再漂移');
    const [migs] = await db.query(
      "SELECT version FROM schema_migrations WHERE version LIKE '101%' OR version LIKE '102%' ORDER BY version");
    ok('迁移 101_sync_pet_level 已应用', migs.some((m) => /^101/.test(m.version)),
      migs.map((m) => m.version).join(','));
    ok('迁移 102_dedup_student_pets 已应用', migs.some((m) => /^102/.test(m.version)),
      migs.map((m) => m.version).join(','));

    // 102 的产物：一人一行（唯一约束 + 脏数据已清）
    const [dupRows] = await db.query(`
      SELECT student_id, COUNT(*) AS c FROM student_pets GROUP BY student_id HAVING c > 1`);
    ok('★ 每个学生只有一行宠物（重复行已清）', dupRows.length === 0,
      dupRows.length ? JSON.stringify(dupRows) : '多行学生 0 人');
    const [ukIdx] = await db.query(
      "SHOW INDEX FROM student_pets WHERE Key_name = 'uk_student_pet'");
    ok('★ student_pets 有 UNIQUE(student_id) 约束（数据库兜底，杜绝再插重复行）',
      ukIdx.length > 0 && Number(ukIdx[0].Non_unique) === 0,
      ukIdx.length ? ('列=' + ukIdx.map((r) => r.Column_name).join(',')) : '索引不存在');

    const [[mis]] = await db.query(`
      SELECT COUNT(*) AS c FROM profiles p
       WHERE p.role = 'student'
         AND NOT (COALESCE(p.pet_level, 1)
                  <=> COALESCE((SELECT MAX(growth_level) FROM student_pets sp WHERE sp.student_id = p.id), 1))`);
    ok('★ profiles.pet_level 与真源全库一致（不再有卡死的旧值）', Number(mis.c) === 0,
      '不一致 ' + mis.c + ' 人');

    const [[aRow]] = await db.query(`
      SELECT p.id AS uid, p.pet_level AS prof_level,
             (SELECT MAX(growth_level) FROM student_pets sp WHERE sp.student_id = p.id) AS real_level
        FROM profiles p WHERE p.username = ? LIMIT 1`, [STUDENT.u]);
    ok(`学生 ${STUDENT.u} 存在且已领养`, !!aRow && !!aRow.real_level,
      aRow ? ('profiles=' + aRow.prof_level + ' / 真源=' + aRow.real_level) : 'n/a');
    const aLevel = aRow && aRow.real_level ? Number(aRow.real_level) : 1;
    ok(`学生 ${STUDENT.u} 的真源等级 > max_stage(5)（下面才能验「不封顶」）`, aLevel > 5,
      '实测 ' + aLevel + ' 级');

    section('A2. 任务系统 pet_level 指标 = 真源等级（★ 修复点②）');
    const def = metrics.getMetricDef('pet_level');
    ok('指标存在', !!def, def ? def.label : 'n/a');
    ok('指标口径说明已改为读 student_pets（不再写 profiles.pet_level）',
      !!def && /student_pets/.test(def.hint) && !/profiles\.pet_level/.test(def.hint),
      def ? def.hint : '');

    const pa = await metrics.getProgress(db, 'pet_level', aRow.uid, {});
    ok('★ 指标值与真源 growth_level 完全一致', Number(pa.value) === aLevel,
      '指标=' + pa.value + ' / 真源=' + aLevel);
    ok('★ 指标没有被截断到 5（等级无上限）', aLevel <= 5 || Number(pa.value) === aLevel,
      '指标=' + pa.value);

    const [[bRow]] = await db.query(`
      SELECT p.id AS uid,
             (SELECT COUNT(*) FROM student_pets sp WHERE sp.student_id = p.id) AS pet_cnt,
             (SELECT MAX(growth_level) FROM student_pets sp WHERE sp.student_id = p.id) AS real_level
        FROM profiles p WHERE p.username = ? LIMIT 1`, [PROBE_STUDENT]);
    const bId = bRow ? bRow.uid : '';
    const bMaxBefore = bRow && bRow.real_level ? Number(bRow.real_level) : 1;
    ok(`探针学生 ${PROBE_STUDENT} 可用（宠物等级 ${bMaxBefore} 级）`,
      !!bRow, bRow ? ('id=' + bId + ' / 宠物行 ' + bRow.pet_cnt + ' 行 / 等级 ' + bMaxBefore) : 'n/a');

    section('A3. 临时探针：把该学生等级抬到 12 级，验证指标不被截断（★ 修复点②实测）');
    // ⛔ 口径（老师 2026-10-14 明确）：宠物等级是**学生级的唯一值**，不存在「几只不同等级的宠物」，
    //    多行只是同一份等级（+ 各自选的形态）。所以探针**不是**再塞一只 12 级宠物，
    //    而是把这个学生的宠物等级临时抬到 12 —— 这才是真实建模。
    // ⛔ 探针规范：先快照 → finally 还原 → 末尾「不留痕」断言。
    probeSnapshot = (await db.query(
      'SELECT id, growth_level, growth_value FROM student_pets WHERE student_id = ?', [bId]))[0]
      .map((r) => ({ id: r.id, lv: r.growth_level, gv: r.growth_value }));
    if (probeSnapshot.length === 0) {
      await db.query(
        'INSERT INTO student_pets (id, student_id, pet_id, growth_level, growth_value) VALUES (?, ?, ?, 1, 0)',
        [PROBE_PET_ID, bId, 'probe']);
      probeTempRow = PROBE_PET_ID;
      probeSnapshot = [{ id: PROBE_PET_ID, lv: 1, gv: 0 }];
    }
    await db.query('UPDATE student_pets SET growth_level = ? WHERE student_id = ?', [PROBE_LEVEL, bId]);
    probeRaised = true;

    const pb = await metrics.getProgress(db, 'pet_level', bId, {});
    ok(`${PROBE_LEVEL} 级 → 指标返回 ${PROBE_LEVEL}（不是 5）`, Number(pb.value) === PROBE_LEVEL,
      '指标=' + pb.value);
    ok('阶段换算仍是 min(等级,5)=5（等级与阶段分离，形态才分档）', Math.min(PROBE_LEVEL, 5) === 5);

    // 还原
    for (const r of probeSnapshot) {
      await db.query('UPDATE student_pets SET growth_level = ?, growth_value = ? WHERE id = ?', [r.lv, r.gv, r.id]);
    }
    probeRaised = false;
    if (probeTempRow) {
      await db.query('DELETE FROM student_pets WHERE id = ?', [probeTempRow]);
      probeTempRow = null;
    }
    const pb2 = await metrics.getProgress(db, 'pet_level', bId, {});
    ok(`还原后指标回落到 ${bMaxBefore} 级（探针无残影）`,
      Number(pb2.value) === bMaxBefore, '指标=' + pb2.value);

    section('A4. 口径护栏：等级是学生级唯一值');
    const [[divRow]] = await db.query(`
      SELECT COUNT(*) AS c FROM (
        SELECT student_id FROM student_pets GROUP BY student_id HAVING COUNT(DISTINCT growth_level) > 1
      ) t`);
    ok('★ 全库不存在「同一学生多个宠物等级」（等级是学生级唯一值）', Number(divRow.c) === 0,
      '异常 ' + divRow.c + ' 人');

    // 源码级护栏：feed-pet 必须按 student_id 刷等级，不能只改单行（否则历史重复行会分叉出两个等级）
    const idxSrc = require('fs').readFileSync(
      require('path').join(__dirname, '..', '..', 'src', 'index.js'), 'utf8');
    const feedBlock = idxSrc.slice(idxSrc.indexOf("app.post('/api/business/feed-pet'"));
    ok('★ feed-pet 按 student_id 更新宠物等级（不是按行 id）',
      /UPDATE student_pets\s+SET growth_value = \?, growth_level = \?\s+WHERE student_id = \?/.test(feedBlock),
      '见 backend/src/index.js 的 feed-pet 事务');

    // ==================== B. 前端 UI ====================
    if (SKIP_UI) {
      section('B. 前端 UI —— 已跳过（--no-ui）');
    } else {
      section('B. ★ 学生桌面「练习」窗口的 Lv. 徽标（★ 修复点①）');
      b = await launchHeadless({ port: 9455 });
      const login = await loginAs(b, STUDENT.u, STUDENT.p);
      ok('以学生身份登录成功', login === 'submitted', login);

      // 双击桌面的「练习」图标
      const opened = await dblclickIcon(b, '练习');
      ok('双击桌面「练习」图标', opened === 'opened', opened);
      await sleep(1500);

      // ⛔ 练习窗口默认停在「练习设置」页，PetCompanion 只在答题页渲染。
      //    不点「开始练习」就永远抓不到 `Lv.` 徽标（这是上一版脚本 3 条失败的真根因）。
      let started = 'not-found';
      for (let i = 0; i < 10; i++) {
        started = await b.evalJs(`(() => {
          const norm = (s) => (s || '').replace(/\\s+/g, '');
          const btns = Array.from(document.querySelectorAll('button')).filter(n => norm(n.textContent) === '开始练习');
          if (!btns.length) return 'not-found';
          if (btns[0].disabled) return 'disabled';
          btns[0].click();
          return 'started';
        })()`);
        if (started !== 'not-found') break;
        await sleep(600);
      }
      ok('点击「开始练习」进入答题页（PetCompanion 只在这里渲染）', started === 'started', started);

      // 等 PetSprite 的 Lv. 徽标出现（练习窗口右侧窄栏里的 PetCompanion）
      let badges = [];
      for (let i = 0; i < 40; i++) {
        await sleep(500);
        badges = await b.evalJs(COLLECT_BADGES);
        if (Array.isArray(badges) && badges.length) break;
      }
      ok('练习窗口里出现了 Lv. 徽标', Array.isArray(badges) && badges.length > 0,
        JSON.stringify(badges));

      ok(`★ 徽标显示的是真实等级 Lv.${aLevel}（不是封顶的 Lv.5）`,
        Array.isArray(badges) && badges.includes('Lv.' + aLevel),
        JSON.stringify(badges) + ' / 期望含 Lv.' + aLevel);
      ok('★ 没有出现被截断的 Lv.5',
        !(Array.isArray(badges) && aLevel > 5 && badges.includes('Lv.5')),
        JSON.stringify(badges));

      // 顺带看一眼萌宠模块（基准面）显示的等级，应与练习页一致
      const petOpen = await dblclickIcon(b, '萌宠');
      if (petOpen === 'opened') {
        await sleep(2500);
        const petBadge = await b.evalJs(`(() => {
          const t = document.body.innerText || '';
          const m = t.match(/Lv\\.(\\d+)\\s*(幼年期|成长期|成熟期|完全体|究极体)/);
          return m ? (m[1] + '|' + m[2]) : '';
        })()`);
        const [lv, stage] = String(petBadge || '').split('|');
        const petLevels = await b.evalJs(COLLECT_BADGES);
        ok('萌宠模块显示的真实等级与练习页一致', lv === String(aLevel),
          '萌宠=' + lv + ' / 练习=' + aLevel + ' / 徽标=' + JSON.stringify(petLevels));
        ok('萌宠模块的阶段名 = min(等级,5) 对应阶段（究极体）',
          aLevel <= 5 || stage === '究极体', '阶段=' + stage);
      } else {
        ok('双击桌面「萌宠」图标', false, petOpen);
      }

      // ---------- C. 领养已废除 → 账号启用即自动随机选一只，且必须幂等 ----------
      section('C. ★ 「自动选一只」幂等护栏（领养已废除）');
      // 用页面里的 token 以学生 a 自己身份调两次 ensure-pet。
      // a 本来就有宠物 → 两次都应 created:false，且行数不变（这正是「每次挂载都自动确保」的路径，
      // 也是以前 PetModule + DesktopPet 并发插出重复行的路径）。
      const beforeCnt = Number((await db.query(
        'SELECT COUNT(*) AS c FROM student_pets WHERE student_id = ?', [aRow.uid]))[0][0].c);
      const ensureRes = await b.evalJs(`(async () => {
        const tk = localStorage.getItem('xgpy_token');
        // 后端在 3101，前端 dev 在 3266 —— 优先直连后端，失败再退回相对路径（走 dev 代理）
        const call = async (base) => {
          const r = await fetch(base + '/api/business/ensure-pet', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk },
            body: JSON.stringify({}),
          });
          return r.json();
        };
        let r1, r2;
        try { r1 = await call('http://127.0.0.1:3101'); r2 = await call('http://127.0.0.1:3101'); }
        catch (e) { r1 = await call(''); r2 = await call(''); }
        return {
          c1: !!(r1 && r1.data && r1.data.created),
          c2: !!(r2 && r2.data && r2.data.created),
          e1: r1 && r1.error, e2: r2 && r2.error,
        };
      })()`);
      const afterCnt = Number((await db.query(
        'SELECT COUNT(*) AS c FROM student_pets WHERE student_id = ?', [aRow.uid]))[0][0].c);
      ok('连续两次 ensure-pet 都没报错', ensureRes && !ensureRes.e1 && !ensureRes.e2,
        JSON.stringify(ensureRes));
      ok('★ 已有宠物时 ensure-pet 幂等（两次都 created:false）',
        ensureRes && ensureRes.c1 === false && ensureRes.c2 === false, JSON.stringify(ensureRes));
      ok('★ 连续两次调用后宠物行数不变（不会插出重复行）', beforeCnt === afterCnt,
        beforeCnt + ' → ' + afterCnt);

      // 源码级护栏：前端两处自动创建都必须走幂等端点，不能再各自 insert student_pets
      const fs = require('fs');
      const path = require('path');
      const pmSrc = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'frontend', 'src',
        'components', 'student', 'PetModule.tsx'), 'utf8');
      const dpSrc = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'frontend', 'src',
        'components', 'common', 'DesktopPet.tsx'), 'utf8');
      ok('★ PetModule 改用 businessEnsurePet（不再自己 insert student_pets）',
        /businessEnsurePet/.test(pmSrc) && !/from\('student_pets'\)\.insert/.test(
          pmSrc.slice(pmSrc.indexOf('const fetchData'), pmSrc.indexOf('const getPetImage'))),
        '见 PetModule.fetchData');
      ok('★ DesktopPet 改用 businessEnsurePet（不再自己 insert student_pets）',
        /businessEnsurePet/.test(dpSrc) && !/from\('student_pets'\)\.insert/.test(
          dpSrc.slice(dpSrc.indexOf('const fetchPetData'), dpSrc.indexOf('const fetchPetData') + 2600)),
        '见 DesktopPet.fetchPetData');
    }
  } catch (err) {
    fail++;
    console.log('  ✗ 脚本异常：' + (err && err.message ? err.message : err));
    console.error(err);
  } finally {
    // ---------- 还原 + 不留痕断言 ----------
    try {
      if (probeRaised && probeSnapshot) {
        for (const r of probeSnapshot) {
          await db.query('UPDATE student_pets SET growth_level = ?, growth_value = ? WHERE id = ?', [r.lv, r.gv, r.id]);
        }
        console.log('\n[还原] 探针抬高的宠物等级已回滚');
      }
      if (probeTempRow) {
        await db.query('DELETE FROM student_pets WHERE id = ?', [probeTempRow]);
        console.log('[还原] 探针临时宠物行已删除');
      }
      const [[left]] = await db.query('SELECT COUNT(*) AS c FROM student_pets WHERE id = ?', [PROBE_PET_ID]);
      ok('★ 不留痕：探针临时行已清干净', Number(left.c) === 0, '残留 ' + left.c);
      const [[mis2]] = await db.query(`
        SELECT COUNT(*) AS c FROM profiles p
         WHERE p.role = 'student'
           AND NOT (COALESCE(p.pet_level, 1)
                    <=> COALESCE((SELECT MAX(growth_level) FROM student_pets sp WHERE sp.student_id = p.id), 1))`);
      ok('★ 不留痕：profiles.pet_level 仍与真源一致', Number(mis2.c) === 0, '不一致 ' + mis2.c);
    } catch (e) {
      console.log('[还原] 出错：' + e.message);
    }
    try { if (b && b.close) await b.close(); } catch (e) { /* ignore */ }
    await db.end().catch(() => {});
    console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
