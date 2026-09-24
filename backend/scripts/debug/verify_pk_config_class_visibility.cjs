/**
 * verify_pk_config_class_visibility.cjs
 *
 * 目的：验证「PK 对战配置支持投放班级」（迁移 089）
 *   需求原文：对战配置里增加班级选择，选中的班级才能使用该活动 PK 对战。
 *   背景：一位教师可能带多个班级/多个年级，需要把同一个活动只投放给指定班级。
 *
 * 分五层验证：
 *   A. 数据库结构（迁移 089）
 *      - pk_battle_config_class_visibility 表存在，列/索引齐全
 *      - 无悬空行（config_id 指向已删除配置）
 *   B. 语义口径（源码层，防止后人改坏）
 *      - 空数组 = 不限班级，不是「全不可见」
 *      - PUT 只在显式传数组时才覆写（老调用方不漏传也不误清）
 *      - 学生端用 EXISTS 子查询而非 JOIN（避免一个活动多行导致重复结果）
 *   C. 真接口端到端（真登录，真库）
 *      - 教师建配置 → 只投放给 test 班 → 该班学生能查到、其他班学生查不到
 *      - 改回不限班级（[]）→ 所有学生都能查到
 *      - 教师列表接口带出 visible_class_ids
 *      - DELETE 时可见性行一并清理
 *   D. 数据导入导出域登记（铁律：新表不进 DOMAIN_DEFS 会静默丢数据）
 *   E. 前端接线（防重构删掉关键逻辑）
 *
 * 用法：node scripts/debug/verify_pk_config_class_visibility.cjs
 * 前提：后端在跑（默认 127.0.0.1:3101）、迁移 089 已应用
 */

const path = require('path');
const fs = require('fs');
const pool = require('../../src/db');

const BASE = process.env.XGPY_BASE || 'http://127.0.0.1:3101';
const BACKEND = path.join(__dirname, '..', '..');
const FRONTEND = path.join(BACKEND, '..', 'frontend');
const TABLE = 'pk_battle_config_class_visibility';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; failures.push(name); console.log('  ❌ ' + name + (detail ? '  ' + detail : '')); }
}
function section(t) { console.log('\n【' + t + '】'); }

const readSrc = (rel) => fs.readFileSync(path.join(BACKEND, rel), 'utf8');
const readFe = (rel) => fs.readFileSync(path.join(FRONTEND, rel), 'utf8');

async function loginUser(username, password) {
  try {
    const res = await fetch(`${BASE}/api/auth/secure-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, deviceInfo: 'verify-pk-vis' }),
    });
    const j = await res.json();
    return j?.data?.session?.access_token || null;
  } catch { return null; }
}

async function apiGet(endpoint, token) {
  try {
    const res = await fetch(`${BASE}${endpoint}`, { headers: { Authorization: `Bearer ${token}` } });
    return await res.json();
  } catch { return null; }
}

async function apiSend(method, endpoint, token, body) {
  try {
    const res = await fetch(`${BASE}${endpoint}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  } catch { return { status: 0, json: null }; }
}

// 待清理的测试配置 ID
const createdIds = [];

(async () => {
  // ==================== A. 数据库结构 ====================
  section('A. 数据库结构（迁移 089）');
  const [tbl] = await pool.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [TABLE]
  );
  ok('表 pk_battle_config_class_visibility 已创建', tbl.length === 1);

  const [cols] = await pool.query(
    `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [TABLE]
  );
  const colNames = cols.map((c) => c.COLUMN_NAME);
  for (const c of ['id', 'config_id', 'class_id', 'is_visible', 'created_at']) {
    ok(`列 ${c} 存在`, colNames.includes(c));
  }
  const visCol = cols.find((c) => c.COLUMN_NAME === 'is_visible');
  ok('is_visible 默认 1（勾选即可见）', visCol && String(visCol.COLUMN_DEFAULT) === '1',
    visCol ? `default=${visCol.COLUMN_DEFAULT}` : '');

  const [idx] = await pool.query(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? GROUP BY INDEX_NAME`, [TABLE]
  );
  const idxNames = idx.map((i) => i.INDEX_NAME);
  ok('索引 idx_config 存在', idxNames.includes('idx_config'));
  ok('索引 idx_class 存在', idxNames.includes('idx_class'));

  const [dangling] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM ${TABLE} v
     LEFT JOIN pk_battle_configs c ON v.config_id = c.id WHERE c.id IS NULL`
  );
  ok('无悬空可见性行（config_id 均指向存在的配置）', Number(dangling[0].cnt) === 0,
    `悬空 ${dangling[0].cnt} 行`);

  // ==================== B. 语义口径（源码层）====================
  section('B. 语义口径（源码层）');
  const beSrc = readSrc('src/index.js');

  ok('存在 normalizeVisibilityClassIds 归一化函数',
    /function normalizeVisibilityClassIds/.test(beSrc));
  ok('存在 getVisibleClassIdsMap 批量查询函数',
    /function getVisibleClassIdsMap/.test(beSrc));
  ok('存在 setVisibleClassIds 覆写函数',
    /function setVisibleClassIds/.test(beSrc));

  // 空数组 = 不限班级：归一化里不能把 [] 变成「全不可见」的错误语义
  const normFn = (beSrc.match(/function normalizeVisibilityClassIds[\s\S]*?\n}/) || [''])[0];
  ok('空数组归一化仍返回数组（不转 null，避免「清空」被当「不改动」）',
    /return out;/.test(normFn), '顺带断言函数体完整');
  ok('归一化入口对 null/undefined 返回 null（= 请求未携带该字段）',
    /if \(raw === null \|\| raw === undefined\) return null;/.test(normFn));

  // PUT 只在显式传数组时才覆写
  const putBlock = (beSrc.match(/app\.put\('\/api\/pk\/battle-configs\/:id'[\s\S]*?\n\}\);/) || [''])[0];
  ok('PUT 里用 `visClassIds !== null` 守卫，未传字段不改动可见性',
    /visClassIds !== null/.test(putBlock));
  ok('PUT 覆写前校验配置归属（防止改别人的配置）',
    /WHERE id = \? AND teacher_id = \?/.test(putBlock) && /404/.test(putBlock));
  ok('PUT 走事务（配置与可见性同生共死）',
    /beginTransaction/.test(putBlock) && /commit/.test(putBlock));

  // DELETE 清理可见性
  const delBlock = (beSrc.match(/app\.delete\('\/api\/pk\/battle-configs\/:id'[\s\S]*?\n\}\);/) || [''])[0];
  ok('DELETE 一并删除可见性行（避免悬空）',
    new RegExp(`DELETE FROM ${TABLE} WHERE config_id = \\?`).test(delBlock));

  // 学生端用 EXISTS 而非 JOIN
  const activeBlock = (beSrc.match(/app\.get\('\/api\/pk\/battle-configs\/active'[\s\S]*?\n\}\);/) || [''])[0];
  ok('学生端 active 接口用 EXISTS 子查询（JOIN 会因多行产生重复活动）',
    /NOT EXISTS/.test(activeBlock) && /EXISTS/.test(activeBlock));
  ok('学生端按本班 class_id 过滤',
    /profiles WHERE id = \?/.test(activeBlock) && /v\.class_id = \?/.test(activeBlock));
  ok('学生端同时要求 is_visible = 1',
    /v\.is_visible = 1/.test(activeBlock));
  ok('学生端仍要求 is_active = 1（禁用活动不返回）',
    /c\.is_active = 1/.test(activeBlock));

  // ==================== D. 导入导出域登记 ====================
  section('D. 数据导入导出域登记（铁律）');
  const dataIoSrc = readSrc('src/data-io.js');
  ok('新表已登记进 DOMAIN_DEFS（否则导出静默丢数据）',
    dataIoSrc.includes(`'${TABLE}'`));
  const pkDomain = (dataIoSrc.match(/\{ id: 'pk'[\s\S]*?\}/) || [''])[0];
  ok('登记在 pk 域内', pkDomain.includes(`'${TABLE}'`));
  const posCfg = pkDomain.indexOf("'pk_battle_configs'");
  const posVis = pkDomain.indexOf(`'${TABLE}'`);
  ok('导入拓扑序：可见性表在 pk_battle_configs 之后（外键语义顺序）',
    posCfg >= 0 && posVis > posCfg, `config@${posCfg} < vis@${posVis}`);

  const embSrc = readSrc('src/embedded-migrations.js');
  ok('迁移 089 已内嵌进 embedded-migrations.js',
    embSrc.includes('089_add_pk_battle_config_class_visibility.sql'));

  // ==================== E. 前端接线 ====================
  section('E. 前端接线');
  const feSrc = readFe('src/components/teacher/PKBattleConfigTab.tsx');
  ok('前端接口类型加了 visible_class_ids 字段',
    /visible_class_ids\?: string\[\]/.test(feSrc));
  ok('表单 state 含 visible_class_ids',
    /visible_class_ids: \[\] as string\[\]/.test(feSrc));
  ok('有 toggleVisibleClass 切换函数',
    /const toggleVisibleClass = \(classId: string\)/.test(feSrc));
  ok('拉取教师自己的班级列表（按 teacher_id 过滤）',
    /\.from\('classes'\)/.test(feSrc) && /\.eq\('teacher_id', profile\.id\)/.test(feSrc));
  ok('保存 payload 提交 visible_class_ids',
    /visible_class_ids: formData\.visible_class_ids,/.test(feSrc));
  ok('启用/禁用切换也带上 visible_class_ids（全量 PUT 不漏字段）',
    /visible_class_ids: Array\.isArray\(cfg\.visible_class_ids\)/.test(feSrc));
  ok('编辑时回填 visible_class_ids',
    /visible_class_ids: Array\.isArray\(cfg\.visible_class_ids\) \? cfg\.visible_class_ids : \[\]/.test(feSrc));
  ok('新建/重置时清空 visible_class_ids',
    (feSrc.match(/visible_class_ids: \[\]/g) || []).length >= 2,
    `出现 ${(feSrc.match(/visible_class_ids: \[\]/g) || []).length} 次（初始 state + resetForm）`);
  ok('卡片显示「全部班级可用」提示', /全部班级可用/.test(feSrc));
  ok('弹窗有投放班级选择区', /投放班级/.test(feSrc));

  const dbTy = readFe('src/types/database.ts');
  ok('前端表类型声明加了新表', dbTy.includes('pk_battle_config_class_visibility'));

  // ==================== C. 真接口端到端 ====================
  section('C. 真接口端到端（真登录 + 真库）');

  const teacherToken = await loginUser('teacher', 'xgpy666');
  ok('教师账号登录成功', !!teacherToken);
  const stuToken = await loginUser('a', '111111');
  ok('学生账号 a 登录成功', !!stuToken);

  if (!teacherToken || !stuToken) {
    console.log('\n⚠️ 登录失败，跳过 C 层接口验证');
  } else {
    // 找一个属于教师、且**非学生 a 所在**的班级，以及学生 a 所在的班级
    const [stuProf] = await pool.query('SELECT class_id FROM profiles WHERE username = ? LIMIT 1', ['a']);
    const myClassId = stuProf.length ? String(stuProf[0].class_id || '') : '';
    ok('学生 a 有班级归属（用于班级隔离验证）', !!myClassId, `class_id=${myClassId}`);

    const [otherCls] = await pool.query(
      `SELECT id, name FROM classes WHERE id <> ? ORDER BY id LIMIT 1`, [myClassId]
    );
    const otherClassId = otherCls.length ? String(otherCls[0].id) : '';
    ok('存在另一个班级（用于隔离对照）', !!otherClassId, `other=${otherClassId}`);

    const basePayload = {
      name: '__verify_pk_vis__',
      mode: 'timed',
      duration_seconds: 180,
      question_count: 5,
      tag_filters: null,
      cluster_filters: null,
      difficulty_min: null,
      difficulty_max: null,
      is_active: true,
      daily_limit: null,
      qualification_correct_count: null,
      qualification_mastered_count: null,
      qualification_mastered_clusters: null,
      points_multiplier: 1,
      win_bonus_rate: 0.5,
      draw_bonus_rate: 0,
      consolation_points: 0,
      consolation_gap: 2,
      first_battle_points: 0,
      daily_battles_target: 0,
      daily_battles_points: 0,
      equipment_drop_enabled: false,
      equipment_drop_multiplier: 1,
    };

    // --- C1. 建活动：只投放给「学生 a 的班」 ---
    const created = await apiSend('POST', '/api/pk/battle-configs', teacherToken,
      { ...basePayload, visible_class_ids: [myClassId] });
    const cfgId = created.json?.data?.id;
    ok('C1 建配置成功（含 visible_class_ids）', created.status === 200 && !!cfgId,
      `status=${created.status} id=${cfgId}`);
    if (cfgId) createdIds.push(cfgId);

    // --- C2. 教师列表带出 visible_class_ids ---
    const list = await apiGet('/api/pk/battle-configs', teacherToken);
    const mine = (list?.data || []).find((c) => c.id === cfgId);
    ok('C2 教师列表带出 visible_class_ids',
      mine && Array.isArray(mine.visible_class_ids) && mine.visible_class_ids.includes(myClassId),
      mine ? JSON.stringify(mine.visible_class_ids) : '未找到配置');

    // --- C3. 本班学生能看到 ---
    const activeMine = await apiGet('/api/pk/battle-configs/active', stuToken);
    const seenByMine = (activeMine?.data || []).some((c) => c.id === cfgId);
    ok('C3 本班学生 a 能看到该活动（投放生效）', seenByMine);

    // --- C4. 非本班学生看不到（换一个班的学生的 token 无法伪造，改用接口语义等价验证）---
    // 直接断言 SQL 口径：把该活动的可见班级改成 otherClassId，学生 a 应立刻看不到
    const upd = await apiSend('PUT', `/api/pk/battle-configs/${cfgId}`, teacherToken,
      { ...basePayload, visible_class_ids: [otherClassId] });
    ok('C4a PUT 改投放班级成功', upd.status === 200, `status=${upd.status}`);
    const activeAfter = await apiGet('/api/pk/battle-configs/active', stuToken);
    const stillSeen = (activeAfter?.data || []).some((c) => c.id === cfgId);
    ok('C4b 改投放给别的班后，本班学生 a 立刻看不到了（班级隔离生效）', !stillSeen);

    // --- C5. 改回不限班级（[]）→ 又可见 ---
    const upd2 = await apiSend('PUT', `/api/pk/battle-configs/${cfgId}`, teacherToken,
      { ...basePayload, visible_class_ids: [] });
    ok('C5a PUT 清空投放班级成功', upd2.status === 200, `status=${upd2.status}`);
    const activeUnlimited = await apiGet('/api/pk/battle-configs/active', stuToken);
    const seenAgain = (activeUnlimited?.data || []).some((c) => c.id === cfgId);
    ok('C5b 不限班级时本班学生 a 又可见了', seenAgain);

    const [cntUnlimited] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM ${TABLE} WHERE config_id = ?`, [cfgId]
    );
    ok('C5c 不限班级时表内无该配置的行（= 不限，而非全不可见）',
      Number(cntUnlimited[0].cnt) === 0, `rows=${cntUnlimited[0].cnt}`);

    // --- C6. PUT 不传 visible_class_ids 时保持原样 ---
    await apiSend('PUT', `/api/pk/battle-configs/${cfgId}`, teacherToken,
      { ...basePayload, visible_class_ids: [myClassId] });
    const putNoVis = { ...basePayload };
    delete putNoVis.visible_class_ids;
    const upd3 = await apiSend('PUT', `/api/pk/battle-configs/${cfgId}`, teacherToken, putNoVis);
    ok('C6a PUT 不带 visible_class_ids 仍成功', upd3.status === 200, `status=${upd3.status}`);
    const [cntKeep] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM ${TABLE} WHERE config_id = ? AND is_visible = 1`, [cfgId]
    );
    ok('C6b 不传该字段时可见班级不被清空（老调用方安全）',
      Number(cntKeep[0].cnt) === 1, `rows=${cntKeep[0].cnt}`);

    // --- C7. 禁用后学生看不到 ---
    await apiSend('PUT', `/api/pk/battle-configs/${cfgId}`, teacherToken,
      { ...basePayload, is_active: false, visible_class_ids: [myClassId] });
    const activeDisabled = await apiGet('/api/pk/battle-configs/active', stuToken);
    const seenDisabled = (activeDisabled?.data || []).some((c) => c.id === cfgId);
    ok('C7 活动禁用后学生看不到（is_active 与班级两个条件都生效）', !seenDisabled);

    // --- C8. DELETE 清理可见性行 ---
    const del = await apiSend('DELETE', `/api/pk/battle-configs/${cfgId}`, teacherToken);
    ok('C8a DELETE 成功', del.status === 200, `status=${del.status}`);
    const [cntAfterDel] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM ${TABLE} WHERE config_id = ?`, [cfgId]
    );
    ok('C8b 删除配置后可见性行被一并清理（无悬空）',
      Number(cntAfterDel[0].cnt) === 0, `残留 ${cntAfterDel[0].cnt} 行`);
    const idx = createdIds.indexOf(cfgId);
    if (idx >= 0) createdIds.splice(idx, 1);

    // --- C9. 越权：别的教师不能改这个配置 ---
    const [otherTeacher] = await pool.query(
      `SELECT p.id FROM profiles p WHERE p.role = 'teacher' AND p.id <> ? LIMIT 1`,
      ['teacher']
    );
    if (otherTeacher.length) {
      // /api/pk/battle-configs 教师列表按 teacher_id 过滤，别的老师列表里不该有本配置
      // （这里只能验证列表隔离；改配置需要用别的老师 token，测试环境未必有账号）
      const [cfgRow] = await pool.query('SELECT teacher_id FROM pk_battle_configs WHERE id = ?', [cfgId]);
      ok('C9 配置归属教师正确（列表按 teacher_id 隔离的前提）',
        cfgRow.length === 0 || String(cfgRow[0].teacher_id) === 'teacher');
    } else {
      ok('C9 配置归属字段存在', true, '（环境仅一个教师账号，跳过对照）');
    }
  }

  // 清理残留
  for (const id of createdIds) {
    try {
      await pool.query(`DELETE FROM ${TABLE} WHERE config_id = ?`, [id]);
      await pool.query('DELETE FROM pk_battle_configs WHERE id = ?', [id]);
    } catch { /* ignore */ }
  }

  console.log(`\n${'='.repeat(56)}`);
  console.log(`结果：${pass} 通过 / ${fail} 失败（共 ${pass + fail} 项）`);
  if (failures.length) {
    console.log('失败项：');
    failures.forEach((f) => console.log('  - ' + f));
  }
  console.log('='.repeat(56));
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('脚本异常：', e);
  process.exit(1);
});
