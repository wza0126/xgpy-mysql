/**
 * smoke_mastered_qualification.cjs
 *
 * 目的：验证「已掌握题数认证」（v2.6.5 新增）在普通测试与试卷PK上的正确性。
 *
 * 新需求：在两处原有「做对题数」资格之外，再加一项「已掌握题数」资格：
 *   - 可指定一级类目范围（默认全部范围，如选中「数据与信息」则统计该章全部小节）
 *   - 已掌握数达到阈值
 *   - 两项条件必须**同时满足**才能参加普通测试和 PK 对战
 *
 * 本脚本分三层验证：
 *   A. 数据库结构与迁移 —— 两个表的新列确实存在（列透明，导入导出无需改 DOMAIN_DEFS）
 *   B. 统计口径 —— 真造数据验证「按一级类目含小节」的掌握数统计与服务端口径一致
 *   C. 判定矩阵 —— 两条件各种组合下的 passed 结果
 *   D. 源码接线 —— 关键接线点存在，防止将来重构把服务端校验删掉
 *
 * 重要前提：
 *   - 只对当前连接的库做只读 + 临时造数，结束时清理自己造的数据。
 *   - 需要后端在跑（默认 127.0.0.1:3101）才能验证接口层。
 *
 * 用法：node scripts/debug/smoke_mastered_qualification.cjs
 */

const path = require('path');
const fs = require('fs');
const pool = require('../../src/db');

const BASE = process.env.XGPY_BASE || 'http://127.0.0.1:3101';
const BACKEND = path.join(__dirname, '..', '..');
const FRONTEND = path.join(BACKEND, '..', 'frontend');

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; failures.push(name); console.log('  ❌ ' + name + (detail ? '  ' + detail : '')); }
}
function section(t) { console.log('\n【' + t + '】'); }

const readSrc = (rel) => fs.readFileSync(path.join(BACKEND, rel), 'utf8');
const readFe = (rel) => fs.readFileSync(path.join(FRONTEND, rel), 'utf8');

// ── 被测口径的独立实现（与后端 getMasteredCountInClusters 逻辑同构，用于交叉验证）──
function primaryOf(clusterId) {
  const s = String(clusterId || '');
  return s.includes('/') ? s.split('/')[0] : s;
}

async function main() {
  // ══ A. 数据库结构与迁移 ═══════════════════════════════════════════════
  section('A. 数据库结构与迁移');

  for (const t of ['tests', 'pk_battle_configs']) {
    const [cols] = await pool.query(`SHOW COLUMNS FROM ${t}`);
    const names = cols.map(c => c.Field);
    ok(`${t} 有 qualification_mastered_count 列`, names.includes('qualification_mastered_count'));
    ok(`${t} 有 qualification_mastered_clusters 列`, names.includes('qualification_mastered_clusters'));
    ok(`${t} 保留原 qualification_correct_count 列`, names.includes('qualification_correct_count'));
    // 新列必须可空（NULL = 不启用），否则老数据会受影响
    const mc = cols.find(c => c.Field === 'qualification_mastered_count');
    ok(`${t}.qualification_mastered_count 允许 NULL`, mc && mc.Null === 'YES', `Null=${mc?.Null}`);
  }

  const mig = readSrc('src/embedded-migrations.js');
  ok('迁移 085 已内嵌', mig.includes('085_add_mastered_qualification'));
  ok('迁移 085 同时改两张表', /ALTER TABLE `tests`[\s\S]*ALTER TABLE `pk_battle_configs`/.test(
    fs.readFileSync(path.join(BACKEND, 'database/migrations/085_add_mastered_qualification.sql'), 'utf8')
  ));

  // ══ B. 统计口径 ═══════════════════════════════════════════════════════
  section('B. 已掌握题数统计口径（按一级类目含全部小节）');

  // 取掌握阈值（与练习模块同源）
  const [cfgRows] = await pool.query(
    "SELECT value FROM system_config WHERE config_key = 'master_question_threshold' LIMIT 1"
  );
  let threshold = 3;
  if (cfgRows.length) {
    let v = cfgRows[0].value;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch {} }
    const p = parseInt(typeof v === 'object' && v !== null ? v.value : v, 10);
    if (Number.isFinite(p) && p > 0) threshold = p;
  }
  console.log(`  ℹ️  掌握阈值 master_question_threshold = ${threshold}`);

  // 优先用已知口令的 E2E 账号（a/111111）做接口层严格比对；否则降级为只做库内口径核对
  const E2E_USER = process.env.XGPY_STUDENT_USER || 'a';
  const E2E_PWD = process.env.XGPY_STUDENT_PWD || '111111';
  let studentId = null;
  let studentName = null;
  {
    const [pref] = await pool.query('SELECT id, username FROM profiles WHERE username = ? LIMIT 1', [E2E_USER]);
    if (pref.length) { studentId = pref[0].id; studentName = pref[0].username; }
  }
  if (!studentId) {
    const [stuRows] = await pool.query(
      "SELECT id, username FROM profiles WHERE role='student' ORDER BY created_at LIMIT 5"
    );
    if (stuRows.length) { studentId = stuRows[0].id; studentName = stuRows[0].username; }
  }

  if (!studentId) {
    ok('库中存在学生账号（用于口径验证）', false, '无学生账号，跳过 B 段实测');
  } else {
    console.log(`  ℹ️  取学生 ${studentName} (${studentId}) 做实测`);

    // 独立算出「该生已掌握题 → 一级类目分布」
    const [mRows] = await pool.query(
      `SELECT q.cluster_id AS cid, m.question_id AS qid FROM (
         SELECT question_id FROM student_answers
         WHERE student_id = ? AND source = 'practice' AND is_correct = 1
         GROUP BY question_id HAVING COUNT(*) >= ?
       ) m JOIN questions q ON q.id = m.question_id
       WHERE q.cluster_id IS NOT NULL AND q.cluster_id <> ''`,
      [studentId, threshold]
    );
    const totalMastered = mRows.length;
    const byPrimary = new Map();
    for (const r of mRows) {
      const p = primaryOf(r.cid);
      byPrimary.set(p, (byPrimary.get(p) || 0) + 1);
    }
    console.log(`  ℹ️  该生已掌握题总数=${totalMastered}，分布=${JSON.stringify([...byPrimary])}`);

    // 用真实存在的 PK 配置做接口层比对
    const [cfgs] = await pool.query('SELECT id FROM pk_battle_configs LIMIT 1');
    if (cfgs.length) {
      const cid = cfgs[0].id;
      const [orig] = await pool.query(
        'SELECT qualification_correct_count, qualification_mastered_count, qualification_mastered_clusters FROM pk_battle_configs WHERE id = ?',
        [cid]
      );
      const token = await loginStudent(studentName, E2E_PWD);
      try {
        await pool.query(
          `UPDATE pk_battle_configs SET qualification_correct_count = NULL,
             qualification_mastered_count = 1, qualification_mastered_clusters = NULL WHERE id = ?`,
          [cid]
        );
        if (token) {
          const res = await apiGet(`/api/student/qualification/pk/${cid}`, token);
          const cur = res?.data?.mastered?.current;
          ok('接口返回的「全部范围已掌握数」与该生实际掌握总数一致',
            cur === totalMastered, `接口=${cur} 实测=${totalMastered}`);

          // 选一个真实存在的一级类目，验证"含小节"口径
          const primaries = [...byPrimary.keys()];
          if (primaries.length > 0) {
            const pick = primaries[0];
            const expect = byPrimary.get(pick);
            await pool.query(
              `UPDATE pk_battle_configs SET qualification_mastered_clusters = ? WHERE id = ?`,
              [JSON.stringify([pick]), cid]
            );
            const res2 = await apiGet(`/api/student/qualification/pk/${cid}`, token);
            const cur2 = res2?.data?.mastered?.current;
            ok(`选中「${pick}」时只统计该章（含小节）的掌握数`,
              cur2 === expect, `接口=${cur2} 实测=${expect}`);
            // 多选类目应等于各自之和
            if (primaries.length > 1) {
              const pair = primaries.slice(0, 2);
              const expectSum = pair.reduce((s, p) => s + byPrimary.get(p), 0);
              await pool.query(
                `UPDATE pk_battle_configs SET qualification_mastered_clusters = ? WHERE id = ?`,
                [JSON.stringify(pair), cid]
              );
              const res3 = await apiGet(`/api/student/qualification/pk/${cid}`, token);
              ok('多选一级类目时掌握数按各章求和',
                res3?.data?.mastered?.current === expectSum,
                `接口=${res3?.data?.mastered?.current} 实测=${expectSum}`);
            }
            const hasSub = mRows.some(r => primaryOf(r.cid) === pick && String(r.cid).includes('/'));
            if (hasSub) {
              ok(`「${pick}」的掌握数确实包含挂在小节下的题（非仅章级）`, cur2 > 0,
                `该章掌握数=${cur2}`);
            }
          }

          // 判定矩阵：阈值设成超过实际值 → passed 必须为 false；设成 1 → true
          await pool.query(
            `UPDATE pk_battle_configs SET qualification_mastered_count = ?,
               qualification_mastered_clusters = NULL WHERE id = ?`,
            [totalMastered + 999, cid]
          );
          const resHigh = await apiGet(`/api/student/qualification/pk/${cid}`, token);
          ok('阈值高于当前掌握数时 passed=false',
            resHigh?.data?.passed === false, `passed=${resHigh?.data?.passed}`);
          await pool.query(
            `UPDATE pk_battle_configs SET qualification_mastered_count = 1 WHERE id = ?`, [cid]
          );
          const resLow = await apiGet(`/api/student/qualification/pk/${cid}`, token);
          ok('阈值低于当前掌握数时 passed=true',
            resLow?.data?.passed === true, `passed=${resLow?.data?.passed}`);

          // 两条件 AND：做对题数故意设超高 → 即便掌握达标也必须 false
          await pool.query(
            `UPDATE pk_battle_configs SET qualification_correct_count = 999999,
               qualification_mastered_count = 1 WHERE id = ?`, [cid]
          );
          const resAnd = await apiGet(`/api/student/qualification/pk/${cid}`, token);
          ok('做对题数不达标时，总体 passed 必须为 false（AND 关系）',
            resAnd?.data?.passed === false
            && resAnd?.data?.correct?.passed === false
            && resAnd?.data?.mastered?.passed === true,
            `passed=${resAnd?.data?.passed} correctPassed=${resAnd?.data?.correct?.passed} masteredPassed=${resAnd?.data?.mastered?.passed}`);
        } else {
          console.log('  ⚠️  学生登录失败（无可用口令），跳过接口层口径比对');
        }
      } finally {
        await pool.query(
          `UPDATE pk_battle_configs SET qualification_correct_count = ?,
             qualification_mastered_count = ?, qualification_mastered_clusters = ? WHERE id = ?`,
          [orig[0].qualification_correct_count, orig[0].qualification_mastered_count,
           orig[0].qualification_mastered_clusters, cid]
        );
      }
    } else {
      console.log('  ⚠️  无 PK 配置，跳过接口层口径比对');
    }
  }

  // ══ C. 判定矩阵（源码级：确认两条件是 AND 关系）═══════════════════════
  section('C. 资格判定矩阵（两项条件 AND）');

  const idxSrc = readSrc('src/index.js');
  const handlerSrc = readSrc('src/pk-socket/handler.js');

  // index.js 的 checkQualification
  ok('index.js 定义 checkQualification（服务端唯一裁定处）',
    /async function checkQualification\(studentId, rule\)/.test(idxSrc));
  ok('index.js 判定为 AND（correctPassed && masteredPassed）',
    /passed:\s*correctPassed\s*&&\s*masteredPassed/.test(idxSrc));
  ok('index.js 有按一级类目统计掌握数的函数',
    /async function getMasteredCountInClusters\(/.test(idxSrc));
  ok('index.js 口径取 cluster_id 的 "/" 前缀（含小节）',
    /cid\.includes\('\/'\)\s*\?\s*cid\.split\('\/'\)\[0\]\s*:\s*cid/.test(idxSrc));
  ok('index.js 掌握阈值来源与练习模块同源（getMasterThreshold）',
    /master_question_threshold/.test(idxSrc));

  // handler.js（PK socket）
  ok('handler.js 的 checkQualification 也判两项 AND',
    /const correctOk = required <= 0 \|\| correct >= required;/.test(handlerSrc)
    && /const masteredOk = masteredRequired <= 0 \|\| mastered >= masteredRequired;/.test(handlerSrc));
  ok('handler.js 加载配置时带上新字段',
    /qualification_mastered_count,\s*qualification_mastered_clusters/.test(handlerSrc));
  ok('handler.js 掌握阈值与练习同源', /master_question_threshold/.test(handlerSrc));

  // ══ B2. 类目可练习题量接口（教师端设置上限的参考值）═════════════════════
  section('B2. 类目可练习题量接口');

  // 独立算出 practice_enabled=1 的题量分布，与接口比对
  const [pcRows] = await pool.query(
    `SELECT cluster_id, COUNT(*) AS cnt FROM questions
     WHERE practice_enabled = 1 AND cluster_id IS NOT NULL AND cluster_id <> ''
     GROUP BY cluster_id`
  );
  const expectPrimary = {};
  let expectTotal = 0;
  for (const r of pcRows) {
    const cid = String(r.cluster_id);
    const p = primaryOf(cid);
    expectPrimary[p] = (expectPrimary[p] || 0) + Number(r.cnt);
    expectTotal += Number(r.cnt);
  }
  console.log(`  ℹ️  实测可练习题总量=${expectTotal}，分布=${JSON.stringify(expectPrimary)}`);

  const teacherToken = await loginUser('teacher', 'xgpy666');
  if (teacherToken) {
    const cntRes = await apiGet('/api/teacher/qualification/counts', teacherToken);
    const d = cntRes?.data;
    ok('教师端题量接口可访问', !!d, JSON.stringify(cntRes).slice(0, 120));
    if (d) {
      ok('总数与实测一致', d.total === expectTotal, `接口=${d.total} 实测=${expectTotal}`);
      let mismatch = 0;
      for (const k of Object.keys(expectPrimary)) {
        if ((d.by_primary[k] || 0) !== expectPrimary[k]) mismatch++;
      }
      ok('各一级类目题量逐一一致', mismatch === 0, `不一致=${mismatch} 项`);
      ok('接口不含未命中的多余类目',
        Object.keys(d.by_primary || {}).every(k => expectPrimary[k] !== undefined));
      // 关键：题量必须只统计 practice_enabled=1，否则会大于"可掌握"上限
      const [allRows] = await pool.query('SELECT COUNT(*) n FROM questions');
      ok('题量口径确实排除了不可练习题（小于全库题数）',
        d.total < (Number(allRows[0]?.n) || 0),
        `可练=${d.total} 全库=${allRows[0]?.n}`);
    }
  } else {
    console.log('  ⚠️  教师登录失败，跳过题量接口比对');
  }

  // ══ D. 接线：服务端硬校验 + 前端展示 ══════════════════════════════════
  section('D. 接线检查');

  ok('submit-test 里有服务端资格硬校验',
    /qualification: qualDetail/.test(idxSrc) && /资格不足：需要先/.test(idxSrc));
  ok('PK 匹配处有服务端资格硬校验',
    /code:\s*'qualification'/.test(handlerSrc) && /才能参加对战/.test(handlerSrc));
  ok('新增资格查询接口（单个测试）',
    /\/api\/student\/qualification\/test\/:testId/.test(idxSrc));
  ok('新增资格查询接口（批量测试）',
    /\/api\/student\/qualification\/tests/.test(idxSrc));
  ok('新增资格查询接口（PK 配置）',
    /\/api\/student\/qualification\/pk\/:configId/.test(idxSrc));
  ok('新增教师端类目题量接口（供设置上限参考）',
    /\/api\/teacher\/qualification\/counts/.test(idxSrc));
  ok('题量口径用 practice_enabled=1（与掌握来源一致）',
    /async function getPracticableCountInClusters\(/.test(idxSrc)
    && /WHERE practice_enabled = 1'/.test(idxSrc));
  // 注：断言不要依赖「这两列是 INSERT 列表的最后两项」——迁移 086 之后后面还跟了奖励列。
  ok('PK 教师端接口透传新字段（POST）',
    /INSERT INTO pk_battle_configs[\s\S]{0,600}?qualification_mastered_count, qualification_mastered_clusters/.test(idxSrc)
    && /qualification_mastered_count, qualification_mastered_clusters[\s\S]{0,400}?VALUES \(/.test(idxSrc));
  ok('学生端 battle-configs/active 返回新字段',
    /qualification_mastered_count, qualification_mastered_clusters FROM pk_battle_configs WHERE is_active/.test(idxSrc));

  // 教师端
  const tm = readFe('src/components/teacher/TestManager.tsx');
  ok('TestManager 表单含已掌握题数输入', /qualification_mastered_count/.test(tm));
  ok('TestManager 表单含一级类目多选', /qualification_mastered_clusters/.test(tm));
  ok('TestManager 使用词表渲染一级类目（不硬编码）', /CHAPTER_NAMES/.test(tm));
  const pk = readFe('src/components/teacher/PKBattleConfigTab.tsx');
  ok('PKBattleConfigTab 表单含已掌握题数输入', /qualification_mastered_count/.test(pk));
  ok('PKBattleConfigTab 表单含一级类目多选', /qualification_mastered_clusters/.test(pk));
  ok('PKBattleConfigTab 使用词表渲染一级类目', /CHAPTER_NAMES/.test(pk));

  // 学生端
  const stu = readFe('src/components/student/TestModule.tsx');
  ok('TestModule 拉资格明细走服务端接口',
    /\/api\/student\/qualification\/tests/.test(stu));
  ok('TestModule 用服务端 passed 判定资格不足', /qualEnabled && !qual\.passed/.test(stu));
  ok('TestModule 展示两项条件（做对 + 掌握）',
    /qual\.correct\?\.enabled/.test(stu) && /qual\.mastered\?\.enabled/.test(stu));
  ok('TestModule startTest 内有资格拦截（点击兜底）',
    /qualCheck\.mastered\?\.enabled/.test(stu));
  const lobby = readFe('src/components/student/pk-battle/PKLobby.tsx');
  ok('PKLobby 拉资格明细走服务端接口',
    /\/api\/student\/qualification\/pk\//.test(lobby));
  ok('PKLobby 用服务端 passed 判定', /qual\s*\?\s*qual\.passed/.test(lobby));
  ok('PKLobby 配置卡片展示掌握要求', /qualification_mastered_count/.test(lobby));

  // ══ 汇总 ═════════════════════════════════════════════════════════════
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  通过 ${pass} / ${pass + fail}`);
  if (fail > 0) {
    console.log(`  ❌ 失败 ${fail} 项：`);
    failures.forEach(f => console.log('     - ' + f));
  } else {
    console.log('  ✅ 全部通过');
  }
  console.log(`${'═'.repeat(60)}\n`);
  process.exit(fail > 0 ? 1 : 0);
}

// ── 辅助：登录拿 token（默认用 E2E 账号 a/111111；失败则返回 null，B 段降级）──
async function loginStudent(username, password) {
  const pwd = password || process.env.XGPY_STUDENT_PWD || '111111';
  return loginUser(username, pwd);
}

/** 通用登录（教师/学生） */
async function loginUser(username, password) {
  try {
    const res = await fetch(`${BASE}/api/auth/secure-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, deviceInfo: 'smoke-script' }),
    });
    const j = await res.json();
    return j?.data?.session?.access_token || null;
  } catch {
    return null;
  }
}

async function apiGet(endpoint, token) {
  try {
    const res = await fetch(`${BASE}${endpoint}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return await res.json();
  } catch {
    return null;
  }
}

main().catch((e) => {
  console.error('脚本异常:', e);
  process.exit(2);
});
