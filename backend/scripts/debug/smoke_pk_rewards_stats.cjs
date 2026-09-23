/**
 * smoke_pk_rewards_stats.cjs
 *
 * 目的：验证 PK 对战「奖励机制 + 教师端数据统计」（P0）以及两处历史隐患的修复。
 *
 * 分五层验证：
 *   A. 数据库结构与迁移
 *      - 迁移 086 的四组改动确实落库：奖励配置列、开局快照列、source_type 枚举、
 *        pk_daily_rewards 表（含唯一索引 —— 幂等的根基）
 *   B. 奖励计算口径（纯函数级，不需要对局）
 *      - 倍率 / 胜负加成 / 平局加成 / 缺省回退（不填 = 旧行为，必须严格相等）
 *   C. 统计接口（真数据）
 *      - 总览 / 按活动 / 按学生 三个接口的口径自洽性（独立 SQL 复算比对）
 *   D. 配置往返（接口层）
 *      - 奖励字段能存能读；越界值被钳制；空值 = 默认
 *   E. 源码接线（防重构删掉关键逻辑）
 *      - handler 必须整行透传奖励字段（历史上这里是手搭子集，最容易漏）
 *      - battleEngine 必须写 source_type='pk_battle'
 *      - 参与类奖励必须走 INSERT IGNORE（幂等）
 *
 * 用法：node scripts/debug/smoke_pk_rewards_stats.cjs
 * 前提：后端在跑（默认 127.0.0.1:3101）
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

// ── 被测奖励口径的独立实现（与 rankCalc.calcSystemPoints 同构，用于交叉验证）──
function expectedPoints(correct, { basePoints = 10, multiplier = 1, winBonusRate = 0.5, drawBonusRate = 0, isWinner = false, isDraw = false } = {}) {
  const base = Math.max(0, correct) * basePoints * multiplier;
  let rate = 1;
  if (isDraw) rate = 1 + drawBonusRate;
  else if (isWinner) rate = 1 + winBonusRate;
  return Math.max(0, Math.floor(base * rate));
}

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

async function apiSend(method, endpoint, token, body) {
  try {
    const res = await fetch(`${BASE}${endpoint}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    return await res.json();
  } catch {
    return null;
  }
}

async function main() {
  // ══ A. 数据库结构与迁移 ═══════════════════════════════════════════════
  section('A. 数据库结构与迁移（迁移 086）');

  {
    const [cols] = await pool.query('SHOW COLUMNS FROM pk_battle_configs');
    const names = cols.map((c) => c.Field);
    const expect = ['points_multiplier', 'win_bonus_rate', 'draw_bonus_rate',
      'consolation_points', 'consolation_gap', 'first_battle_points',
      'daily_battles_target', 'daily_battles_points'];
    for (const c of expect) {
      ok(`pk_battle_configs 有 ${c} 列`, names.includes(c));
    }
    // 默认值必须等价于「旧行为」：倍率1、赢×1.5、其余不启用
    const pm = cols.find((c) => c.Field === 'points_multiplier');
    const wb = cols.find((c) => c.Field === 'win_bonus_rate');
    ok('points_multiplier 默认 1.00（不加倍）', String(pm?.Default) === '1.00', `实际 ${pm?.Default}`);
    ok('win_bonus_rate 默认 0.50（与旧硬编码 ×1.5 一致）', String(wb?.Default) === '0.50', `实际 ${wb?.Default}`);
    const cp = cols.find((c) => c.Field === 'consolation_points');
    ok('consolation_points 默认 0（不启用）', String(cp?.Default) === '0', `实际 ${cp?.Default}`);
  }

  {
    const [cols] = await pool.query('SHOW COLUMNS FROM pk_room_players');
    const names = cols.map((c) => c.Field);
    for (const c of ['config_id', 'config_name', 'question_count', 'duration_seconds', 'consolation_points', 'bonus_points']) {
      ok(`pk_room_players 有 ${c} 列（开局快照/奖励明细）`, names.includes(c));
    }
    const [idx] = await pool.query('SHOW INDEX FROM pk_room_players');
    ok('pk_room_players 有 idx_config 索引', idx.some((i) => i.Key_name === 'idx_config'));
  }

  {
    const [cols] = await pool.query('SHOW COLUMNS FROM point_transactions');
    const st = cols.find((c) => c.Field === 'source_type');
    ok("point_transactions.source_type 含 'pk_battle'（隐患1修复）",
      !!st && String(st.Type).includes("'pk_battle'"), st?.Type);
    // 旧枚举值不能丢（历史上 021/049/075 三次追加过）
    for (const v of ['notification', 'manual', 'system', 'practice', 'pet_feed', 'test', 'python_submit', 'exam', 'task']) {
      ok(`source_type 保留旧枚举 '${v}'`, String(st?.Type).includes(`'${v}'`));
    }
  }

  {
    const [t] = await pool.query("SHOW TABLES LIKE 'pk_daily_rewards'");
    ok('pk_daily_rewards 表存在', t.length > 0);
    if (t.length > 0) {
      const [idx] = await pool.query('SHOW INDEX FROM pk_daily_rewards');
      const uk = idx.find((i) => i.Key_name === 'uk_user_date_type');
      ok('pk_daily_rewards 有唯一索引 uk_user_date_type', !!uk);
      if (uk) {
        const cols = idx.filter((i) => i.Key_name === 'uk_user_date_type').map((i) => i.Column_name);
        ok('唯一索引覆盖 (user_id, reward_date, reward_type)',
          cols.join(',') === 'user_id,reward_date,reward_type', cols.join(','));
      }
    }
  }

  // ══ B. 奖励计算口径（纯函数）═══════════════════════════════════════════
  section('B. 奖励计算口径（rankCalc.calcSystemPoints）');

  const { calcSystemPoints } = require('../../src/pk-socket/rankCalc');

  // 兼容旧签名：第三参传数字 ⇒ 旧行为，必须与升级前逐位一致
  ok('向后兼容：calcSystemPoints(10, true, 10) = 150（旧行为 ×1.5）',
    calcSystemPoints(10, true, 10) === 150, `实际 ${calcSystemPoints(10, true, 10)}`);
  ok('向后兼容：calcSystemPoints(10, false, 10) = 100（输方不加成）',
    calcSystemPoints(10, false, 10) === 100, `实际 ${calcSystemPoints(10, false, 10)}`);
  ok('向后兼容：calcSystemPoints(0, true, 10) = 0',
    calcSystemPoints(0, true, 10) === 0);

  // 新签名：不传配置 ⇒ 缺省回退，结果必须与旧行为完全相同
  ok('缺省回退：不传配置时赢方仍为 ×1.5',
    calcSystemPoints(7, true, { basePoints: 10 }) === expectedPoints(7, { isWinner: true }),
    `${calcSystemPoints(7, true, { basePoints: 10 })} vs ${expectedPoints(7, { isWinner: true })}`);

  // 倍率
  ok('倍率：3 倍 ⇒ 做对10题赢方 = 450',
    calcSystemPoints(10, true, { basePoints: 10, multiplier: 3, winBonusRate: 0.5 }) === 450,
    `实际 ${calcSystemPoints(10, true, { basePoints: 10, multiplier: 3, winBonusRate: 0.5 })}`);
  ok('倍率对输方同样生效：3 倍 ⇒ 做对10题输方 = 300',
    calcSystemPoints(10, false, { basePoints: 10, multiplier: 3 }) === 300);
  ok('倍率小数：1.5 倍 ⇒ 做对10题赢方 = 225',
    calcSystemPoints(10, true, { basePoints: 10, multiplier: 1.5, winBonusRate: 0.5 }) === 225);

  // 胜负加成
  ok('赢方加成 1.0 ⇒ ×2（做对10题 = 200）',
    calcSystemPoints(10, true, { basePoints: 10, winBonusRate: 1.0 }) === 200);
  ok('赢方加成 0 ⇒ 不加成（做对10题 = 100）',
    calcSystemPoints(10, true, { basePoints: 10, winBonusRate: 0 }) === 100);
  ok('平局加成 0.2 ⇒ ×1.2（做对10题 = 120）',
    calcSystemPoints(10, false, { basePoints: 10, drawBonusRate: 0.2, isDraw: true }) === 120);
  ok('平局不误用赢方加成（isDraw 优先）',
    calcSystemPoints(10, true, { basePoints: 10, winBonusRate: 0.5, drawBonusRate: 0, isDraw: true }) === 100);

  // 异常值防御
  ok('倍率为 0 / 负数时回退到 1（不得把积分清零）',
    calcSystemPoints(10, false, { basePoints: 10, multiplier: 0 }) === 100
    && calcSystemPoints(10, false, { basePoints: 10, multiplier: -3 }) === 100);
  ok('正确题数为负时按 0 处理（不产生负积分）',
    calcSystemPoints(-5, false, { basePoints: 10 }) === 0);
  ok('结果为整数（Math.floor，不产生小数积分）',
    Number.isInteger(calcSystemPoints(7, true, { basePoints: 13, multiplier: 1.7, winBonusRate: 0.33 })));

  // ══ C. 统计接口口径自洽（真数据）═════════════════════════════════════════
  section('C. 统计接口口径自洽性');

  const teacherToken = await loginUser('teacher', 'xgpy666');
  ok('教师登录成功', !!teacherToken);
  if (!teacherToken) {
    console.log('\n⚠️ 教师登录失败，跳过 C/D 段（接口层验证）。');
    return summary();
  }

  const clsRes = await (await fetch(`${BASE}/api/classes`)).json();
  const classes = Array.isArray(clsRes) ? clsRes : (clsRes.data || []);
  ok('拉到班级列表', classes.length > 0, `${classes.length} 个`);
  // 优先选有对战数据的班级
  let clsId = classes[0]?.id;
  for (const c of classes) {
    const [r] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM pk_room_players p
       JOIN profiles pr ON p.user_id = pr.id WHERE pr.class_id = ?`, [c.id]
    );
    if (r[0].cnt > 0) { clsId = c.id; break; }
  }
  ok('选定测试班级', !!clsId);

  // C1. 总览：参与率 / 场次 / 正确率 与独立 SQL 复算一致
  const ov = await apiGet(`/api/pk/stats/overview?class_id=${clsId}`, teacherToken);
  ok('总览接口返回数据', !!ov?.data);
  if (ov?.data) {
    const [[expect]] = await pool.query(
      `SELECT COUNT(DISTINCT p.room_id) AS rooms,
              COUNT(DISTINCT p.user_id) AS players,
              COALESCE(SUM(p.final_correct),0) AS correct,
              COALESCE(SUM(p.final_correct + p.final_wrong),0) AS answered
       FROM pk_room_players p
       JOIN profiles pr ON p.user_id = pr.id
       WHERE p.room_id IN (SELECT r.id FROM pk_rooms r WHERE r.status='finished')
         AND p.result <> 'pending' AND pr.class_id = ?`, [clsId]
    );
    ok('总览：场次与独立 SQL 一致',
      Number(ov.data.total_rooms) === Number(expect.rooms),
      `${ov.data.total_rooms} vs ${expect.rooms}`);
    ok('总览：参与人数与独立 SQL 一致',
      Number(ov.data.players) === Number(expect.players));
    ok('总览：做对题数与独立 SQL 一致',
      Number(ov.data.total_correct) === Number(expect.correct));
    const expRate = Number(expect.answered) > 0
      ? Math.round((Number(expect.correct) / Number(expect.answered)) * 1000) / 10 : null;
    ok('总览：平均正确率口径 = 做对/作答（保留 1 位）',
      ov.data.avg_correct_rate === expRate,
      `${ov.data.avg_correct_rate} vs ${expRate}`);
    // 参与率 = 有对战记录人数 / 班级学生数
    const [[cntRow]] = await pool.query(
      "SELECT COUNT(*) AS cnt FROM profiles WHERE class_id = ? AND role='student'", [clsId]
    );
    const expPart = Number(cntRow.cnt) > 0
      ? Math.round((Number(expect.players) / Number(cntRow.cnt)) * 1000) / 10 : 0;
    ok('总览：参与率 = 参与人数/班级人数',
      Number(ov.data.participation_rate) === expPart,
      `${ov.data.participation_rate}% vs ${expPart}%`);
    ok('总览：参与人数不超过班级总人数',
      Number(ov.data.players) <= Number(ov.data.total_students));
  }

  // C2. 按活动：场次合计必须等于总览总场次（同一批对局按活动拆分）
  const bc = await apiGet(`/api/pk/stats/by-config?class_id=${clsId}`, teacherToken);
  ok('按活动接口返回数组', Array.isArray(bc?.data));
  if (Array.isArray(bc?.data) && ov?.data) {
    const sum = bc.data.reduce((s, r) => s + Number(r.rooms || 0), 0);
    ok('按活动：各活动场次之和 = 总览总场次（拆分无遗漏/无重复）',
      sum === Number(ov.data.total_rooms),
      `${sum} vs ${ov.data.total_rooms}`);
    ok('按活动：标了 never_used 的活动场次必为 0',
      bc.data.filter((r) => r.never_used).every((r) => Number(r.rooms) === 0));
    ok('按活动：有场次的活动正确率口径自洽（做对/作答）',
      bc.data.filter((r) => Number(r.rooms) > 0).every((r) => {
        if (Number(r.total_answered) === 0) return r.avg_correct_rate == null;
        const exp = Math.round((Number(r.total_correct) / Number(r.total_answered)) * 1000) / 10;
        return r.avg_correct_rate === exp;
      }));
  }

  // C3. 按学生：场次合计 = 2 × 总览总场次（每局 2 人），且每人数据自洽
  const bs = await apiGet(`/api/pk/stats/by-student?class_id=${clsId}`, teacherToken);
  ok('按学生接口返回数组', Array.isArray(bs?.data));
  if (Array.isArray(bs?.data) && ov?.data) {
    const sum = bs.data.reduce((s, r) => s + Number(r.rooms_played || 0), 0);
    ok('按学生：各人场次之和 = 2 × 总览总场次',
      sum === Number(ov.data.total_rooms) * 2,
      `${sum} vs ${Number(ov.data.total_rooms) * 2}`);
    ok('按学生：胜+负+平 = 场次（每人自己的场次分项）',
      bs.data.every((r) => Number(r.wins) + Number(r.losses) + Number(r.draws) === Number(r.rooms_played)),
      bs.data.map((r) => `${r.username}:${r.wins}+${r.losses}+${r.draws}/${r.rooms_played}`)
        .filter((s) => { const [a, b] = s.split(':'); const [w, l, d, t] = b.split(/[+/]/).map(Number); return w + l + d !== t; })
        .join(' ') || '全部一致');
    ok('按学生：无对战记录者场次为 0 且胜率为 null（不是 0%）',
      bs.data.filter((r) => Number(r.rooms_played) === 0)
        .every((r) => r.win_rate === null && r.correct_rate === null));
    ok('按学生：有对战记录者正确率非 null',
      bs.data.filter((r) => Number(r.total_answered) > 0).every((r) => r.correct_rate != null));
    ok('按学生：包含班级全部学生（含从未参与者）',
      bs.data.length >= Number(ov.data.players));
  }

  // C4. 积分流水摘要：source_type 必须是 pk_battle（隐患1的端到端验证）
  const ps = await apiGet(`/api/pk/stats/points-summary?class_id=${clsId}`, teacherToken);
  ok('积分摘要接口返回数据', !!ps?.data);
  if (ps?.data) {
    const [[expect]] = await pool.query(
      `SELECT COUNT(*) AS cnt, COALESCE(SUM(t.amount),0) AS amt
       FROM point_transactions t JOIN profiles pr ON t.student_id = pr.id
       WHERE t.source_type = 'pk_battle' AND pr.class_id = ?`, [clsId]
    );
    ok('积分摘要：笔数与独立 SQL 一致',
      Number(ps.data.tx_count) === Number(expect.cnt), `${ps.data.tx_count} vs ${expect.cnt}`);
    ok('积分摘要：总额与独立 SQL 一致',
      Number(ps.data.total_amount) === Number(expect.amt));
    // 老数据里 PK 积分记的是 'system'，所以这里不该断言 >0（历史流水不可追溯），
    // 但必须确认「没有把 pk_battle 的流水漏掉」—— 由上面两条一致性断言覆盖。
  }

  // 权限：学生不得访问教师统计接口
  const studentToken = await loginUser('a', '111111');
  if (studentToken) {
    const forbidden = await apiGet(`/api/pk/stats/overview?class_id=${clsId}`, studentToken);
    ok('学生访问 PK 统计接口被拒绝（403/错误响应）',
      !forbidden?.data || forbidden?.error != null,
      JSON.stringify(forbidden)?.slice(0, 120));
  }

  // ══ D. 配置往返（接口层）═══════════════════════════════════════════════
  section('D. 奖励配置往返与钳制');

  const created = await apiSend('POST', '/api/pk/battle-configs', teacherToken, {
    name: '__smoke_pk_reward', mode: 'timed', duration_seconds: 120, question_count: 10,
    is_active: false,
    points_multiplier: 2.5, win_bonus_rate: 0.8, draw_bonus_rate: 0.2,
    consolation_points: 20, consolation_gap: 3,
    first_battle_points: 15, daily_battles_target: 3, daily_battles_points: 25,
  });
  const newId = created?.data?.id;
  ok('创建带奖励的配置成功', !!newId, newId);

  if (newId) {
    try {
      const list = await apiGet('/api/pk/battle-configs', teacherToken);
      const row = (list?.data || []).find((x) => x.id === newId);
      ok('回读到刚创建的配置', !!row);
      if (row) {
        ok('奖励：points_multiplier 往返一致', Number(row.points_multiplier) === 2.5, String(row.points_multiplier));
        ok('奖励：win_bonus_rate 往返一致', Number(row.win_bonus_rate) === 0.8);
        ok('奖励：draw_bonus_rate 往返一致', Number(row.draw_bonus_rate) === 0.2);
        ok('奖励：consolation_points 往返一致', Number(row.consolation_points) === 20);
        ok('奖励：consolation_gap 往返一致', Number(row.consolation_gap) === 3);
        ok('奖励：first_battle_points 往返一致', Number(row.first_battle_points) === 15);
        ok('奖励：daily_battles_target 往返一致', Number(row.daily_battles_target) === 3);
        ok('奖励：daily_battles_points 往返一致', Number(row.daily_battles_points) === 25);
      }

      // 越界钳制
      await apiSend('PUT', `/api/pk/battle-configs/${newId}`, teacherToken, {
        name: '__smoke_pk_reward', mode: 'timed', duration_seconds: 120, question_count: 10,
        is_active: false,
        points_multiplier: 999, win_bonus_rate: -5, consolation_points: -100,
      });
      const list2 = await apiGet('/api/pk/battle-configs', teacherToken);
      const row2 = (list2?.data || []).find((x) => x.id === newId);
      ok('越界：points_multiplier 999 被钳到 10', Number(row2?.points_multiplier) === 10, String(row2?.points_multiplier));
      ok('越界：负的 win_bonus_rate 被钳到 0', Number(row2?.win_bonus_rate) === 0, String(row2?.win_bonus_rate));
      ok('越界：负的 consolation_points 被钳到 0（不得变成扣分）',
        Number(row2?.consolation_points) === 0, String(row2?.consolation_points));

      // 不传奖励字段 ⇒ 落默认（等价旧行为）
      const created2 = await apiSend('POST', '/api/pk/battle-configs', teacherToken, {
        name: '__smoke_pk_reward_default', mode: 'timed', is_active: false,
      });
      if (created2?.data?.id) {
        const list3 = await apiGet('/api/pk/battle-configs', teacherToken);
        const row3 = (list3?.data || []).find((x) => x.id === created2.data.id);
        ok('不传奖励字段 ⇒ 倍率默认 1（不改变旧行为）', Number(row3?.points_multiplier) === 1);
        ok('不传奖励字段 ⇒ 赢方加成默认 0.5（= 旧 ×1.5）', Number(row3?.win_bonus_rate) === 0.5);
        ok('不传奖励字段 ⇒ 参与奖励默认 0（不启用）',
          Number(row3?.consolation_points) === 0 && Number(row3?.first_battle_points) === 0
          && Number(row3?.daily_battles_target) === 0);
        await apiSend('DELETE', `/api/pk/battle-configs/${created2.data.id}`, teacherToken);
      }
    } finally {
      await apiSend('DELETE', `/api/pk/battle-configs/${newId}`, teacherToken);
      console.log('  （已清理临时配置）');
    }
  }

  // ══ E. 源码接线 ════════════════════════════════════════════════════════
  section('E. 源码接线（防重构回归）');

  const handler = readSrc('src/pk-socket/handler.js');
  const engine = readSrc('src/pk-socket/battleEngine.js');
  const indexSrc = readSrc('src/index.js');

  // E1. handler 必须整行透传奖励字段（历史上这里手搭子集，最容易漏）
  ok('handler 有 buildBattleConfig 组装函数', /function buildBattleConfig/.test(handler));
  for (const f of ['points_multiplier', 'win_bonus_rate', 'draw_bonus_rate',
    'consolation_points', 'consolation_gap', 'first_battle_points',
    'daily_battles_target', 'daily_battles_points']) {
    ok(`buildBattleConfig 透传 ${f}`, new RegExp(`${f}:\\s*row\\.${f}`).test(handler));
  }
  ok('两处 startBattle 都用 buildBattleConfig（而非手搭子集）',
    (handler.match(/config:\s*buildBattleConfig\(config\)/g) || []).length === 2,
    `实际 ${(handler.match(/config:\s*buildBattleConfig\(config\)/g) || []).length} 处`);

  // E2. 结算写流水必须用 pk_battle（隐患1）
  ok("battleEngine 写 point_transactions 时 source_type = 'pk_battle'",
    /VALUES \(\?, \?, 'pk_battle', \?, \?, NOW\(\)\)/.test(engine));
  ok("battleEngine 不再把 PK 积分写成 'system'",
    !/VALUES \(\?, \?, 'system', \?, \?, NOW\(\)\)/.test(engine));
  ok('battleEngine 流水备注取真实房间码（修掉恒为 quick 的 TODO）',
    /const roomCode = roomRows\.length > 0 \? roomRows\[0\]\.room_code : null/.test(engine)
    && !/roomCode = 'quick'/.test(engine));

  // E3. 开局快照（隐患2）
  ok('startBattle 把活动快照写进 pk_room_players',
    /UPDATE pk_room_players\s+SET config_id = \?, config_name = \?, question_count = \?, duration_seconds = \?/.test(engine));
  ok('结算时把活动配置带入（保证与开局口径一致）',
    /const config = state\.config \|\| \{\}/.test(engine));

  // E4. 参与类奖励必须幂等
  ok('参与类奖励走 INSERT IGNORE（幂等）',
    /INSERT IGNORE INTO pk_daily_rewards/.test(engine));
  ok('参与类奖励按 affectedRows 判定是否已发过',
    /ins\.affectedRows === 0/.test(engine));
  ok('参与类奖励同时写积分流水（可追溯）',
    /grantParticipationRewards/.test(engine) && /pk_daily_rewards/.test(engine));
  ok('参与类奖励写入 pk_room_players.bonus_points（统计可见）',
    /UPDATE pk_room_players SET bonus_points = \?/.test(engine));

  // E5. 统计接口存在且仅教师可访问
  for (const ep of ['/api/pk/stats/overview', '/api/pk/stats/by-config',
    '/api/pk/stats/by-student', '/api/pk/stats/points-summary']) {
    ok(`后端注册了 ${ep}`, indexSrc.includes(`app.get('${ep}'`));
  }
  ok('PK 统计接口全部要求教师身份',
    (indexSrc.match(/app\.get\('\/api\/pk\/stats\/[a-z-]+', authenticate, requireTeacher/g) || []).length === 4,
    `实际 ${(indexSrc.match(/app\.get\('\/api\/pk\/stats\/[a-z-]+', authenticate, requireTeacher/g) || []).length} 处`);
  ok('后端有 normalizePkRewardFields 归一化（含钳制）',
    /function normalizePkRewardFields/.test(indexSrc));
  ok('POST 配置透传奖励字段', /points_multiplier, win_bonus_rate, draw_bonus_rate/.test(indexSrc));

  // E6. 前端接线
  const feConfig = readFe('src/components/teacher/PKBattleConfigTab.tsx');
  ok('前端配置页有奖励设置区块', /奖励设置/.test(feConfig));
  ok('前端配置页提交奖励字段', /points_multiplier: numOr\(formData\.points_multiplier, 1\)/.test(feConfig));
  ok('前端配置页展示奖励摘要（列表卡片）', /积分 \{Number\(cfg\.points_multiplier\)\} 倍/.test(feConfig));

  const feStats = readFe('src/components/teacher/PKStatsTab.tsx');
  ok('前端有 PKStatsTab 组件', feStats.length > 1000);
  ok('统计面板调三个统计接口',
    feStats.includes('/api/pk/stats/overview') && feStats.includes('/api/pk/stats/by-config')
    && feStats.includes('/api/pk/stats/by-student'));
  ok('统计面板取 token 走 getAuthToken（同源 iframe 安全）',
    /getAuthToken/.test(feStats));

  const feExam = readFe('src/components/teacher/ExamManager.tsx');
  ok('ExamManager 注册了「对战数据」tab', /pk_stats/.test(feExam) && /PKStatsTab/.test(feExam));

  return summary();
}

function summary() {
  console.log('\n' + '═'.repeat(56));
  console.log(`结果：${pass} 通过 / ${fail} 失败`);
  if (failures.length > 0) {
    console.log('失败项：');
    failures.forEach((f) => console.log('  - ' + f));
  }
  console.log('═'.repeat(56));
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('脚本异常:', e);
  process.exit(2);
});
